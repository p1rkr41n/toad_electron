# Workspace Guidelines & Instructions

## Version Control: Jujutsu (`jj`) as Default VCS
- Jujutsu (`jj`) is the default local version control system for this and subsequent projects.
- `jj` executable location:
  - System Cargo Bin: `C:\Users\huydq\.cargo\bin\jj.exe`
  - Workspace Tool: `tools/jj/jj.exe`
- Workflow conventions:
  - Repositories are initialized with `jj git init --colocate` to maintain seamless dual compatibility with Git.
  - Track changes using `jj status`, `jj diff`, `jj log`, `jj describe`, and `jj commit`.
  - Always exclude large intermediate artifacts (`target/`, `node_modules/`, `dist/`, `release/`, binaries) in `.gitignore`.

## Packaging & Binary De-duplication Policy
- **Zero-Duplicate Binary Storage**: Scripts (`dist_package.ps1`, `package_release.ps1`) must NEVER copy or duplicate the newly built binary across historical version names (e.g. `Toad 2.0.x.exe`, `Toad 2.1.x.exe`).
- Canonical outputs are strictly:
  - Root: `Toad.exe` (single local development/test executable).
  - Releases: `releases/Toad-<version>-x64-portable.exe` and `releases/Toad-<version>-x64-portable.zip`.
- All duplicate historical binaries must remain pruned.

## Bugfix & Patch Versioning Standard
- **No Overwriting Past Versions**: Never overwrite an existing git tag, GitHub release, or published version.
- **Auto 4th-Digit Patch Increment (`x.x.x.1++`)**: When a bugfix or patch is implemented without an explicit version specified by the user, if base version `x.x.x` already exists, automatically increment to `x.x.x.1`, `x.x.x.2`, etc. (e.g., `2.3.5.1`, `2.3.5.2`) using `tools/bump_version.js`.
