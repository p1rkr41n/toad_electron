# Dispatch: Milestone 3 Fix Explorer 2 (UNC Path Normalization Investigation)

## Identity & Role
- **Archetype**: `teamwork_explorer`
- **Role**: Forensics Path Normalization Fix Explorer 2
- **Working Directory**: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_fix_2\`
- **Parent Conversation ID**: `07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d`

## Context & Inputs
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m3_2\handoff.md` (Defect Finding 2 & 4)
- Source file: `tauri/project/src-tauri/src/engine/query_compiler.rs` (lines 708-735, 795-805)

## Problem to Investigate
In `query_compiler.rs`:
1. `eff_lhs` uses `REGEXP_REPLACE(col::VARCHAR, '[\\/]+', '/', 'g')`, which collapses consecutive backslashes into a single slash (e.g. `\\192.168.1.1` -> `/192.168.1.1`).
2. `norm_rhs` in `EQ` and `NEQ` uses `.replace('\\', "/")`, which converts `\\` to `//` without collapsing.
3. As a result, equality comparisons fail for Windows UNC network paths (`'/192.168.1.1' = '//192.168.1.1' -> FALSE`).
4. Dead code in `escape_ilike_term`: `has_slashes` is true if `term` contains `\`, making `else` branch unreachable.

## Task
1. Investigate how to normalize both LHS and RHS symmetrically so Windows UNC paths, local paths (`C:\Windows`), and mixed slashes match consistently across `EQ`, `NEQ`, `BEGINS`, `ENDS`, `CONTAINS`.
2. Recommend the exact fix for `norm_rhs` and `escape_ilike_term`.
3. Provide verification test cases.
4. Write `handoff.md` and notify parent via send_message.


## 2026-11-04T21:42:00Z
You are explorer_m3_fix_2, assigned to investigate Windows UNC path normalization and pattern escaping in Milestone 3.
Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_fix_2\
Parent conversation ID: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d

Read your dispatch instructions: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m3_fix_2\DISPATCH.md`
Context:
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_m3_2\handoff.md` (Finding 2 & 4)
- `tauri/project/src-tauri/src/engine/query_compiler.rs`

Investigate symmetrical normalization for LHS and RHS across Windows UNC paths, local paths, and mixed slashes in EQ, NEQ, BEGINS, ENDS, CONTAINS. Deliver your report at `handoff.md` and notify parent via send_message.
