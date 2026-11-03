# Dispatch Log

## 2026-11-03T03:04:02Z
10 chuyên gia thiết kế và lập trình viên chuyên nghiệp phối hợp với nhau, dựa theo phương án đã duyệt trong `phuong_an_chi_tiet_file_table_search_va_project_rename_v2.4.3.md` để tái cấu trúc lại hệ thống quản lý project của Tad.

Working directory: d:\Shared_UserData\Downloads\tad
Integrity mode: development

Reference plan: C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\phuong_an_chi_tiet_file_table_search_va_project_rename_v2.4.3.md

## Requirements

### R1. Loại bỏ các tính năng Open File... và Open Directory... khỏi Menu
Loại bỏ hoàn toàn các mục `Open File...` và `Open Directory...` khỏi menu `File` trong `tad-master/packages/tad-app/app/appMenu.ts` vì đã lỗi thời so với mô hình Multi-Project Workspace. Thay thế bằng các hành động tích hợp Project Workspace (`Add Files to Active Project...` với `CmdOrCtrl+O`, `Add Folder to Active Project...` với `CmdOrCtrl+Shift+O`).

### R2. Đổi tên Project trực tiếp bằng Double-Click
Cho phép người dùng đổi tên Project trực tiếp bằng thao tác Double-Click vào tiêu đề project trên sidebar (`ProjectNodeLabel`), chuyển sang ô nhập liệu in-place để chỉnh sửa, và nhấn Enter hoặc click ra ngoài (blur) để lưu tên mới vào Ledger mà vẫn giữ nguyên `projectId`.

### R3. Tái cấu trúc bộ lọc tìm kiếm (Search Filter)
- Lọc strictly 100% theo tên file (loại bỏ hoàn toàn logic `projMatches`, không bao giờ khớp theo tên project).
- Lọc in-memory tức thì (0ms latency) trên toàn bộ các project trong workspace.
- Tự động bung mở (expand) các project có file khớp và ẩn các project không có kết quả khi đang nhập từ khóa tìm kiếm; khi xóa từ khóa thì khôi phục lại trạng thái mở/đóng ban đầu.

### R4. Chuyển đổi danh sách file trong project thành Dạng Bảng (Interactive Table Layout)
- Hiển thị danh sách tệp của từng project dưới dạng bảng dữ liệu 4 cột:
  1. Tên file: Kèm biểu tượng định dạng (icon) và status tooltip đầy đủ.
  2. Đường dẫn tương đối thư mục cha (hàm `getRelativeParentDir`): Tính từ folder root đối với thao tác mở thư mục, hoặc 1 cấp thư mục cha trực tiếp đối với tệp mở lẻ.
  3. Kích thước file: Định dạng B/KB/MB/GB.
  4. Trạng thái file: Giữ nguyên logic trạng thái 🟢 VALID / 🔴 MODIFIED / ◌ PENDING / ! ERROR.
- Tương tác trên đầu bảng (Table Header):
  - Nhấp vào ô đầu bảng mở ô nhập filter cho cột đó (Column Filter).
  - Nút mũi tên bên phải ô (`▲` / `▼` / `⇅`) cho phép sắp xếp (Sort) tăng dần / giảm dần theo cột tương ứng.
- Nhấp vào một dòng file mở xem nội dung tệp bình thường trong view chính.
- Tối ưu giao diện data-dense (chiều cao dòng 24-26px, text ellipsis) và hỗ trợ cả Light Mode và Dark Mode trong `tad-master/packages/tadviewer/less/sidebar.less`.

### R5. Kiểm thử Tự động & Đóng gói Bản phát hành v2.4.3
- Bổ sung SUITE JJ vào `tests/deep_integration_qa.js` kiểm thử toàn diện mọi tính năng mới (JJ.1 đến JJ.7).
- Chạy toàn bộ test suite đảm bảo 100% bài kiểm thử PASS.
- Thực hiện build và đóng gói release portable v2.4.3 (`releases/Toad-2.4.3-x64-portable.exe` và `releases/Toad-2.4.3-x64-portable.zip`) tuân thủ nghiêm ngặt quy chuẩn Packaging & Versioning của workspace.

