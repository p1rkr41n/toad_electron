# Forensic Audit Report — Auditor Fix: Round 2 Gate Verification

**Work Product**: `ProjectFilesTable.tsx`, `test_challenger_sidebar_stress.js`, Release Artifacts (`releases/Toad-2.5.1-x64-portable.exe`), Jujutsu Commit `3403c963`, Test Suites  
**Profile**: General Project (Development Mode)  
**Verdict**: **CLEAN**

---

## 1. Observation

### 1.1 Authentic Logic in `ProjectFilesTable.tsx`
- **File**: `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx`
- **Lines 351-360** (Mouse Move Delta & Clamping Logic):
  ```typescript
  const onMouseMove = (moveEvt: MouseEvent) => {
    if (!draggingRef.current) return;
    const rawDelta = moveEvt.clientX - draggingRef.current.startX;
    const delta = rawDelta === -Infinity ? -Infinity : (Number.isFinite(rawDelta) ? rawDelta : 0);
    const newWidth = Math.max(MIN_COL_WIDTH, draggingRef.current.startWidth + delta);
    setColWidths((prev) => ({
      ...prev,
      [draggingRef.current!.col]: newWidth,
    }));
  };
  ```
  *Empirical finding*: Genuine arithmetic fallback logic. `Number.isFinite(rawDelta)` ensures `NaN` or `undefined` gracefully evaluates to `0` instead of corrupting column width state; `-Infinity` correctly forces clamping to `MIN_COL_WIDTH` (45px). Zero hardcoded mock bypasses or facade returns.
- **Lines 505-508, 549-552, 593-596, 637-640** (Event Isolation on `.col-resizer-handle`):
  Each of the 4 column resizers (`name`, `dir`, `size`, `status`) contains:
  ```tsx
  onClick={(e) => {
    e.stopPropagation();
    e.preventDefault();
  }}
  ```
  *Empirical finding*: All 4 resizer handles isolate click bubbling, preventing accidental invocation of the parent `<th>` click handler (`toggleColumnFilter`).

### 1.2 Release Artifacts & Zero-Duplicate Binary Verification
- **Directory**: `releases/`
  - Canonical executable: `releases/Toad-2.5.1-x64-portable.exe` (75,892,176 bytes = 72.38 MB, strictly within the < 75 MB limit).
  - Canonical archive: `releases/Toad-2.5.1-x64-portable.zip` (75,897,453 bytes = 72.38 MB).
  - SHA-256 verification:
    - `Toad-2.5.1-x64-portable.exe`: `B9360C9D9DB95A0A933F8D62D2E0108C83422ADAEE98B766982403C430E861C4`
    - `Toad-2.5.1-x64-portable.zip`: `9994C7978ABDABA77D450AE9C4B270D11F8571AF3DB8378F7B59A9C3A31EAC56`
    - Matches `releases/SHA256SUMS.txt` 100%.
  - Zero duplicate historical binaries (no `Toad 2.0.x.exe`, `Toad-2.5.0.exe`, etc.) in `releases/`.
- **Root Directory**: `.`
  - Single local executable: `Toad.exe` (75,892,176 bytes = 72.38 MB).
  - Zero extraneous or historical `.exe` binaries found.

### 1.3 Jujutsu VCS Commit Conformance
- **Command**: `jj show 3403c963`
- **Output**:
  ```text
  Commit ID: 3403c9639ef8e1a88c3d03c37e4065a783958adb
  Change ID: kpoxxopuxsttnvwoymwwvokkwpqpqkzu
  Author   : HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com> (2026-11-04 23:06:32)
  Committer: HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com> (2026-11-04 23:32:10)

      fix(viewer): guard ProjectFilesTable delta with isFinite and shield col-resizer-handle click events
  ```
  *Empirical finding*:
  - Identity strictly matches `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`.
  - Zero personal, corporate, or enterprise credentials/identities leaked.
  - Commit message is strictly concise English.

### 1.4 Independent Test Suite Execution Results
- **Challenger Stress Test**:
  - Command: `.\node-v18.20.4-win-x64\node.exe tests/qa/test_challenger_sidebar_stress.js`
  - Result: **24/24 PASSED (100%)**, `RECOMMENDED VERDICT: APPROVE`, exit code 0.
