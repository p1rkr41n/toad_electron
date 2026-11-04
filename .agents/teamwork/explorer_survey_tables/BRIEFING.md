# BRIEFING — 2026-11-04T18:05:00Z

## Mission
Investigate the existing frontend components and source files in `tad-master/packages/toadviewer/` across CellLineCalculator, GridOverlayBus, ProjectFilesTable, DataGrid, RegexDialog, NestedFieldsTable, and styling/SCSS files to produce an exhaustive survey report for the 20-engineer implementation squads.

## 🔒 My Identity
- Archetype: explorer
- Roles: Teamwork explorer (read-only investigation, code surveyor)
- Working directory: d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_survey_tables\
- Original parent: be854d41-8a3e-4b29-a7b7-70b0d33d645a
- Milestone: explorer_survey_tables

## 🔒 Key Constraints
- Read-only investigation — do NOT implement or modify source code
- Do NOT run builds
- Survey exact line numbers, code signatures, DOM structures, CSS classes, lifecycle hooks
- Write analysis to analysis.md and 5-component handoff report to handoff.md

## Current Parent
- Conversation ID: be854d41-8a3e-4b29-a7b7-70b0d33d645a
- Updated: not yet

## Investigation State
- **Explored paths**: `src/utils/CellLineCalculator.ts`, `src/utils/GridOverlayBus.ts`, `src/utils/`, `src/components/ProjectFilesTable.tsx`, `less/sidebar.less`, `src/components/DataGrid.tsx`, `src/slickgrid.scss`, `src/components/RegexDialog.tsx`, `src/components/NestedFieldsTable.tsx`, `less/nested-dialog.less`, `tests/run_tests.js`.
- **Key findings**:
  1. `CellLineCalculator.ts` is empty (0 bytes); `GridOverlayBus.ts` is absent.
  2. `ProjectFilesTable.tsx` and `sidebar.less` currently apply `.is-selected` with hardcoded `height: auto !important` and `180px` max-height without calculating lines or distinguishing flat single-line selections.
  3. `DataGrid.tsx` uses naive `> 28` char check in `tryExpandCell`, missing click outside, re-click toggle, and bus integration. `slickgrid.scss` has hardcoded `180px` and zero `body.bp4-overlay-open` highlight suppression rules.
  4. `RegexDialog.tsx` has `#ntab-nested` on header tabs and lacks `nested_json` in `#minFormatSelect`. `#btn-switch-nested` is present and needs removal. `handleApply` only checks `mode === "nested_json"`. Dialog open lifecycle has no active cell reset.
- **Unexplored areas**: None within the assigned survey tasks.

## Key Decisions Made
- Fully documented all line numbers, DOM IDs, CSS selectors, and exact insertion points in `analysis.md`.
- Formulated the 5-component handoff report in `handoff.md`.

## Artifact Index
- analysis.md — Exhaustive survey analysis report covering all 4 tasks
- handoff.md — 5-component handoff report
- progress.md — Liveness heartbeat tracker
