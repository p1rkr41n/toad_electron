# THUYẾT MINH KỸ THUẬT VÀ PHƯƠNG ÁN KIẾN TRÚC TOAD v2.4.2
## Three-Way Startup Reconciliation Engine & 5-Character Project ID Single Trust Ledger

**Ngày lập**: Tháng 11/2026  
**Phiên bản đích**: Toad v2.4.2  
**Tiêu chuẩn chất lượng**: QA Đa Lớp (Database Layer -> Integration Layer -> Packaged Binary Layer)

---

### I. BỐI CẢNH VÀ MỤC TIÊU NÂNG CẤP

Trong các phiên bản trước (v2.4.0 và v2.4.1), hệ thống Multi-Project Workspace Navigator đã đưa vào cơ chế Parquet State Ledger (`toad_ledger.parquet`) để lưu trữ nhật ký thao tác dạng Write-Ahead Log (WAL). Tuy nhiên, thực tế vận hành trên Windows phát sinh các thách thức cốt lõi:

1. **Khóa vật lý gắn liền với tên hiển thị**:
   - Trước đây `project_id` mang tiền tố định dạng hoặc dùng tên dự án. Khi người dùng đổi tên hiển thị (`project_name`), nếu đổi cả thư mục cache trên đĩa sẽ gây tốn I/O và dễ vấp phải lỗi khóa tệp Windows `EBUSY` khi DuckDB đang mở view hoặc file handle.