- **Unit Test**:
  - Command: `.\node-v18.20.4-win-x64\node.exe tests/unit/test_project_files_table_wrap_resize.js`
  - Result: **15/15 PASSED (100%)**, exit code 0.
- **Runtime Smoke Test**:
  - Command: `.\node-v18.20.4-win-x64\node.exe tests/smoke_test.js`
  - Result: `Portable Exe verified: Toad.exe (72.38 MB)`, `Binary PE Header verified valid: 'MZ'`, `Main process bootstrap completed cleanly without uncaught exceptions`, **100% HEALTHY**, exit code 0.
- **Unified Test Runner**:
  - Command: `.\node-v18.20.4-win-x64\node.exe run_tests.js --all`
  - Result: **18/18 Test Suites Passed Cleanly (100% HEALTHY)** across 46.33 seconds, exit code 0.

---

## 2. Logic Chain

1. **Observation 1.1** demonstrates that `ProjectFilesTable.tsx` handles non-finite inputs by falling back to `0` delta and handles `-Infinity` by preserving it into `Math.max(MIN_COL_WIDTH, ...)`, mathematically preventing `NaN` CSS widths while strictly preserving minimum width clamping (45px). Additionally, all 4 resizer handles explicitly call `e.stopPropagation()` and `e.preventDefault()` on click, eliminating filter popup leakage.
2. **Observation 1.2** confirms that binary outputs comply with the Zero-Duplicate Binary Storage policy and the strict < 75 MB size budget (72.38 MB). Integrity of the distribution artifacts is verified by exact match with `SHA256SUMS.txt`.
3. **Observation 1.3** confirms that Jujutsu commit `3403c963` adheres to the release branding and privacy policies: authored by `HelloKittyXamKinLung <p1rkr41n@users.noreply.github.com>`, with no corporate leaks, and written in English.
4. **Observation 1.4** verifies that independent test suites (adversarial stress suite, unit tests, runtime smoke test, and the entire 18-suite test harness) pass with 100% success rate without runtime crashes or regressions.
5. **Conclusion**: All 4 forensic checks pass unconditionally. The implementation contains genuine logic and zero integrity violations.

---

## 3. Caveats

- **No Caveats**: All checks were executed directly with empirical tool outputs; no assumptions or unverified claims were accepted.

---

## 4. Conclusion

**Verdict: CLEAN**

The work product demonstrates genuine implementation, robust boundary clamping, complete event isolation across all column headers, flawless release packaging (< 75 MB, zero duplicates), full VCS compliance, and 100% test pass rate across all suites. The work product is certified and ready for gate sign-off.

---

## 5. Verification Method

To independently reproduce this verification:

1. **Static Source Inspection**:
   Inspect `tad-master/packages/toadviewer/src/components/ProjectFilesTable.tsx` lines 351-360 and 500-645 for `Number.isFinite(rawDelta)` and all 4 `onClick` handlers.

2. **Run Challenger Stress Suite**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/qa/test_challenger_sidebar_stress.js
   ```
   *Expected output*: `24/24 PASSED`, exit code 0.

3. **Run Unit Test Suite**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/unit/test_project_files_table_wrap_resize.js
   ```
   *Expected output*: `15/15 PASSED`, exit code 0.

4. **Run Smoke Test**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe tests/smoke_test.js
   ```
   *Expected output*: `100% HEALTHY`, exit code 0.

5. **Run Unified Runner**:
   ```powershell
   .\node-v18.20.4-win-x64\node.exe run_tests.js --all
   ```
   *Expected output*: `ALL TEST SUITES PASSED CLEANLY (100% HEALTHY)`, exit code 0.

6. **Verify Binary and VCS Integrity**:
   ```powershell
   powershell -Command "Get-FileHash -Algorithm SHA256 .\releases\Toad-2.5.1-x64-portable.exe"
   & "C:\Users\huydq\.cargo\bin\jj.exe" show 3403c963
   ```
