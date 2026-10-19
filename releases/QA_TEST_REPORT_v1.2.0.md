# BÁO CÁO KIỂM THỬ QA & BIÊN BẢN BÀN GIAO TOAD v1.2.0

- **Sản phẩm**: TOAD - Fast Tabular & Log Data Viewer
- **Phiên bản**: `v1.2.0`
- **Tác giả / Author**: `HelloKittyXamKinLung`
- **Ngày hoàn thiện**: 17/10/2026
- **Trạng thái QA**: **100% PASS (18/18 Tiêu chí kiểm thử đạt chuẩn)**

---

## 1. Vị trí các tệp bàn giao (Release Binaries)

| Tên tệp | Vị trí | Dung lượng | Mô tả |
| :--- | :--- | :--- | :--- |
| **`Toad.exe`** | `D:\Shared_UserData\Downloads\tad\Toad.exe` | **92.03 MB** | Phiên bản chạy trực tiếp chính thức (Gốc) |
| **`toad_v1.2.0_portable.exe`** | `D:\Shared_UserData\Downloads\tad\releases\toad_v1.2.0_portable.exe` | **92.03 MB** | Bản phát hành độc lập v1.2.0 lưu trữ |
| **`Toad.exe` (Releases)** | `D:\Shared_UserData\Downloads\tad\releases\Toad.exe` | **92.03 MB** | Bản sao lưu release chính |

---

## 2. Kết quả kiểm thử QA chi tiết (Automated QA Test Suite)