2. **Ký tự cấm trên hệ thống tập tin Windows**:
   - Tên dự án có thể chứa dấu tiếng Việt, khoảng trắng, hoặc ký tự cấm (`\`, `/`, `:`, `*`, `?`, `"`, `<`, `>`, `|`) khiến hệ thống file từ chối tạo thư mục.
3. **Hiện tượng mất đồng bộ 3 chiều khi khởi động**:
   - Người dùng có thể xóa, sửa file ngoài hệ thống khi Toad đang tắt; hoặc cache tạm bị dọn dẹp bởi Windows Disk Cleanup. Cần một cơ chế Single Source of Truth (SSOT) tự động phát hiện và tự chữa lành (Self-Healing) qua 6 kịch bản đối chiếu.
4. **Schema Poisoning khi ghi Tombstone vào Parquet**:
   - Việc ghi `NULL` không xác định kiểu dữ liệu (untyped null) trong DuckDB có thể gây sai lệch schema cột của Parquet WAL.
5. **Tích tụ rác mồ côi (Orphan Leaks) khi xóa toàn bộ dự án**:
   - Khi xóa hết các project, file Parquet vẫn phình to theo thời gian nếu chỉ ghi bản ghi xóa mà không có cơ chế reset physical file về 0 rows.

Phiên bản **Toad v2.4.2** được thiết kế để giải quyết triệt để 5 vấn đề trên thông qua **5-Character Project ID**, **Phân vùng cache độc lập `temp/<project_id>/`**, **Typed NULL Tombstone**, **DuckDB Window Function Query**, **Safe Ledger Reset**, và **Three-Way Startup Reconciliation Engine**.

---

### II. CHI TIẾT KIẾN TRÚC & GIẢI PHÁP KỸ THUẬT

#### 1. Chuẩn Hóa `project_id` 5 Ký Tự Ngẫu Nhiên & Zero-Cost Rename
- **Định dạng ID**: Chuỗi 5 ký tự ngẫu nhiên `[a-z0-9]{5}` (tổng cộng $36^5 \approx 60.466.176$ tổ hợp).
- **Thuật toán sinh chống trùng lặp tuyệt đối (`generateUniqueProjectId`)**:
  - Sinh ngẫu nhiên từng ký tự từ bảng chữ cái thường và chữ số `[a-z0-9]`.
  - Kiểm tra đối chiếu vật lý: Thư mục `temp/<id>/` không được tồn tại trên đĩa.
  - Kiểm tra đối chiếu logic: ID không được trùng với bất kỳ `project_id` nào đang có trong `ToadParquetLedger`.
  - Khi thỏa mãn, tạo ngay thư mục vật lý `temp/<id>/` trên đĩa và trả về `id`.
  - Fallback an toàn: Nếu sau 1000 lần thử vẫn đụng độ (xác suất gần như 0), sử dụng `Date.now().toString(36).slice(-5)`.
- **Tách rời Khóa vật lý và Tên hiển thị (Zero-Cost Rename)**:
  - Khóa vật lý lưu cache Parquet luôn cố định tại `temp/<project_id>/`.
  - Tên dự án hiển thị (`project_name`) có thể tự do thay đổi có dấu, khoảng trắng, ký tự đặc biệt.
  - Khi đổi tên, chỉ ghi 1 bản ghi metadata mới vào `toad_ledger.parquet`. Không di chuyển hay đổi tên thư mục cache trên đĩa, đạt tốc độ đổi tên $\approx 0\text{ms}$ và hoàn toàn miễn nhiễm lỗi Windows `EBUSY`.

#### 2. Phân Vùng Đệm Độc Lập `temp/<project_id>/`
- Mọi tệp cache Parquet thuộc dự án được lưu tại:
  `temp/<project_id>/<file_basename>_cached_<path_hash>.parquet`
- Hàm `getDeterministicParquetPath(filePath, tempDir, projectId)` tự động định vị đúng phân vùng con của dự án tương ứng.
- Đảm bảo cách ly hoàn toàn dữ liệu đệm giữa các dự án khác nhau.

#### 3. Typed NULL Tombstone Record
- Khi người dùng xóa một dự án hoặc khi phát hiện mất thư mục gốc (Scenario 3), hệ thống thực hiện quy trình Tombstone 4 bước:
  1. **Ghi Tombstone vào Parquet Ledger TRƯỚC**:
     Toàn bộ các cột file được ép kiểu tĩnh tường minh:
     ```sql
     CAST(NULL AS VARCHAR) as source_path,
     CAST(NULL AS BIGINT) as source_size,
     CAST(NULL AS BIGINT) as source_mtime,
     CAST(NULL AS VARCHAR) as parquet_path,
     CAST(NULL AS BIGINT) as parquet_size,
     CAST(NULL AS BIGINT) as row_count,
     CAST(NULL AS VARCHAR) as status,
     CAST(NULL AS INTEGER) as duration_ms,
     CAST(NULL AS VARCHAR) as extra_json
     ```
     Chỉ giữ lại `project_id`, `project_name`, và `event_type = 'PROJECT_DELETE'`. Điều này đảm bảo Parquet schema 14 cột luôn đồng nhất 100%, không bị hỏng schema khi append.
  2. **Gỡ bỏ File Locks**: Drop toàn bộ DuckDB VIEW liên quan đến project trong cả Ingest Engine và UI Engine.
  3. **Atomic Rename Tránh `EBUSY`**: Đổi tên thư mục `temp/<project_id>/` sang `temp/.trash_<project_id>_<timestamp>/`. Thao tác đổi tên trên cùng volume là nguyên tử (atomic) và thành công ngay cả khi có background reader đang nhả handle.
  4. **Xóa Nền Bất Đồng Bộ (Async Fire-and-Forget)**: Xóa thư mục `.trash_*` trong worker nền với cơ chế retry nếu Windows chưa giải phóng file lock hoàn toàn.

#### 4. Window Function Xác Định Trạng Thái Project & Safe Ledger Reset
- **Truy vấn Window Function DuckDB**:
  ```sql
  WITH ranked_events AS (
    SELECT 
      project_id,
      project_name,
      event_type,
      source_path,
      parquet_path,
      status,
      ROW_NUMBER() OVER (
        PARTITION BY project_id 
        ORDER BY timestamp DESC
      ) as rn
    FROM read_parquet('toad_ledger.parquet')
    WHERE project_id IS NOT NULL AND length(project_id) = 5
  )
  SELECT 
    project_id,
    project_name,
    CASE 
      WHEN event_type = 'PROJECT_DELETE' 
           OR (source_path IS NULL AND parquet_path IS NULL AND status IS NULL)
      THEN 'DELETED'
      ELSE 'ACTIVE'
    END as project_state
  FROM ranked_events
  WHERE rn = 1;
  ```
- **Quy tắc Reset Ledger**:
  - Khi số lượng project active bằng 0 (`countActiveProjects() === 0`):
    - Đóng kết nối internal DuckDB database.
    - Xóa file vật lý `toad_ledger.parquet`.
    - Tạo lại file Parquet mới tinh 0 dòng bằng truy vấn:
      `COPY (SELECT ... WHERE 1 = 0) TO 'toad_ledger.parquet' (FORMAT PARQUET)`.
    - Dọn sạch RAM cache.
    - Lên lịch sau 500ms tự động sinh project `Untitled-1` với 5-character ID mới và thư mục `temp/<new_id>/`.

#### 5. Three-Way Startup Reconciliation Engine (SSOT = Parquet Ledger)
Hệ thống đối chiếu 3 chiều giữa **Parquet Ledger**, **Thư mục Cache (`temp/<id>/`)**, và **Source Disk** theo ma trận 6 kịch bản:

- **Scenario 1 (Mất cache đệm)**:
  - Ledger: Có file status `READY`.
  - Cache: File Parquet trong `temp/<id>/` không tồn tại.
  - Source: File gốc vẫn tồn tại trên đĩa.
  - Xử lý: Chuyển status trong Ledger thành `MODIFIED`/`PENDING`, thông báo UI cần re-ingest.
- **Scenario 2 (File/Thư mục ngoại lai mồ côi trong `temp/`)**:
  - Cache: Xuất hiện thư mục con trong `temp/` không thuộc bất kỳ active `project_id` nào, hoặc file `*_cached_*.parquet` trong `temp/<id>/` không có trong Ledger.
  - Xử lý: **XÓA NGAY LẬP TỨC** để thu hồi dung lượng đĩa, chống rò rỉ rác triệt để.
- **Scenario 3 (Mất thư mục gốc dự án)**:
  - Ledger: Có project và danh sách file với metadata `folderRoot`.
  - Source: Thư mục `folderRoot` trên đĩa không còn tồn tại.
  - Xử lý: Ghi Typed NULL Tombstone cho project, drop views, atomic rename và xóa bất đồng bộ `temp/<id>/`.
- **Scenario 4 (Mất file lẻ nguồn gốc)**:
  - Ledger: Có file lẻ.
  - Source: File gốc bị xóa khỏi đĩa.
  - Xử lý: Ghi bản ghi `FILE_DELETED` (`status: 'DELETED'`), xóa cache Parquet tương ứng trong `temp/<id>/`.
- **Scenario 5 (File mới xuất hiện trong thư mục gốc - Quét đệ quy)**:
  - Source: Quét đệ quy thư mục `folderRoot` phát hiện file dữ liệu mới chưa có trong Ledger.
  - Xử lý: Đẩy file mới vào project, ghi bản ghi `FILE_STARTED` với `status: 'PENDING'` vào Ledger để nạp ngầm.
- **Scenario 6 (File gốc bị sửa đổi `mtime`/`size`)**:
  - Source: File gốc có `mtime` hoặc `size` lệch so với Ledger.
  - Xử lý: Xóa cache cũ trong `temp/<id>/`, chuyển status sang `MODIFIED` màu đỏ (`#ef4444`), ghi event `FILE_MODIFIED`.

---

### III. CHIẾN LƯỢC KIỂM THỬ ĐA LỚP (MULTI-LAYER QA STRATEGY)

Để đảm bảo phần mềm hoạt động trơn tru tuyệt đối từ tầng nhân dữ liệu đến gói đóng phân phối:

1. **Lớp 1: QA Tầng Database (`tests/db_layer_qa.js`)**:
   - Kiểm thử độc lập trực tiếp trên DuckDB và định dạng file Parquet.
   - Thẩm định tính toàn vẹn của schema Parquet khi ghi Typed NULL Tombstone.
   - Thẩm định truy vấn Window Function phân loại chính xác trạng thái ACTIVE vs DELETED.
   - Thẩm định xóa vật lý và tạo file Parquet rỗng 0 rows (`WHERE 1 = 0`).
2. **Lớp 2: QA Tầng Tích Hợp & Kịch Bản Nghiệp Vụ (SUITE II trong `tests/deep_integration_qa.js`)**:
   - Thực thi toàn bộ 11 test case chi tiết (II.1 -> II.11) mô phỏng chính xác hành vi người dùng và 6 kịch bản khởi động.
3. **Lớp 3: QA Trên Gói Đóng Portable (`dist_package.ps1` & `Toad.exe`)**:
   - Build các gói `host-bridge`, `reltab-duckdb`, `tadviewer`, và Webpack production bundle `tadapp.bundle.js`.
   - Đóng gói Portable binary bằng `dist_package.ps1`.
   - Kiểm định runtime không có lỗi crash, tuân thủ Zero-Duplicate Binary Policy.

---

### IV. KẾ HOẠCH CHỈNH SỬA MÃ NGUỒN THEO THỨ TỰ
1. `tad-master/packages/reltab-duckdb/src/csvimport.ts`: Bổ sung các hàm lõi (`generateUniqueProjectId`, `getDeterministicParquetPath`, `recordProjectTombstone`, `checkAndCompactingLedgerIfAllDeleted`, `performStartupReconciliation`, `scanDirectoryRecursive`).
2. `tad-master/packages/reltab-fs/src/reltab-fs.ts`: Tương thích `scanDirectoryRecursive` và thư mục phân vùng `temp/<projectId>/`.
3. `tad-master/packages/tadviewer/src/ProjectWorkspaceManager.ts`: Cập nhật sinh 5-char ID và hỗ trợ startup reconciliation.
4. `tad-master/packages/tad-app/app/main.ts`: Kết nối startup reconciliation lúc khởi động ứng dụng.
5. `tests/db_layer_qa.js` & `tests/deep_integration_qa.js`: Bổ sung bộ kiểm thử QA Đa Lớp.
6. Build & Packaging Verification.
