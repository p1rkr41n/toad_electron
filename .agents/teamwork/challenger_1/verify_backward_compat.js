/**
 * Backward Compatibility Empirical Verification Script
 * Challenger 1: Automated Test Suite & Compatibility Verifier
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../../..");

// Simulation of openParamsDSPath logic from electronRenderMain.tsx:
function openParamsDSPath(openParams) {
  let targetDSPath = null;
  let viewParams = null;
  switch (openParams.openType) {
    case "fspath": {
      const connKey = {
        providerName: "localfs",
        resourceId: openParams.path,
      };
      targetDSPath = { sourceId: connKey, path: ["."] };
      break;
    }
    case "dspath": {
      targetDSPath = openParams.dsPath;
      break;
    }
    case "toad":
    case "tad": {
      const parsedFileState = JSON.parse(openParams.fileContents);
      const savedFileState = parsedFileState.contents;
      // attempt to migrate from legacy version 1 format (or if targetPath is present without dsPath):
      if (
        parsedFileState.tadFileFormatVersion === 1 ||
        Boolean(savedFileState?.targetPath && !savedFileState?.dsPath)
      ) {
        const rawTargetPath = savedFileState.targetPath;
        const connKey = {
          providerName: "localfs",
          resourceId: rawTargetPath,
        };
        targetDSPath = { sourceId: connKey, path: ["."] };
      } else {
        targetDSPath = savedFileState.dsPath;
      }
      viewParams = savedFileState.viewParams;
      break;
    }
    case "empty": {
      targetDSPath = null;
      break;
    }
    default:
      throw new Error("Unknown openType: " + openParams.openType);
  }
  return [targetDSPath, viewParams];
}

// Simulation of serialize logic from appWindow.ts:
const TOAD_FILE_FORMAT_VERSION = 2;
const TAD_FILE_FORMAT_VERSION = 2;

function serialize(contents) {
  const versionedObject = {
    toadFileFormatVersion: TOAD_FILE_FORMAT_VERSION,
    tadFileFormatVersion: TAD_FILE_FORMAT_VERSION,
    contents,
  };
  return JSON.stringify(versionedObject, null, 2);
}

// Simulation of encodeFileOpenParams from appWindow.ts:
function encodeFileOpenParams(targetPath) {
  let openParams;
  const ext = targetPath ? path.extname(targetPath).toLowerCase() : "";

  if (ext === ".toad") {
    const fileContents = fs.readFileSync(targetPath, "utf8");
    openParams = {
      openType: "toad",
      fileContents,
      fileBaseName: path.basename(targetPath),
    };
  } else if (ext === ".tad") {
    const fileContents = fs.readFileSync(targetPath, "utf8");
    openParams = {
      openType: "tad",
      fileContents,
      fileBaseName: path.basename(targetPath),
    };
  } else {
    openParams = {
      openType: "fspath",
      path: targetPath,
    };
  }
  return openParams;
}

function runBackwardCompatibilityTests() {
  console.log("======================================================================");
  console.log("  EMPIRICAL CHALLENGER: WORKSPACE BACKWARD COMPATIBILITY TEST HARNESS");
  console.log("======================================================================\n");

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✓ [PASS] ${name}`);
    } catch (e) {
      console.error(`  ✗ [FAIL] ${name}: ${e.message}`);
    }
  }

  // TC-1: Real legacy .tad workspace from examples
  const legacyTadPath = path.resolve(
    ROOT_DIR,
    "tad-master/packages/toad-app/examples/movie-grossByCountryDirector.tad"
  );

  test("TC-1: Load and parse real repository legacy .tad workspace (tadFileFormatVersion: 1)", () => {
    assert(fs.existsSync(legacyTadPath), `Legacy example file must exist: ${legacyTadPath}`);
    const openParams = encodeFileOpenParams(legacyTadPath);
    assert.strictEqual(openParams.openType, "tad");
    assert.strictEqual(openParams.fileBaseName, "movie-grossByCountryDirector.tad");

    const [targetDSPath, viewParams] = openParamsDSPath(openParams);
    assert(targetDSPath, "targetDSPath must be constructed");
    assert.strictEqual(targetDSPath.sourceId.providerName, "localfs");
    assert.strictEqual(targetDSPath.sourceId.resourceId, "/Users/antony/data/movie_metadata.csv");
    assert.deepStrictEqual(targetDSPath.path, ["."]);
    assert(viewParams, "viewParams must be preserved");
    assert.deepStrictEqual(viewParams.vpivots, ["country", "director_name"]);
  });

  // TC-2: Second real legacy .tad workspace
  const legacyTadPath2 = path.resolve(
    ROOT_DIR,
    "tad-master/packages/toad-app/examples/movie-grossByDirectorWithFilter.tad"
  );

  test("TC-2: Load and parse second legacy .tad workspace with filters", () => {
    assert(fs.existsSync(legacyTadPath2), `Legacy example file must exist: ${legacyTadPath2}`);
    const openParams = encodeFileOpenParams(legacyTadPath2);
    assert.strictEqual(openParams.openType, "tad");

    const [targetDSPath, viewParams] = openParamsDSPath(openParams);
    assert(targetDSPath, "targetDSPath must be constructed");
    assert.strictEqual(targetDSPath.sourceId.providerName, "localfs");
    assert.strictEqual(targetDSPath.sourceId.resourceId, "/Users/antony/data/movie_metadata.csv");
    assert(viewParams, "viewParams must be preserved");
  });

  // TC-3: Serialize modern .toad workspace (v2 format)
  let serializedV2;
  const sampleContents = {
    dsPath: {
      sourceId: {
        providerName: "localfs",
        resourceId: "D:/Data/sales_2026.parquet",
      },
      path: ["sales_2026.parquet"],
    },
    viewParams: {
      displayColumns: ["order_id", "revenue", "customer_name"],
      vpivots: ["region"],
      sortKey: [["revenue", false]],
    },
  };

  test("TC-3: Serialize modern workspace produces dual version headers (toadFileFormatVersion: 2, tadFileFormatVersion: 2)", () => {
    serializedV2 = serialize(sampleContents);
    const parsed = JSON.parse(serializedV2);
    assert.strictEqual(parsed.toadFileFormatVersion, 2, "toadFileFormatVersion must be 2");
    assert.strictEqual(parsed.tadFileFormatVersion, 2, "tadFileFormatVersion must be 2 for backward compat");
    assert.deepStrictEqual(parsed.contents.dsPath, sampleContents.dsPath);
    assert.deepStrictEqual(parsed.contents.viewParams, sampleContents.viewParams);
  });

  // TC-4: Deserialize modern .toad workspace
  test("TC-4: Deserialize modern .toad workspace with openType='toad'", () => {
    const openParams = {
      openType: "toad",
      fileContents: serializedV2,
      fileBaseName: "sales_2026.toad",
    };

    const [targetDSPath, viewParams] = openParamsDSPath(openParams);
    assert(targetDSPath, "targetDSPath must be resolved");
    assert.strictEqual(targetDSPath.sourceId.providerName, "localfs");
    assert.strictEqual(targetDSPath.sourceId.resourceId, "D:/Data/sales_2026.parquet");
    assert.deepStrictEqual(targetDSPath.path, ["sales_2026.parquet"]);
    assert.deepStrictEqual(viewParams.vpivots, ["region"]);
  });

  // TC-5: Deserialize modern workspace saved with .tad extension
  test("TC-5: Deserialize modern workspace opened via .tad extension (backward compatibility)", () => {
    const openParams = {
      openType: "tad",
      fileContents: serializedV2,
      fileBaseName: "sales_2026.tad",
    };

    const [targetDSPath, viewParams] = openParamsDSPath(openParams);
    assert(targetDSPath, "targetDSPath must be resolved");
    assert.deepStrictEqual(targetDSPath.path, ["sales_2026.parquet"]);
    assert.deepStrictEqual(viewParams.displayColumns, ["order_id", "revenue", "customer_name"]);
  });

  // TC-6: Migration fallback: v2 format but missing dsPath and with targetPath
  test("TC-6: Resilient migration fallback when file has targetPath without dsPath", () => {
    const hybridWorkspace = {
      toadFileFormatVersion: 2,
      tadFileFormatVersion: 2,
      contents: {
        targetPath: "C:/Projects/legacy_migration.csv",
        viewParams: { vpivots: ["category"] },
      },
    };
    const openParams = {
      openType: "toad",
      fileContents: JSON.stringify(hybridWorkspace),
      fileBaseName: "hybrid.toad",
    };

    const [targetDSPath, viewParams] = openParamsDSPath(openParams);
    assert(targetDSPath, "targetDSPath must migrate targetPath to DataSourcePath");
    assert.strictEqual(targetDSPath.sourceId.resourceId, "C:/Projects/legacy_migration.csv");
    assert.deepStrictEqual(targetDSPath.path, ["."]);
  });

  // TC-7: Negative test: Malformed JSON throws SyntaxError
  test("TC-7: Adversarial check - malformed JSON throws SyntaxError", () => {
    const openParams = {
      openType: "toad",
      fileContents: "{ corrupted JSON ...",
      fileBaseName: "broken.toad",
    };
    assert.throws(() => openParamsDSPath(openParams), SyntaxError);
  });

  console.log("\n======================================================================");
  console.log(`  COMPATIBILITY VERIFICATION RESULT: ${passed}/${total} PASSED`);
  console.log("======================================================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

runBackwardCompatibilityTests();