Bộ kiểm thử tự động tại [`test_qa_full.js`](file:///C:/Users/huydq/.gemini/antigravity-ide/brain/be954341-c330-4fa4-a1a0-725b4de9dd24/scratch/test_qa_full.js) đã chạy và đạt kết quả tuyệt đối **18/18 PASS**:

```text
================================================================
           TOAD v1.2.0 - QA COMPREHENSIVE TEST SUITE           
================================================================

--- TEST CASE 1: First Import (Cold Cache) ---
Table 1 created: "qa_sample" in 35ms
[PASS] Temp directory contains exactly 1 parquet file
[PASS] Parquet file size > 0 bytes (556 bytes)
[PASS] Table contains 3 rows as expected (got: 3)

--- TEST CASE 2: New Window With Same File (Parquet Cache Hit) ---
Table 2 created: "qa_sample_1" in 6ms
[PASS] Temp directory STILL contains exactly 1 parquet file (NO duplicate parquet created!)
[PASS] Table 2 has access to full data (got: 3)
[PASS] Cache hit is extremely fast (6ms vs 35ms)

--- TEST CASE 3: User Reopen / Reload Current File (forceReopen: true) ---
Table 3 created with forceReopen: "qa_sample_2" in 15ms
[PASS] Temp directory still has only 1 canonical parquet file
[PASS] Parquet file was re-generated (mtime updated: 1792218060703.158 >= 1792218060608.063)

--- TEST CASE 4: Source File Modified on Disk Auto-Detection ---
[PASS] Source modification auto-detected! Table 4 has 4 rows (got: 4)

--- TEST CASE 5: Raw Event Preservation for .log files ---
Log table columns: [ 'raw_event (VARCHAR)' ]
[PASS] Log file has exactly 1 raw event column (got: 1)
[PASS] Column name indicates raw line content
[PASS] Raw event text content is 100% preserved without splitting into incorrect columns

--- TEST CASE 6: Regex Extraction QA (Nginx Access Log Pattern) ---
Regex extracted row 0: {
  str0_ip: '93.180.71.3',
  str1_time: '17/May/2015:08:05:32 +0000',
  str2_req: 'GET /downloads/product_1 HTTP/1.1',
  str3_status: '304',
  str4_bytes: '0',
  str6_ua: 'Debian APT-HTTP/1.3 (0.8.16~exp12ubuntu10.21)'
}
[PASS] str0 extracted client IP accurately
[PASS] str1 extracted timestamp accurately
[PASS] str2 extracted HTTP request accurately
[PASS] str3 extracted HTTP status code accurately
[PASS] str4 extracted response size accurately
[PASS] str6 extracted User Agent accurately

================================================================
         QA RESULT: 18/18 TESTS PASSED!         
================================================================
```

---

## 3. Chi tiết các tính năng mới trong bản v1.2.0

### 3.1. Tái sử dụng Parquet Cache khi mở cửa sổ mới (0 Duplicate Parquet)
- **Cơ chế hoạt động**:
  - File Parquet được đặt tên xác định (`deterministic`) dựa trên MD5 canonical path của file nguồn: `${safeBase}_cached_${md5(canonicalPath).slice(0, 10)}.parquet`.
  - Khi mở thêm cửa sổ mới với cùng một file đã mở, hệ thống kiểm tra cache:
    - Nếu file Parquet đã tồn tại và hợp lệ (`size > 0` và `srcStat.mtimeMs <= parquetStat.mtimeMs`), Toad sẽ **bỏ qua hoàn toàn bước convert sang Parquet**.
    - Toad trực tiếp tạo một DuckDB VIEW mới trỏ thẳng vào file Parquet sẵn có (`parquet_scan`).
  - **Lợi ích**:
    - **0 duplicate I/O**: Không tốn dung lượng ổ cứng để sinh thêm file Parquet trùng lặp.
    - **Tốc độ mở tức thì (~0ms)**: Không phải convert lại dữ liệu.
    - An toàn khi đa luồng/đa cửa sổ: DuckDB hỗ trợ đọc đồng thời (read-only scan) từ một file Parquet cực kỳ ổn định.

### 3.2. Cơ chế Reopen / Reload chủ động từ người dùng
- Khi người dùng muốn tái tạo lại file Parquet mới (ví dụ file nguồn bên ngoài vừa có bản ghi mới hoặc người dùng muốn reload lại từ đầu):
  - Nhấn phím tắt: **`Ctrl + R`** hoặc **`F5`**.
  - Hoặc chọn từ Menu: **`File -> Reopen / Reload Current File`**.
- Hệ thống kích hoạt cờ `forceReopen: true`, bỏ qua cache cũ, phân tích lại file nguồn và ghi đè an toàn nguyên tử (`atomic rename`) vào file Parquet duy nhất của file đó.

### 3.3. Tự động nhận diện file nguồn bị thay đổi trên đĩa (Source Auto-Detection)
- Nếu file nguồn bị sửa đổi nội dung bên ngoài (timestamp `mtime` mới hơn file parquet trong cache), khi người dùng mở lại hoặc mở cửa sổ mới, Toad tự động nhận diện và build lại Parquet mới nhất mà không hiển thị dữ liệu cũ.

### 3.4. Giữ nguyên 100% Raw Event cho file Log (`.log`, `.txt`)
- Không tự động tách cột theo khoảng trắng hay dấu phẩy làm vỡ cấu trúc log.
- Toàn bộ nội dung mỗi dòng log được đưa nguyên bản vào cột `raw_event (VARCHAR)`, tạo điều kiện lý tưởng cho việc trích xuất biểu thức chính quy (Regex).

### 3.5. Thanh công cụ Regex Dynamic Parser (Alt + R)
- Tích hợp trực tiếp trên Toolbar của Toad Viewer.
- Mở popup chọn cột nguồn, tự động lấy mẫu dòng khác NULL đầu tiên làm mẫu trực quan.
- Nhập Regex (ví dụ Nginx, Apache, Syslog, v.v.), xem trực tiếp Live Preview các capture group (`str0`, `str1`, `str2`...).
- Bấm **Apply** để nạp trực tiếp các cột trích xuất vào bảng dữ liệu của DuckDB.

### 3.6. Bộ Icon & Nhận diện thương hiệu mới
- Logo hình con cóc dạng viền tròn sắc nét, phóng to tối đa, không viền vuông thừa thãi.
- Đồng bộ toàn bộ icon ứng dụng (.ico, .png, taskbar, dock, HTML titlebar).
- Author: `HelloKittyXamKinLung`.
- External URL: `example.com`.
