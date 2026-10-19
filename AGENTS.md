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
