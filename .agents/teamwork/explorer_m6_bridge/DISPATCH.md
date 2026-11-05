# Dispatch: explorer_m6_bridge

## Context & Objectives
You are `explorer_m6_bridge` (Squad 6: Host Bridge & IPC Protocol Explorer).
Your task is to explore and plan the integration of `TauriHostAdapter.ts`, command aliases, and binary Arrow IPC stream decoding into the frontend.

## Mandatory Reading
- Original User Request: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- Project Master Plan: `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- Existing Host Adapter: `d:\Shared_UserData\Downloads\tad\packages\host-bridge\src\TauriHostAdapter.ts`
- IPC Command aliases: `d:\Shared_UserData\Downloads\tad\packages\host-bridge\src\commandAliases.ts`

## Investigation Questions
1. Examine `packages/host-bridge/src/TauriHostAdapter.ts` and `commandAliases.ts`:
   - How does `TauriHostAdapter` interact with `window.__TAURI__.core.invoke`?
   - How is binary Arrow IPC Stream requested and decoded? Inspect how `toad:eval_query` receives the Uint8Array starting with `0xFFFFFFFF` marker and parses it via `@apache-arrow/es2015-cjs` (`tableFromIPC`).
   - What query and workspace methods need to be implemented (`evalQuery`, `rowCount`, `getSchema`, `project:*`, `ingestFile`, `getIngestQueue`)?
2. Activation contract (`dataPort = true`):
   - What initialization check or capability handshake is expected by `toadviewer`?
   - How is `toadSchema` extracted from custom Arrow IPC metadata or response payload?
3. Provide a concrete implementation strategy and interface mapping for `worker_m6_frontend`.

## Output Requirements
Produce a detailed exploration report in `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_bridge\handoff.md`.
Report completion back to caller via `send_message`.

## 2026-11-05T01:38:20Z
You are explorer_m6_bridge (Squad 6: Host Bridge & IPC Protocol Explorer).
Your working directory is d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_bridge.

Read your task instructions in d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_bridge\DISPATCH.md.
Also read:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- d:\Shared_UserData\Downloads\tad\PROJECT.md
- d:\Shared_UserData\Downloads\tad\packages\host-bridge\src\TauriHostAdapter.ts
- d:\Shared_UserData\Downloads\tad\packages\host-bridge\src\commandAliases.ts

Investigate TauriHostAdapter.ts integration, command aliases, binary Arrow IPC stream decoding (0xFFFFFFFF marker), and frontend connection strategy.
Deliver your report in handoff.md.
Use send_message to report completion to your parent.

