# Version Control Standard: Jujutsu (`jj`) Default

## Behavioral Guidelines
- For version control across projects, Jujutsu (`jj`) is the default local VCS.
- The `jj` executable is installed at:
  - System Cargo Bin: `C:\Users\huydq\.cargo\bin\jj.exe`
  - Project local tools: `tools/jj/jj.exe`
- When initializing or working in any repository:
  - Use `jj git init --colocate` for git-compatible repositories.
  - Use `jj status`, `jj log`, `jj describe`, `jj new`, `jj git push` for daily change tracking.
  - Ensure large build artifact directories (such as `target/`, `node_modules/`, `dist/`, `release/`) are ignored in `.gitignore` or configured with `snapshot.max-new-file-size`.
