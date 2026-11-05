# Dispatch: explorer_m6_grid

## Context & Objectives
You are `explorer_m6_grid` (Squad 6: SlickGrid, Formatting & Filter UI Explorer).
Your task is to explore and plan the porting of the virtualized SlickGrid, dynamic auto-wrap column calculation, `GridOverlayBus` glow suppression, pivot table, and ArcSight ESM filter.

## Mandatory Reading
- Original User Request: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- Project Master Plan: `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- Frontend sources: `d:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer`

## Investigation Questions
1. SlickGrid data model and virtualization:
   - How does `toadviewer` populate SlickGrid rows from Arrow RecordBatches / reltab data models?
   - How are column headers, dark theme CSS, and cell formatters wired?
2. Dynamic auto-wrap column calculation (F26):
   - Formula:
     * $N \le 1$: flat 24px
     * $2 \le N \le 5$: $N \times 17\text{px} + 8\text{px}$
     * $N > 5$: capped at 93px
   - Where in the grid column layout calculation or row height provider is this implemented?
3. Active cell glow suppression behind modal overlays (`GridOverlayBus` - F27):
   - How does `GridOverlayBus` emit and listen to overlay open/close events?
   - How is the active cell focus glow CSS class suppressed when modal dialogs (preferences, open file, pivot config) are opened?
4. ArcSight ESM filter & pivot UI condition tree (F28):
   - How are ArcSight ESM filter operators (`EQ`, `NEQ`, `CONTAINS`, `STARTS_WITH`, `IN`, `AND`, `OR`, `NOT`) built in the UI and converted into `QueryExpJson`?
   - How is the pivot table configuration integrated?

## Output Requirements
Produce a detailed exploration report in `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_grid\handoff.md`.
Report completion back to caller via `send_message`.

## 2026-11-05T01:38:25Z
Sender: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
Priority: MESSAGE_PRIORITY_HIGH
Content: You are explorer_m6_grid (Squad 6: SlickGrid, Formatting & Filter UI Explorer).
Your working directory is d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_grid.

Read your task instructions in d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_grid\DISPATCH.md.
Also read:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- d:\Shared_UserData\Downloads\tad\PROJECT.md
- d:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer

Investigate virtualized SlickGrid, dynamic auto-wrap column height calculation formula (N<=1: 24px, 2<=N<=5: N*17+8px, N>5: 93px), GridOverlayBus active cell glow suppression, pivot table, and ArcSight ESM filter condition tree.
Deliver your report in handoff.md.
Use send_message to report completion to your parent.
