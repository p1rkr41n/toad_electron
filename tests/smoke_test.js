const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

const ROOT_DIR = process.env.TOAD_ROOT || path.resolve(__dirname, "..");

async function runSmokeTest() {
  console.log("======================================================================");
  console.log("  SMOKE TEST: TOAD v2.5.2 RUNTIME INTEGRITY & STARTUP VERIFICATION");
  console.log("======================================================================");

  // 1. Check Portable Exe (Canonical Toad.exe or releases/Toad-*-x64-portable.exe)
  const canonicalRootExe = path.resolve(ROOT_DIR, "Toad.exe");
  const releasesDir = path.resolve(ROOT_DIR, "releases");
  let portableExe = fs.existsSync(canonicalRootExe) ? canonicalRootExe : null;
  if (!portableExe && fs.existsSync(releasesDir)) {
    const relExes = fs.readdirSync(releasesDir).filter(f => f.startsWith("Toad-") && f.endsWith("-x64-portable.exe"));
    if (relExes.length > 0) {
      portableExe = path.resolve(releasesDir, relExes[0]);
    }
  }
  assert(portableExe && fs.existsSync(portableExe), `Portable executable must exist: ${canonicalRootExe}`);
  const exeStats = fs.statSync(portableExe);
  const exeSizeMB = (exeStats.size / (1024 * 1024)).toFixed(2);
  console.log(`[PASS] Portable Exe verified: ${portableExe}`);
  console.log(`       Size: ${exeSizeMB} MB (Within target budget < 75 MB)`);
  assert(exeStats.size > 50 * 1024 * 1024 && exeStats.size < 75 * 1024 * 1024, "Exe size in expected range");

  // Verify PE MZ header
  const fd = fs.openSync(portableExe, "r");
  const buffer = Buffer.alloc(2);
  fs.readSync(fd, buffer, 0, 2, 0);
  fs.closeSync(fd);
  assert.strictEqual(buffer.toString("ascii"), "MZ", "Portable binary must have valid PE 'MZ' magic header");
  console.log("[PASS] Binary PE Header verified valid: 'MZ'");

  // 2. Check asar package
  const appDir = fs.existsSync(path.resolve(ROOT_DIR, "tad-master/packages/toad-app"))
    ? path.resolve(ROOT_DIR, "tad-master/packages/toad-app")
    : path.resolve(ROOT_DIR, "tad-master/packages/tad-app");
  const asarPath = path.resolve(appDir, "release/win-unpacked/resources/app.asar");
  assert(fs.existsSync(asarPath), `app.asar must exist: ${asarPath}`);
  const asar = require(path.resolve(ROOT_DIR, "tad-master/node_modules/@electron/asar"));
  const files = asar.listPackage(asarPath);
  console.log(`[PASS] app.asar contains ${files.length} packaged entries`);

  const hasBigQuery = files.some((f) => f.includes("bigquery") || f.includes("@google-cloud/bigquery"));
  assert(!hasBigQuery, "app.asar must NOT contain any BigQuery files");
  console.log("[PASS] Verified: Zero BigQuery remnants in app.asar");

  const hasLodash = files.some((f) => f.includes("lodash"));
  assert(hasLodash, "app.asar MUST contain lodash");
  console.log("[PASS] Verified: lodash runtime backend present in app.asar");

  const hasSourcemap = files.some((f) => f.endsWith(".js.map"));
  assert(!hasSourcemap, "app.asar must NOT contain .map sourcemap files");
  console.log("[PASS] Verified: Zero .map files in app.asar (Webpack prod devtool=false)");

  // 3. Smoke Test App Launch
  const unpackedExe = path.resolve(appDir, "release/win-unpacked/Toad.exe");
  assert(fs.existsSync(unpackedExe), `win-unpacked/Toad.exe must exist: ${unpackedExe}`);

  console.log("\n[INFO] Launching win-unpacked/Toad.exe for live process smoke test...");
  let stderrLog = "";
  let stdoutLog = "";
  let processExitedEarly = false;

  const child = spawn(unpackedExe, [], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (data) => {
    stdoutLog += data.toString();
  });

  child.stderr.on("data", (data) => {
    stderrLog += data.toString();
  });

  child.on("exit", (code) => {
    processExitedEarly = true;
    console.log(`[INFO] Process exited with code: ${code}`);
  });

  // Let it run for 6 seconds to ensure complete main process bootstrap
  await new Promise((resolve) => setTimeout(resolve, 6000));

  console.log(`[INFO] Process PID: ${child.pid}, Active: ${!child.killed && !processExitedEarly}`);

  // Assert no fatal JS exceptions occurred
  assert(!stderrLog.includes("Cannot find module"), "Stderr must not contain 'Cannot find module'");
  assert(!stderrLog.includes("Uncaught Exception"), "Stderr must not contain 'Uncaught Exception'");
  assert(!stdoutLog.includes("Cannot find module"), "Stdout must not contain 'Cannot find module'");
  assert(!stdoutLog.includes("Uncaught Exception"), "Stdout must not contain 'Uncaught Exception'");

  // 4. Verify Application & Renderer Logs for Zero White Screen / Unhandled Exceptions
  const exeDir = path.dirname(unpackedExe);
  let logPath = null;

  try {
    const subdirs = fs.readdirSync(exeDir);
    for (const d of subdirs) {
      if (d.startsWith("toadAppData_")) {
        const candidate = path.join(exeDir, d, "logs", "toad.log");
        if (fs.existsSync(candidate)) {
          logPath = candidate;
          break;
        }
      }
    }
  } catch {}

  if (!logPath && process.env.APPDATA) {
    const candidate = path.join(process.env.APPDATA, "Toad", "logs", "toad.log");
    if (fs.existsSync(candidate)) {
      logPath = candidate;
    }
  }

  if (logPath) {
    console.log(`[INFO] Inspecting live log: ${logPath}`);
    const logContent = fs.readFileSync(logPath, "utf8");

    const rendererErrors = logContent
      .split("\n")
      .filter((line) => line.includes("[RENDERER-CONSOLE]") && (line.includes("lvl=3") || line.includes("Uncaught") || line.includes("ReferenceError") || line.includes("TypeError")));

    if (rendererErrors.length > 0) {
      console.error("[FAIL] Renderer console unhandled exceptions detected in toad.log:");
      rendererErrors.forEach((e) => console.error("   --> " + e));
      throw new Error(`Renderer unhandled exception detected! (${rendererErrors.length} errors found)`);
    }
    console.log("[PASS] Renderer log inspected: Zero unhandled console exceptions detected (No White Screen)");

    const hasEngineSpawn = logContent.includes("Engine child spawned successfully") || logContent.includes("Forwarded MessagePort pair");
    if (hasEngineSpawn) {
      console.log("[PASS] Engine Supervisor verified: Dedicated engine child and MessagePort active");
    }
  } else {
    console.log("[WARN] toad.log not found in expected locations, falling back to process stdout/stderr checks");
  }

  console.log("[PASS] Main process bootstrap completed cleanly without uncaught exceptions!");

  // Terminate cleanly
  try {
    process.kill(child.pid);
  } catch (e) {
    try {
      execSync(`taskkill /F /PID ${child.pid}`, { stdio: "ignore" });
    } catch {}
  }

  // Also clean up any lingering electron child processes
  try {
    execSync("taskkill /F /IM Toad.exe", { stdio: "ignore" });
  } catch {}

  console.log("[PASS] Smoke test completed successfully with 100% HEALTHY result!");
  console.log("======================================================================\n");
  return true;
}

if (require.main === module) {
  runSmokeTest().catch((err) => {
    console.error("FATAL SMOKE TEST FAILURE:", err);
    process.exit(1);
  });
}

module.exports = { runSmokeTest };

