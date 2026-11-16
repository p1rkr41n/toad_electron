const fs = require("fs");
const path = require("path");

const SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX", "ascii");
// Electron FuseV1 8-byte wire layout:
//   [0] RunAsNode = '0' (disabled)
//   [1] EnableCookieEncryption = '1' (enabled)
//   [2] EnableNodeOptionsEnvironmentVariable = '0' (disabled)
//   [3] EnableNodeCliInspectArguments = '0' (disabled)
//   [4] EnableEmbeddedAsarIntegrityValidation = '0' (disabled on unsigned PE)
//   [5] OnlyLoadAppFromAsar = '1' (enabled)
//   [6] LoadBrowserProcessSpecificV8Snapshot = '0' (disabled)
//   [7] GrantFileProtocolExtraPrivileges = '1' (preserved for local HTML UI)
const TARGET_FUSES = "01000101";

function readElectronFuses(exePath) {
  if (!exePath || !fs.existsSync(exePath)) {
    throw new Error(`Executable not found for fuse inspection: ${exePath}`);
  }
  const buf = fs.readFileSync(exePath);
  const idx = buf.indexOf(SENTINEL);
  if (idx === -1) {
    throw new Error(`Electron fuse sentinel not found in binary: ${exePath}`);
  }
  const secondIdx = buf.indexOf(SENTINEL, idx + SENTINEL.length);
  if (secondIdx !== -1) {
    throw new Error(`Multiple Electron fuse sentinels detected in binary: ${exePath}`);
  }
  const version = buf[idx + SENTINEL.length];
  const length = buf[idx + SENTINEL.length + 1];
  const fusesOffset = idx + SENTINEL.length + 2;
  const fuses = buf.subarray(fusesOffset, fusesOffset + length).toString("ascii");
  return {
    sentinelOffset: idx,
    version,
    length,
    fusesOffset,
    fuses,
    flags: {
      runAsNode: fuses[0] === "1",
      cookieEncryption: fuses[1] === "1",
      nodeOptions: fuses[2] === "1",
      nodeCliInspect: fuses[3] === "1",
      embeddedAsarIntegrity: fuses[4] === "1",
      onlyLoadAppFromAsar: fuses[5] === "1",
      v8Snapshot: fuses[6] === "1",
      grantFileProtocolExtraPrivileges: fuses[7] === "1",
    },
  };
}

function patchElectronFuses(exePath, targetFuses = TARGET_FUSES) {
  const info = readElectronFuses(exePath);
  if (info.version !== 1) {
    throw new Error(`Unsupported Electron fuse schema version: ${info.version}`);
  }
  if (info.length < targetFuses.length) {
    throw new Error(
      `Electron fuse wire length (${info.length}) shorter than target (${targetFuses.length})`
    );
  }
  if (!/^[01]+$/.test(targetFuses)) {
    throw new Error(`Invalid target fuse bitstring: ${targetFuses}`);
  }
  const fd = fs.openSync(exePath, "r+");
  try {
    const patchBuf = Buffer.from(targetFuses, "ascii");
    fs.writeSync(fd, patchBuf, 0, patchBuf.length, info.fusesOffset);
  } finally {
    fs.closeSync(fd);
  }
  return readElectronFuses(exePath);
}

const PRUNED_TOP_LEVEL_NODE_MODULES = [
  "rimraf",
  "tar",
  "minizlib",
  "minipass",
  "minipass-collect",
  "minipass-flush",
  "minipass-pipeline",
  "minipass-sized",
  "fs-minipass",
  "chownr",
  "path-scurry",
  "foreground-child",
  "@isaacs",
  "jackspeak",
  "@pkgjs",
  "package-json-from-dist",
  "glob",
  "cross-spawn",
  "which",
  "isexe",
  "mkdirp",
  "node-addon-api",
  "encoding",
  "iconv-lite",
  "socks",
  "ip-address",
  "smart-buffer",
  "https-proxy-agent",
  "agent-base",
  "agentkeepalive",
  "exponential-backoff",
  "negotiator",
  "node-fetch",
  "make-dir",
  "make-fetch-happen",
  "cacache",
  "@npmcli",
  "@gar",
  "promise-retry",
  "retry",
  "err-code",
  "http-cache-semantics",
  "promise-inflight",
  "ssri",
  "infer-owner",
  "imurmurhash",
  "unique-filename",
  "unique-slug",
  "env-paths",
  "aggregate-error",
  "clean-stack",
  "indent-string",
  "p-map",
  "shebang-command",
  "shebang-regex",
  "path-key",
  "string-width-cjs",
  "strip-ansi-cjs",
  "wrap-ansi-cjs",
  "eastasianwidth",
  "minimatch",
  "brace-expansion",
  "concat-map",
  "balanced-match",
];

