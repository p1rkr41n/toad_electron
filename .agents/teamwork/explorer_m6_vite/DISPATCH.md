# Dispatch: explorer_m6_vite

## Context & Objectives
You are `explorer_m6_vite` (Squad 6: Frontend Build & Toolchain Explorer).
Your task is to explore and plan the Vite 5 bundling, React 18 integration, asset pipelines, and package dependencies for porting `toadviewer` into `tauri/project`.

## Mandatory Reading
- Original User Request: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md`
- Project Master Plan: `d:\Shared_UserData\Downloads\tad\PROJECT.md`
- Existing package.json: `d:\Shared_UserData\Downloads\tad\tauri\project\package.json`
- Existing Frontend source: `d:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer`

## Investigation Questions
1. Examine `tauri/project/package.json` and `tad-master/packages/toadviewer/package.json`:
   - What React 18, Vite 5, SlickGrid, Less, Sass, and Arrow dependencies (`@apache-arrow/es2015-cjs`) are needed?
   - What peer dependencies or build plugins (e.g. `@vitejs/plugin-react`) are present or required?
2. Inspect `vite.config.ts` (or create recommendation):
   - Path aliases: `~` mapping to `src/` or `tad-master/packages/toadviewer/src`.
   - Less/CSS preprocessor options, CSS modules, and font/asset handling.
   - Build target: output to `dist/`, base `./`, rollupOptions.
3. Verify that `npm run build` in `tauri/project` can successfully bundle without TypeScript/Less errors into `tauri/project/dist/`.

## Output Requirements
Produce a detailed exploration report in `d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_vite\handoff.md`.
Report completion back to caller via `send_message`.


## 2026-11-05T01:38:14Z
From: 07d008aa-f3ed-4ce7-a8fd-c78e0cce0e4d
Content:
You are explorer_m6_vite (Squad 6: Frontend Build & Toolchain Explorer).
Your working directory is d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_vite.

Read your task instructions in d:\Shared_UserData\Downloads\tad\.agents\teamwork\explorer_m6_vite\DISPATCH.md.
Also read:
- d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md
- d:\Shared_UserData\Downloads\tad\PROJECT.md
- d:\Shared_UserData\Downloads\tad\tauri\project\package.json
- d:\Shared_UserData\Downloads\tad\tad-master\packages\toadviewer\package.json

Investigate Vite 5 configuration, React 18, bundling, Less/CSS asset pipeline, ~ aliases, @apache-arrow/es2015-cjs dependency, and npm run build requirements.
Deliver your report in handoff.md.
Use send_message to report completion to your parent.
