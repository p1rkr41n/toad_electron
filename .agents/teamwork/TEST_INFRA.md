# E2E Test Infra: Toad v2.4.3

## Test Philosophy
- Opaque-box, requirement-driven test verification.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise + Real-World Workloads.
- Primary execution harness: `tests/deep_integration_qa.js` executed via Node v18:
  `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js`

## Feature Inventory Coverage (Suite JJ)
| # | Feature | Requirement | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Interaction) |
|---|---------|-------------|:-----------------:|:-----------------:|:--------------------:|
| 1 | Menu Item Cleanup & Add Files/Folder | R1 | JJ.1 | JJ.1 | JJ.1 |
| 2 | getRelativeParentDir Algorithm | R4 | JJ.2 | JJ.2 | JJ.2 |
| 3 | Strict 100% File-Name Search Filter | R3 | JJ.3 | JJ.3 | JJ.4 |
| 4 | Search Auto-Expand & Suppression | R3 | JJ.4 | JJ.4 | JJ.4 |
| 5 | Interactive Table 4-Column Sorting | R4 | JJ.5 | JJ.5 | JJ.5 |
| 6 | Interactive Table Column Filters | R4 | JJ.6 | JJ.6 | JJ.6 |
| 7 | Double-Click Inline Rename & Ledger | R2 | JJ.7 | JJ.7 | JJ.7 |
| 8 | Version 2.4.3 System-Wide Synchronization | R5 | JJ.8 | JJ.8 | JJ.8 |

## Target Thresholds
- Total tests: 200+ assertions (from baseline 192 passed).
- Baseline status: 192 passed, 0 failed.
- Target status: 100% pass rate (200+/200+ assertions).
- Performance: Execution time under 15 seconds.
