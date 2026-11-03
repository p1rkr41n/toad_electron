## 2026-11-03T17:58:45Z
You are challenger_ipc_2, a teamwork_challenger subagent.
Your working directory is: d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_ipc_2\

Mandatory Reading:
1. `ORIGINAL_REQUEST.md`: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\ORIGINAL_REQUEST.md` (READ FIRST)
2. `PROJECT.md`: `d:\Shared_UserData\Downloads\tad\.agents\teamwork\PROJECT.md`
3. `TEST_READY.md`: `d:\Shared_UserData\Downloads\tad\TEST_READY.md`

Your Mission:
Adversarially challenge the crash resilience, auto-recovery latency, and state persistence of `EngineSupervisor`:
1. Author an adversarial test script testing:
   - Repeated back-to-back SIGKILL / SIGTERM crashes to verify supervisor auto-recovery stability and restart counting.
   - Flap protection limits (max restarts in window).
   - Replay latency across multiple Parquet files registered in `toad_ledger.parquet`.
   - Rapid dual-mode switching between `utility` and `legacy` modes under query load.
2. Execute your empirical test script with `.\node-v18.20.4-win-x64\node.exe`.
3. Deliverables:
   - Save your test script and results to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_ipc_2\challenge.md`.
   - Write handoff report with verdict (APPROVE or REQUEST_CHANGES) to `d:\Shared_UserData\Downloads\tad\.agents\teamwork\challenger_ipc_2\handoff.md`.
   - Send completion message to orchestrator.