## Verification Resources
- Test suite chính: `tests/deep_integration_qa.js` (chạy bằng `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js`).
- Công cụ đóng gói: `package_release.ps1`, `tools/bump_version.js`.
- Kế hoạch chi tiết đã duyệt: `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\phuong_an_chi_tiet_file_table_search_va_project_rename_v2.4.3.md`.


## 2026-11-03T09:22:57Z
Full team (multi agents for implementer): Fix the DuckDB CSV sniffer delimiter misparsing and cache hit flaw in Tad, implement non-blocking ingestion error handling with file status badging, clean up corrupted parquet caches, rebuild the application via fastbuild, and verify the schema and build.

Working directory: d:\Shared_UserData\Downloads\tad
Integrity mode: development

Reference report: C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\bao_cao_root_cause_analysis_csv_column_split.md

## Requirements

### R1. Gateway Cache Validation & Misparsed Parquet Eviction
Move or mirror `isMisparsedDelimiter` (and rawEvent fallback checks) directly into `checkDoubleValidCache` / before `createViewFromParquet` in `reltab-fs.ts` or `csvimport.ts`. Ensure that if a cached parquet file has `column01..columnN` or column 0 contains commas, it is detected and evicted immediately upon file open or project registration.

### R2. CSV Parser Configuration & Stability
Verify and enforce that `csvimport.ts` and `ingestWorker.ts` use `delim = ','` without `escape = ''` for CSV files, maintaining `all_varchar = true` to prevent native `vector.cpp:1859` assertion crashes.

### R3. Cache and Stale Temporary File Cleanup
Clean up any stale `.tmp_` and corrupted parquet cache files for `sample_40gb.csv` in `releases/toadAppData_*` and active cache directories, ensuring clean ledger state.

### R4. Non-blocking Ingestion Error Handling & Logging
Whenever any file throws an ingestion or processing exception during loading or worker processing:
1. Catch the exception and record the full error trace into the log file (`toad.log`).
2. Update the file's status in the project sidebar/ledger to error status with an exclamation mark circle icon (`!`) to visually indicate a failed file, rather than presenting an intrusive pop-up error dialog that forces the user to click "ignore".

### R5. Build & Workspace Adherence
Run `fastbuild.ps1` to produce the updated runnable application directory / binary. Respect workspace guidelines in `AGENTS.md` (use Jujutsu `jj`, Zero-Duplicate Binary Storage policy).

## Verification Resources
- Use the first 1000 lines in `sample_40gb.csv` as a mini sample for fast test, and let the team decide the verification approach. Full `sample_40gb.csv` can also be verified.
- Reference investigation report: `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\bao_cao_root_cause_analysis_csv_column_split.md`.

## Acceptance Criteria

### Cache Validation & Parser Fix
- [ ] Stale or corrupted parquet caches with `column01..columnN` or comma-separated column 0 are automatically detected and evicted on open.
- [ ] CSV import enforces `delim = ','`, removes `escape = ''`, and retains `all_varchar = true`.
- [ ] Stale `.tmp_` files and corrupted parquet caches for `sample_40gb.csv` are removed from cache directories.

### Ingestion Error Handling & Logging
- [ ] Ingestion exceptions are caught, preventing intrusive pop-up error dialogs requiring manual "ignore" clicks.
- [ ] Full error trace for failed file ingestion is written to the log file (`toad.log`).
- [ ] Failed files are marked with error status and display the exclamation mark circle icon (`!`) on the project sidebar/ledger.

### Build & Version Control
- [ ] `fastbuild.ps1` runs successfully and updates the build output.
- [ ] Workspace guidelines in `AGENTS.md` are respected (no duplicate binary storage across historical versions).

### QA & Verification
- [ ] `sample_40gb.csv` (and/or mini sample of its first 1000 lines) parses cleanly with all 11 proper columns (`Timestamp`, `EventTime`, `RuleTitle`, `RuleID`, `Level`, `Computer`, `Channel`, `EventID`, `RecordID`, `Details`, `ExtraFieldInfo`).
- [ ] No `column01..column10` column names appear in the resulting schema.
- [ ] Column 0 contains proper values, not raw unparsed lines.
