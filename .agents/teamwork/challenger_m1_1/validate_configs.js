const fs = require('fs');
const path = require('path');

function validate() {
  const root = 'd:\\Shared_UserData\\Downloads\\tad\\tauri\\project\\src-tauri';
  const confPath = path.join(root, 'tauri.conf.json');
  const capPath = path.join(root, 'capabilities', 'default.json');
  const cargoPath = path.join(root, 'Cargo.toml');

  console.log('=== Checking JSON Parsing ===');
  
  // 1. Check tauri.conf.json
  if (!fs.existsSync(confPath)) {
    console.error('FAIL: tauri.conf.json does not exist');
    process.exit(1);
  }
  let conf;
  try {
    const rawConf = fs.readFileSync(confPath, 'utf8');
    conf = JSON.parse(rawConf);
    console.log('PASS: tauri.conf.json parsed successfully as JSON');
  } catch (err) {
    console.error('FAIL: tauri.conf.json JSON parse error:', err.message);
    process.exit(1);
  }

  // 2. Check capabilities/default.json
  if (!fs.existsSync(capPath)) {
    console.error('FAIL: capabilities/default.json does not exist');
    process.exit(1);
  }
  let cap;
  try {
    const rawCap = fs.readFileSync(capPath, 'utf8');
    cap = JSON.parse(rawCap);
    console.log('PASS: capabilities/default.json parsed successfully as JSON');
  } catch (err) {
    console.error('FAIL: capabilities/default.json JSON parse error:', err.message);
    process.exit(1);
  }

  console.log('\n=== Validating tauri.conf.json fields ===');
  
  // Required root fields in Tauri v2
  const requiredRoot = ['productName', 'version', 'identifier'];
  for (const field of requiredRoot) {
    if (!conf[field]) {
      console.error(`FAIL: Missing required field "${field}" in tauri.conf.json`);
    } else {
      console.log(`PASS: field "${field}" = "${conf[field]}"`);
    }
  }

  // Build section
  if (!conf.build) {
    console.error('FAIL: Missing "build" object');
  } else {
    console.log('PASS: "build" object exists');
    console.log('  beforeDevCommand:', conf.build.beforeDevCommand);
    console.log('  devUrl:', conf.build.devUrl);
    console.log('  beforeBuildCommand:', conf.build.beforeBuildCommand);
    console.log('  frontendDist:', conf.build.frontendDist);
    if (!conf.build.frontendDist) console.error('FAIL: Missing build.frontendDist');
  }

  // App section
  if (!conf.app) {
    console.error('FAIL: Missing "app" object in Tauri v2');
  } else {
    console.log('PASS: "app" object exists');
    console.log('  withGlobalTauri:', conf.app.withGlobalTauri);
    console.log('  appDirectoriesOverride:', conf.app.appDirectoriesOverride);
    
    // Windows array
    if (!Array.isArray(conf.app.windows) || conf.app.windows.length === 0) {
      console.error('FAIL: conf.app.windows is missing or empty');
    } else {
      console.log(`PASS: conf.app.windows has ${conf.app.windows.length} window definition(s)`);
      const win = conf.app.windows[0];
      console.log('  label:', win.label);
      console.log('  title:', win.title);
      console.log('  width:', win.width);
      console.log('  height:', win.height);
      console.log('  minWidth:', win.minWidth);
      console.log('  minHeight:', win.minHeight);
      console.log('  theme:', win.theme);
      console.log('  visible:', win.visible);
      console.log('  dragDropEnabled:', win.dragDropEnabled);
    }

    // Security section
    if (!conf.app.security) {
      console.error('FAIL: conf.app.security is missing');
    } else {
      console.log('PASS: conf.app.security exists');
      console.log('  csp:', conf.app.security.csp);
      console.log('  capabilities:', conf.app.security.capabilities);
    }
  }

  // Bundle section
  if (!conf.bundle) {
    console.error('FAIL: Missing "bundle" object');
  } else {
    console.log('PASS: "bundle" object exists');
    console.log('  active:', conf.bundle.active);
    console.log('  targets:', conf.bundle.targets);
    console.log('  icon:', conf.bundle.icon);
    console.log('  windows:', conf.bundle.windows);
  }

  console.log('\n=== Validating capabilities/default.json fields ===');
  if (!cap.identifier) {
    console.error('FAIL: Missing "identifier" in capability');
  } else {
    console.log(`PASS: capability identifier = "${cap.identifier}"`);
  }
  if (!Array.isArray(cap.windows)) {
    console.error('FAIL: Missing "windows" array in capability');
  } else {
    console.log(`PASS: capability windows = ${JSON.stringify(cap.windows)}`);
  }
  if (!Array.isArray(cap.permissions)) {
    console.error('FAIL: Missing "permissions" array in capability');
  } else {
    console.log(`PASS: capability permissions count = ${cap.permissions.length}`);
    console.log('  Permissions:', cap.permissions);
  }

  // Check matching capability identifier
  if (conf.app && conf.app.security && Array.isArray(conf.app.security.capabilities)) {
    if (!conf.app.security.capabilities.includes(cap.identifier)) {
      console.error(`FAIL: tauri.conf.json capabilities list does not include "${cap.identifier}"`);
    } else {
      console.log(`PASS: tauri.conf.json references capability "${cap.identifier}"`);
    }
  }

  // Check window label match
  if (conf.app && Array.isArray(conf.app.windows) && conf.app.windows.length > 0) {
    const winLabel = conf.app.windows[0].label;
    if (!cap.windows.includes(winLabel) && !cap.windows.includes('*')) {
      console.error(`FAIL: capability windows does not match window label "${winLabel}"`);
    } else {
      console.log(`PASS: capability targets window "${winLabel}"`);
    }
  }
}

validate();
