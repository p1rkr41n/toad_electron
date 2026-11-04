# DISPATCH — Worker Fix: ProjectFilesTable Remediation (Round 2)

Read `ORIGINAL_REQUEST.md` at:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
Read the adversarial challenge report at:
`d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_2\handoff.md`

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership
You EXCLUSIVELY own and modify:
- `d:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer\src\components\ProjectFilesTable.tsx`
- `d:\Shared_UserData\Downloads\tad\tests\qa\test_challenger_sidebar_stress.js` (if needed to verify 24/24 PASS)
- `d:\Shared_UserData\Downloads\tad\tests\unit\test_project_files_table_wrap_resize.js`

## Specific Defect Fixes in `ProjectFilesTable.tsx`
1. **Defect A: NaN Delta Protection**:
   In `onMouseMove`:
   ```typescript
   const onMouseMove = (moveEvt: MouseEvent) => {
     if (!draggingRef.current) return;
     const rawDelta = moveEvt.clientX - draggingRef.current.startX;
     const delta = Number.isFinite(rawDelta) ? rawDelta : 0;
     const newWidth = Math.max(MIN_COL_WIDTH, draggingRef.current.startWidth + delta);
     setColWidths((prev) => ({
       ...prev,
       [draggingRef.current!.col]: newWidth,
     }));
   };
   ```
2. **Defect B: Missing `onClick` Propagation Shield on `.col-resizer-handle`**:
   Add `onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}` to all 4 `.col-resizer-handle` elements (`name`, `dir`, `size`, `status`):
   ```tsx
   <div
     className="col-resizer-handle"
     title="Drag to resize, double-click to auto-fit"
     onMouseDown={(e) => handleResizeMouseDown("name", e)}
     onDoubleClick={(e) => handleAutoFit("name", e)}
     onClick={(e) => {
       e.stopPropagation();
       e.preventDefault();
     }}
   />
   ```
3. Run:
   - `node tests/qa/test_challenger_sidebar_stress.js` (must pass 24/24!)
   - `node tests/unit/test_project_files_table_wrap_resize.js` (must pass 15/15!)
   - `npm run build` in `tad-master/packages/toadviewer`
   - `dist_package.ps1` and `package_release.ps1`
   - `node run_tests.js --all`
   - Jujutsu commit under `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.

Write handoff report to: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_fix\handoff.md`.


## 2026-11-04T16:19:05Z
You are the teamwork_worker for ProjectFilesTable Remediation (Round 2).
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_fix
Read your task dispatch file at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_fix\DISPATCH.md
Read the authoritative user request at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
Read the Challenger 2 findings at: d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_2\handoff.md

Apply the two specific drop-in fixes to ProjectFilesTable.tsx:
1. Number.isFinite guard on delta in onMouseMove.
2. onClick e.stopPropagation and e.preventDefault on all 4 .col-resizer-handle elements.
Verify with:
- node tests/qa/test_challenger_sidebar_stress.js (must pass 24/24)
- node tests/unit/test_project_files_table_wrap_resize.js (must pass 15/15)
- npm run build in toadviewer
- dist_package.ps1 and package_release.ps1
- node run_tests.js --all
- Create Jujutsu commit under HelloKittyXamKinLung.

Write your complete handoff report to: d:\Shared_UserData\Downloads\tad\.agents\teamwork\worker_fix\handoff.md
When finished, notify me using send_message.
