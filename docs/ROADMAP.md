# TOAD PRODUCT & TECHNICAL ROADMAP
> **Product:** Toad - Log & Forensic Data Analysis Platform  
> **Status:** Strategic Roadmap & Feature Backlog  

---

## 1. Vision & Strategic Direction

Toad aims to be the fastest, most ergonomic forensic log analysis and incident response desktop application for security analysts, incident responders, and data engineers. The roadmap focuses on three key vectors:
1. **DFIR Specialized Analytical Capabilities** (Timeline analysis, IoC grepping, defanging, decoders).
2. **Performance & Multi-Target Architecture** (Sub-second cold boot, Fast Portable packaging, Host Bridge abstraction).
3. **Ergonomic Data Exploration** (Keyboard navigation, custom schema discovery, bookmarking).

---

## 2. Feature Roadmap Overview

| Phase | Milestone | Focus Areas | Status |
| :---: | :--- | :--- | :---: |
| **Phase 1** | **Core Analysis & Ingestion** (v1.3.0 - v1.3.9) | Omnisearch, Right-click Pivot, SJF Ingest Queue, Base64/URL Decoders, Dynamic Pagination. | **Completed** |
| **Phase 2** | **Dual Engine & Schema Discovery** (v2.0.0 - v2.0.5) | Dual DuckDB Driver Isolation, RAM First-Page Micro-Cache, Multi-Format Vectorized Column Extractor, Header CTE. | **Completed** |
| **Phase 3** | **Material 3 UI & Packaging** (v2.1.0 - v2.1.6) | M3 Slate Dark/Light Themes, W3C Delimited Parser, Dead Code Elimination, 72MB Distribution. | **Completed** |
| **Phase 4** | **Incident Response Workflows** (Upcoming v2.3.0+) | Delta Time ($\Delta t$) Beaconing Analysis, Evidence Bookmarking, Threat Hunting Presets, Timeline Markdown Export. | **Backlog** |
| **Phase 5** | **Architecture Flexibility** (Future Exploration) | Pluggable Host Bridge (`IHostBridge`) supporting dual Electron and lightweight webview runtimes. | **Research** |

---

## 3. High-Priority Features (Incident Response & Forensic Specialization)

### 3.1. Delta Time ($\Delta t$) Analysis
- **Goal**: Automatically calculate the time interval $\Delta t = t_i - t_{i-1}$ between consecutive log events per host/IP.
- **Value**: Instantly exposes periodic Command-and-Control (C2) beaconing, password brute-force bursts ($\Delta t < 0.1\text{s}$), and automated port scanning.
- **Implementation**: SQL Window functions in `reltab-duckdb` (`epoch(event_time) - lag(epoch(event_time)) OVER (PARTITION BY host ORDER BY event_time)`).

### 3.2. Evidence Bookmarking & Incident Timeline Export
- **Goal**: Allow analysts to star/bookmark critical log rows and tag them with MITRE ATT&CK techniques (e.g. `T1059.001`, `T1078`).
- **Value**: Generate clean Markdown or CSV incident reports directly from the active triage session.

### 3.3. Threat Hunting Preset Packs
- **Goal**: One-click quick filters for common log sources (Windows Security EVTX, Sysmon, IIS/Apache, Suricata, Hayabusa outputs).
- **Presets**:
  - *Lateral Movement*: EventID 4624 (Logon Type 3 / 10), PsExec execution.
  - *Persistence*: Scheduled task creation (EventID 4698), Registry Run keys.
  - *Privilege Escalation*: Kerberoasting, Token Impersonation.

---

## 4. Performance & Distribution Roadmaps

### 4.1. "Fast Portable" Directory Packaging
- **Concept**: Provide an uncompressed ZIP distribution of `win-unpacked` alongside the single-file self-extracting `.exe`.
- **Benefit**: Eliminates the 1.5s Windows Temp 7-zip self-extraction step, bringing launch time down to $< 0.8\text{s}$.

### 4.2. Host Bridge Abstraction Layer (`IHostBridge`)
- **Concept**: Decouple the React/SlickGrid UI from Electron-specific IPC by defining a vendor-neutral bridge interface.
- **Benefit**: Enables future dual-target builds (Electron for guaranteed Chromium consistency and native menus; lightweight webview shells for minimal RAM usage).

