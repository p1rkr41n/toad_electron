import json
import os
import sys

def validate():
    root = r"d:\Shared_UserData\Downloads\tad\tauri\project\src-tauri"
    conf_path = os.path.join(root, "tauri.conf.json")
    cap_path = os.path.join(root, "capabilities", "default.json")
    cargo_path = os.path.join(root, "Cargo.toml")

    print("=== Checking JSON Parsing ===")
    
    # 1. Parse tauri.conf.json
    if not os.path.exists(conf_path):
        print("FAIL: tauri.conf.json does not exist")
        sys.exit(1)
    try:
        with open(conf_path, "r", encoding="utf-8") as f:
            conf = json.load(f)
        print("PASS: tauri.conf.json parsed successfully as JSON")
    except Exception as e:
        print(f"FAIL: tauri.conf.json JSON parse error: {e}")
        sys.exit(1)

    # 2. Parse capabilities/default.json
    if not os.path.exists(cap_path):
        print("FAIL: capabilities/default.json does not exist")
        sys.exit(1)
    try:
        with open(cap_path, "r", encoding="utf-8") as f:
            cap = json.load(f)
        print("PASS: capabilities/default.json parsed successfully as JSON")
    except Exception as e:
        print(f"FAIL: capabilities/default.json JSON parse error: {e}")
        sys.exit(1)

    print("\n=== Validating tauri.conf.json fields ===")
    
    # Check schema
    schema = conf.get("$schema")
    print(f"Schema: {schema}")
    if schema != "https://schema.tauri.app/config/2":
        print(f"WARN: Schema is {schema}, expected https://schema.tauri.app/config/2")
    else:
        print("PASS: Schema matches Tauri v2 configuration schema")

    # Required root fields in Tauri v2
    required_root = ["productName", "version", "identifier"]
    for field in required_root:
        val = conf.get(field)
        if not val:
            print(f"FAIL: Missing required field '{field}' in tauri.conf.json")
        else:
            print(f"PASS: field '{field}' = '{val}'")

    # Build section
    build = conf.get("build")
    if not build:
        print("FAIL: Missing 'build' object")
    else:
        print("PASS: 'build' object exists")
        print(f"  beforeDevCommand: {build.get('beforeDevCommand')}")
        print(f"  devUrl: {build.get('devUrl')}")
        print(f"  beforeBuildCommand: {build.get('beforeBuildCommand')}")
        print(f"  frontendDist: {build.get('frontendDist')}")
        if not build.get("frontendDist"):
            print("FAIL: Missing build.frontendDist")

    # App section
    app = conf.get("app")
    if not app:
        print("FAIL: Missing 'app' object in Tauri v2")
    else:
        print("PASS: 'app' object exists")
        print(f"  withGlobalTauri: {app.get('withGlobalTauri')}")
        print(f"  appDirectoriesOverride: {app.get('appDirectoriesOverride')}")
        
        # Windows array
        windows = app.get("windows")
        if not isinstance(windows, list) or len(windows) == 0:
            print("FAIL: app.windows is missing or empty")
        else:
            print(f"PASS: app.windows has {len(windows)} window definition(s)")
            win = windows[0]
            print(f"  label: {win.get('label')}")
            print(f"  title: {win.get('title')}")
            print(f"  width: {win.get('width')}")
            print(f"  height: {win.get('height')}")
            print(f"  minWidth: {win.get('minWidth')}")
            print(f"  minHeight: {win.get('minHeight')}")
            print(f"  theme: {win.get('theme')}")
            print(f"  visible: {win.get('visible')}")
            print(f"  dragDropEnabled: {win.get('dragDropEnabled')}")

        # Security section
        security = app.get("security")
        if not security:
            print("FAIL: app.security is missing")
        else:
            print("PASS: app.security exists")
            print(f"  csp: {security.get('csp')}")
            print(f"  freezePrototype: {security.get('freezePrototype')}")
            print(f"  capabilities: {security.get('capabilities')}")

    # Bundle section
    bundle = conf.get("bundle")
    if not bundle:
        print("FAIL: Missing 'bundle' object")
    else:
        print("PASS: 'bundle' object exists")
        print(f"  active: {bundle.get('active')}")
        print(f"  targets: {bundle.get('targets')}")
        print(f"  icon: {bundle.get('icon')}")
        print(f"  windows: {bundle.get('windows')}")

    print("\n=== Validating capabilities/default.json fields ===")
    cap_schema = cap.get("$schema")
    print(f"Capability Schema: {cap_schema}")
    if cap_schema != "https://schema.tauri.app/config/2/capability":
        print(f"WARN: Capability schema is {cap_schema}")
    else:
        print("PASS: Capability schema matches Tauri v2 capability schema")

    cap_id = cap.get("identifier")
    if not cap_id:
        print("FAIL: Missing 'identifier' in capability")
    else:
        print(f"PASS: capability identifier = '{cap_id}'")

    cap_windows = cap.get("windows")
    if not isinstance(cap_windows, list):
        print("FAIL: Missing 'windows' array in capability")
    else:
        print(f"PASS: capability windows = {cap_windows}")

    permissions = cap.get("permissions")
    if not isinstance(permissions, list):
        print("FAIL: Missing 'permissions' array in capability")
    else:
        print(f"PASS: capability permissions count = {len(permissions)}")

    # Check matching capability identifier
    if app and security and isinstance(security.get("capabilities"), list):
        if cap_id not in security.get("capabilities"):
            print(f"FAIL: tauri.conf.json capabilities list does not include '{cap_id}'")
        else:
            print(f"PASS: tauri.conf.json references capability '{cap_id}'")

    # Check window label match
    if app and isinstance(app.get("windows"), list) and len(app.get("windows")) > 0:
        win_label = app["windows"][0].get("label")
        if win_label not in cap_windows and "*" not in cap_windows:
            print(f"FAIL: capability windows does not match window label '{win_label}'")
        else:
            print(f"PASS: capability targets window '{win_label}'")

    print("\n=== Checking Permissions against Cargo.toml Dependencies ===")
    with open(cargo_path, "r", encoding="utf-8") as f:
        cargo_content = f.read()

    # Plugins in Cargo.toml vs permissions in capabilities
    expected_plugins = {
        "tauri-plugin-dialog": "dialog",
        "tauri-plugin-fs": "fs",
        "tauri-plugin-opener": "opener",
        "tauri-plugin-clipboard-manager": "clipboard-manager",
        "tauri-plugin-window-state": "window-state",
    }
    for plugin_crate, perm_prefix in expected_plugins.items():
        if plugin_crate in cargo_content:
            has_perm = any(p.startswith(f"{perm_prefix}:") for p in permissions)
            if has_perm:
                print(f"PASS: {plugin_crate} is accompanied by permissions ({perm_prefix}:*)")
            else:
                print(f"WARN: {plugin_crate} in Cargo.toml but no permissions starting with {perm_prefix}:")
        else:
            print(f"WARN: {plugin_crate} not found in Cargo.toml")

if __name__ == "__main__":
    validate()