function rmSafe(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function loadAsarModule() {
  const localAsar = path.resolve(__dirname, "../../../node_modules/@electron/asar");
  if (fs.existsSync(localAsar)) {
    return require(localAsar);
  }
  return require("@electron/asar");
}

function pruneSpecAndEsmArtifacts(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "__specs__" || ent.name === "__tests__" || ent.name === ".bin") {
        rmSafe(full);
      } else {
        pruneSpecAndEsmArtifacts(full);
        if (fs.existsSync(full) && fs.readdirSync(full).length === 0) {
          rmSafe(full);
        }
      }
    } else if (ent.isFile()) {
      if (
        ent.name.endsWith(".mjs") ||
        ent.name.endsWith(".spec.js") ||
        ent.name.endsWith(".test.js") ||
        ent.name === "LICENSE" ||
        ent.name === "LICENCE" ||
        ent.name === "LICENSE.txt" ||
        ent.name === "CopyrightNotice.txt"
      ) {
        rmSafe(full);
      }
    }
  }
}

async function pruneAsarArchive(asarPath) {
  if (!asarPath || !fs.existsSync(asarPath)) {
    return null;
  }
  const asar = loadAsarModule();
  asar.uncacheAll();
  const beforeEntries = asar.listPackage(asarPath).length;
  const stageDir = path.join(path.dirname(asarPath), "_asar_diet_stage");
  rmSafe(stageDir);

  try {
    asar.extractAll(asarPath, stageDir);
    const nmDir = path.join(stageDir, "node_modules");

    if (fs.existsSync(nmDir)) {
      // 1. Prune modular lodash files while keeping CJS main bundle & metadata
      const lodashDir = path.join(nmDir, "lodash");
      if (fs.existsSync(lodashDir)) {
        const keepLodash = new Set(["index.js", "lodash.js", "package.json"]);
        for (const ent of fs.readdirSync(lodashDir)) {
          if (!keepLodash.has(ent)) {
            rmSafe(path.join(lodashDir, ent));
          }
        }
      }

      // 2. Remove unused @swc/helpers (zero runtime requires)
      rmSafe(path.join(nmDir, "@swc"));

      // 3. Prune build-only node-gyp/cacache artifacts inside duckdb
      const duckdbDir = path.join(nmDir, "duckdb");
      if (fs.existsSync(duckdbDir)) {
        for (const sub of [
          "node_modules",
          "scripts",
          "vendor",
          "Makefile",
          "binding.gyp.in",
          ".mocharc.json",
          "tsconfig.json",
        ]) {
          rmSafe(path.join(duckdbDir, sub));
        }
      }

      // 4. Prune CLI/install-time nested deps inside @mapbox/node-pre-gyp while keeping runtime nopt/npmlog/semver
      const preGypDir = path.join(nmDir, "@mapbox", "node-pre-gyp");
      if (fs.existsSync(preGypDir)) {
        rmSafe(path.join(preGypDir, "bin"));
        const preGypNm = path.join(preGypDir, "node_modules");
        if (fs.existsSync(preGypNm)) {
          const keepPreGypNm = new Set(["nopt", "npmlog", "are-we-there-yet", "gauge", "semver"]);
          for (const ent of fs.readdirSync(preGypNm)) {
            if (!keepPreGypNm.has(ent)) {
              rmSafe(path.join(preGypNm, ent));
            }
          }
        }
        const preGypLib = path.join(preGypDir, "lib");
        if (fs.existsSync(preGypLib)) {
          for (const cliSub of [
            "build.js",
            "clean.js",
            "configure.js",
            "info.js",
            "install.js",
            "package.js",
            "publish.js",
            "rebuild.js",
            "reinstall.js",
            "reveal.js",
            "testbinary.js",
            "testpackage.js",
            "unpublish.js",
          ]) {
            rmSafe(path.join(preGypLib, cliSub));
          }
        }
      }

      // 5. Remove duplicate nested reltab inside host-bridge
      rmSafe(path.join(nmDir, "host-bridge", "node_modules"));

      // 6. Prune CLI-only duplicates inside @apache-arrow/es2015-cjs while preserving tslib
      const arrowDir = path.join(nmDir, "@apache-arrow", "es2015-cjs");
      if (fs.existsSync(arrowDir)) {
        rmSafe(path.join(arrowDir, "bin"));
        const arrowNm = path.join(arrowDir, "node_modules");
        if (fs.existsSync(arrowNm)) {
          for (const ent of fs.readdirSync(arrowNm)) {
            if (ent !== "tslib") {
              rmSafe(path.join(arrowNm, ent));
            }
          }
          const tslibDir = path.join(arrowNm, "tslib");
          if (fs.existsSync(tslibDir)) {
            for (const f of ["tslib.html", "tslib.es6.html", "tslib.es6.js", "tslib.es6.mjs", "modules"]) {
              rmSafe(path.join(tslibDir, f));
            }
          }
        }
      }

      // 6b. Prune duplicate ESM / TS folders inside flatbuffers
      const flatbuffersDir = path.join(nmDir, "flatbuffers");
      if (fs.existsSync(flatbuffersDir)) {
        rmSafe(path.join(flatbuffersDir, "mjs"));
        rmSafe(path.join(flatbuffersDir, "ts"));
        rmSafe(path.join(flatbuffersDir, "js", "flatbuffers.min.js"));
      }

      // 7. Prune unused top-level build/CLI/archive/network packages
      for (const pkg of PRUNED_TOP_LEVEL_NODE_MODULES) {
        rmSafe(path.join(nmDir, pkg));
      }

      // 8. Prune __specs__, __tests__, .mjs, and redundant per-package LICENSE text files in node_modules
      pruneSpecAndEsmArtifacts(nmDir);

      // Clean any empty @scope directories
      for (const ent of fs.readdirSync(nmDir, { withFileTypes: true })) {
        if (ent.isDirectory() && ent.name.startsWith("@")) {
          const scopePath = path.join(nmDir, ent.name);
          if (fs.readdirSync(scopePath).length === 0) {
            rmSafe(scopePath);
          }
        }
      }

      // 9. Verify critical runtime modules resolve cleanly inside staged node_modules before repacking
      for (const criticalMod of [
        "reltab",
        "reltab-duckdb",
        "reltab-fs",
        "host-bridge",
        "lodash",
        "@apache-arrow/es2015-cjs",
        "@mapbox/node-pre-gyp",
        "duckdb",
        "duckdb-async",
        "fast-csv",
        "electron-log",
        "command-line-args",
        "command-line-usage",
        "console.table",
        "source-map-support/register",
        "loglevel",
      ]) {
        require.resolve(criticalMod, { paths: [nmDir] });
      }
    }

    asar.uncacheAll();
    await asar.createPackageWithOptions(stageDir, asarPath, { unpack: "*.node" });
    asar.uncacheAll();
  } finally {
    rmSafe(stageDir);
  }

  const afterEntries = asar.listPackage(asarPath).length;
  console.log(`[afterPack] ASAR Diet pruned entries: ${beforeEntries} -> ${afterEntries}`);
  if (afterEntries >= 1000) {
    throw new Error(`[afterPack] ASAR Diet budget exceeded: ${afterEntries} entries (target < 1000)`);
  }
  return { beforeEntries, afterEntries };
}

async function afterPack(context) {
  const platformName = context && context.packager && context.packager.platform
    ? context.packager.platform.name
    : "unknown";
  console.log(`[afterPack] Platform: ${platformName}`);

  if (platformName === "windows" && context && context.appOutDir) {
    const asarPath = path.join(context.appOutDir, "resources", "app.asar");
    if (fs.existsSync(asarPath)) {
      await pruneAsarArchive(asarPath);
    }

    const productFilename =
      (context.packager &&
        context.packager.appInfo &&
        context.packager.appInfo.productFilename) ||
      "Toad";
    const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
    if (fs.existsSync(exePath)) {
      const before = readElectronFuses(exePath);
      const after = patchElectronFuses(exePath, TARGET_FUSES);
      console.log(
        `[afterPack] Hardened Electron Fuses on ${path.basename(exePath)}: ${before.fuses} -> ${after.fuses}`
      );
    } else {
      console.warn(`[afterPack] Target Windows executable not found at ${exePath}`);
    }
  }
}

exports.default = afterPack;
exports.readElectronFuses = readElectronFuses;
exports.patchElectronFuses = patchElectronFuses;
exports.pruneAsarArchive = pruneAsarArchive;
exports.TARGET_FUSES = TARGET_FUSES;
