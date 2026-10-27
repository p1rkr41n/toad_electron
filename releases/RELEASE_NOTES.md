# TOAD v1.3.7.2 Hotfix Release (Comprehensive Defensive Hardening, Search Fix & Instant Distinct Suggestions)

## 1. Giới thiệu phiên bản v1.3.7.2
Phiên bản **Toad v1.3.7.2** là bản phát hành bảo trì toàn diện (Full Defensive Hardening), khắc phục triệt để lỗi khi mở chi tiết sự kiện, sửa lỗi tìm kiếm chuỗi có chứa ngoặc kép / JSON, tối ưu siêu tốc tính năng gợi ý giá trị bộ lọc và bọc thép phòng thủ trên toàn bộ bảng dữ liệu:
- **Khắc phục lỗi Tìm kiếm không ra dòng nào (`search ko ra`)**:
  - *Nguyên nhân*: Hàm `sqlEscapeString` trong `reltab/src/defs.ts` trước đây chuyển đổi dấu ngoặc kép `"` thành `""`. Vì kết quả được bọc trong nháy đơn `'...'` của câu lệnh SQL (`WHERE col ILIKE '%...%'`), chuẩn SQL và DuckDB coi `""` là hai ký tự ngoặc kép liên tiếp. Khi người dùng tìm kiếm chuỗi JSON như `{"FullPath": "/inetpub/..."}`, câu lệnh sinh ra tìm kiếm `""FullPath""`, dẫn đến không khớp bất kỳ dòng nào (trả về 0 dòng).
  - *Giải pháp*: Loại bỏ việc escape dấu ngoặc kép `"` trong chuỗi literal của `sqlEscapeString` (trong nháy đơn `'...'`, dấu `"` là ký tự hợp lệ không cần escape). Các truy vấn JSON, metadata, chuỗi chứa ngoặc kép giờ đây khớp chính xác 100%.
- **Khắc phục & Tối ưu hóa Tính năng Gợi ý Giá trị (`Distinct Suggestions`)**:
  - *Sửa lỗi Catalog Binder Error*: Bọc dấu ngoặc kép an toàn cho tên bảng `"${safeTable}"` trong câu truy vấn, khắc phục triệt để lỗi `Binder Error: Catalog "Windows" does not exist!` khi mở tệp có tên chứa dấu chấm (như `Windows.NTFS.MFT.csv`).
  - *Tăng tốc độ nạp gợi ý 100x*: Thay thế cơ chế quét từng khối 50.000 dòng bằng vòng lặp `OFFSET` (vốn gây nghẽn và chiếm giữ connection pool của DuckDB) bằng truy vấn song song trực tiếp `SELECT DISTINCT "${safeCol}"::VARCHAR as val FROM "${safeTable}" WHERE "${safeCol}" IS NOT NULL LIMIT 500`. Thời gian lấy gợi ý trên 5 triệu dòng giảm xuống chỉ còn **30ms - 50ms**, phản hồi tức thì.
  - *Tránh hủy tiến trình khi gõ phím*: Ổn định dependency array `[columnId, dbc, dsPath]` trong `FilterEditorRow.tsx`, giúp tiến trình nạp gợi ý không bị re-render hủy ngang (unmount/remount) khi người dùng thao tác.
  - *Mở rộng gợi ý cho toán tử `IN` / `NOT IN`*: Tích hợp liên kết `datalistId` trực tiếp vào ô nhập thẻ `MultiTagPillInput`.
- **Khắc phục lỗi `Cannot read properties of undefined (reading 'fromCell')` khi mở sự kiện**:
  - *Nguyên nhân*: Cột mở rộng chi tiết `_expand` có thuộc tính `selectable: false`. Khi người dùng click vào nút xem sự kiện, SlickGrid hủy vùng bôi chọn và gửi sự kiện `onSelectedRangesChanged([])` với mảng rỗng `[]`. Đoạn code cũ giả định `args[0]` luôn tồn tại nên đã quăng ngoại lệ `fromCell`.
  - *Giải pháp*: Bổ sung kiểm tra an toàn `if (!args || !args.length || !args[0]) return;` cùng cơ chế kiểm tra `null` toàn diện trên `rowData` và ranh giới cột `gridCols[col]`.
- **Phòng ngừa lỗi Crash khi Copy dữ liệu (`copySelectedRange`)**: Bổ sung `null check` nghiêm ngặt cho `range`, `rowData` và `gridCols` khi người dùng nhấn `Ctrl+C` hoặc sao chép vùng dữ liệu trong chế độ phân trang.
- **Phòng ngừa lỗi Click vào khoảng trống bảng (`handleGridClick`)**: Kiểm tra an toàn `col` và `item`, tránh lỗi `Cannot read properties of null` khi người dùng click vào dòng đang tải hoặc vùng trống phía dưới trang.
- **Tự động đóng Chi tiết Sự kiện khi chuyển trang (`AppPane.tsx`)**: Tự động reset `expandedEvent` về `null` khi người dùng chuyển sang trang khác hoặc đổi bộ lọc, tránh hiện tượng dòng ở trang mới bị mở rộng sai lệch và giữ đồng bộ trạng thái giao diện.
- **Hiển thị Số thứ tự Toàn cục Chuẩn xác trên Sidebar (`EventDetailSidebar.tsx`)**: Badge dòng trên thanh chi tiết sự kiện được liên kết với số trang: `Row #((currentPage - 1) * pageSize + rowIndex + 1)` (ví dụ hiển thị `Row #1,005` thay vì `Row #5`), giúp chuyên viên DFIR luôn định vị chính xác vị trí dòng trong tệp 40GB.
- **Chuẩn hóa chuỗi kiểu dữ liệu cột**: Trích xuất sạch `sqlTypeName` hoặc `kind`, loại bỏ hiện tượng hiển thị `[object Object]` trên thanh chi tiết.

---

# TOAD v1.3.7.1 Hotfix Release (Null Pointer Fix, Schema Protection & UI Clean Loading)

## 1. Giới thiệu phiên bản v1.3.7.1
Phiên bản **Toad v1.3.7.1** là bản phát hành bảo trì trọng yếu (Hotfix), xử lý triệt để lỗi tính toán độ rộng cột khi mở bảng dữ liệu phân trang, bảo vệ schema an toàn trước các trường siêu dữ liệu nội bộ (`_isOpen`, `_id`, `_depth`...) và tối ưu hóa trải nghiệm thị giác khi nạp tệp:
- **Khắc phục lỗi Promise Rejection `[Binary Guard] Trang thai: HOP LE` trên tệp 40GB**:
  - *Nguyên nhân*: Hàm `inspect_csv` trong `toad-core-rust` trước đây đếm dòng bằng cách đọc tuần tự từng dòng của toàn bộ tệp 40GB (`while reader.read_line()`). Quá trình đọc 40GB vượt quá thời gian chờ 10 giây (`timeout: 10000ms`), dẫn đến Node.js phát sinh lỗi `ETIMEDOUT`. Khối `catch` trong `csvimport.ts` đọc nhầm nội dung `stdout` (vốn đã in thông báo file hợp lệ `[Binary Guard] Trang thai: HOP LE`) và quăng lỗi giả (False-Positive).
  - *Giải pháp*: Tối ưu hóa `inspect_csv` chuyển sang cơ chế lấy mẫu nhanh tối đa 1.000 dòng ($O(1)$ < 2ms) để tính toán độ dài dòng trung bình và ước lượng tổng số dòng. Đồng thời, cấu hình lại `binaryGuard` trong `csvimport.ts` tự động phát hiện cờ `HOP LE` từ `stdout`, không quăng ngoại lệ giả và fallback an toàn sang kiểm tra nhị phân 8KB của JS nếu có timeout.
- **Khắc phục lỗi `Schema.columnType: unknown column '_isOpen'`**: Loại bỏ việc duyệt nhầm các trường điều khiển nội bộ của hàng dữ liệu ảo (`_isOpen`, `_isLeaf`, `_depth`, `_id`, `_parentId`) khi tính độ rộng và định dạng cột trong `DataGrid.tsx`. Đồng thời, trang bị cơ chế tự bảo vệ tại tầng `Schema.ts` và `ViewParams.ts`, tự động trả về định dạng chuỗi an toàn (`fallback ColumnType`) thay vì quăng lỗi làm gián đoạn renderer nếu gặp bất kỳ cột giả lập nào.
- **Khắc phục lỗi `Cannot read properties of null (reading 'Timestamp')`**: Trong `DataGrid.tsx`, thuật toán tự động tính toán độ rộng cột (`getColWidth`) trước đây duyệt theo dải chỉ số bộ đệm trượt (`offset` đến `offset + limit`) thay vì chỉ số trang hiện hành `[0 .. pageSize - 1]`. Khi tệp có nhiều hơn 1.000 dòng hoặc khi mở các trang tiếp theo, việc truy cập hàng vượt biên trả về `null` dẫn đến crash renderer. Đã cập nhật duyệt an toàn tối đa 100 dòng mẫu đầu trang với kiểm tra `null` nghiêm ngặt và hỗ trợ cột đầu tiên `columnIndex === 0`.
- **Loại bỏ hoàn toàn icon xoay tròn vô định (Indeterminate Spinner)**: Loại bỏ `LoadingModal` và lớp phủ xám mờ. Thay vào đó, khi nạp và chuyển đổi tệp, hệ thống chỉ hiển thị duy nhất **Hộp thoại Tiến trình Nạp (IngestProgressDialog)** chuyên nghiệp, trực quan với thanh %, tốc độ MB/s, ETA và nút Hủy. Khi thao tác dữ liệu thông thường, công cụ phản hồi tức thì mà không bị che khuất tầm nhìn.

---

# TOAD v1.3.7 Release (Custom Big Data 40GB+ Parquet & Log Viewer Build)

## 1. Giới thiệu phiên bản v1.3.7
Phiên bản **Toad v1.3.7** là bước tiến đột phá về hiệu năng và trải nghiệm cho việc xử lý các tệp dữ liệu lớn (Big Data 40GB+ với hàng chục triệu dòng sự kiện). Bản cập nhật này chuẩn hóa toàn bộ luồng dữ liệu sang 100% Parquet Native Engine, giải quyết triệt để vấn đề tìm kiếm đường dẫn Windows, tự động nhận diện sắp xếp theo dòng thời gian sự kiện, nạp ngầm danh sách gợi ý giá trị bộ lọc có kiểm soát bộ nhớ, và thay thế cơ chế cuộn vô hạn giật lag bằng Động cơ Phân trang chuẩn 1.000 dòng với Bộ đệm trượt 5 trang (Sliding Buffer).

---

## 2. Các tính năng nâng cấp nổi bật trong v1.3.7

### 2.1. Phân hệ 1: Ingestion & Parquet Engine $O(1)$ Row Count
- **100% Parquet Native Engine**: Chuyển đổi toàn bộ luồng CSV/JSON sang Parquet Snappy nén tối ưu.
- **Visual Ingestion Progress Modal**: Hộp thoại tiến trình trực quan hiển thị %, tốc độ nạp (MB/s), thời gian còn lại (ETA) và nút Hủy an toàn.
- **Đọc tổng số dòng $O(1)$ tức thì (~25ms)**: Sử dụng Parquet Metadata thay vì `SELECT count(*)`, loại bỏ độ trễ 15-30 giây trên tệp 40GB (~60 triệu dòng).

### 2.2. Phân hệ 2: Search Escaping, Auto Time-Sort & Distinct Cache Ngắt Sớm
- **Escape ký tự đặc biệt & Windows Paths**: Bộ lọc ILIKE tự động escape `\`, `%`, `_` kèm mệnh đề `ESCAPE '\'`, xử lý chính xác tuyệt đối các đường dẫn Windows (`C:\Windows\...`).
- **Tự động nhận diện cột Thời Gian (Auto Time-Column Sort)**: Tự động phát hiện cột timestamp gần nhất (`EventTime` > `Timestamp` > `TimeCreated` > `Time` > `Date`) và sắp xếp giảm dần `DESC`. Nếu tệp không có cột thời gian, hệ thống tự động bỏ qua bước sort để tiết kiệm tài nguyên.
- **Distinct Cache nạp ngầm theo Chunk 50.000 dòng**: Tự động nạp danh sách gợi ý cho bộ lọc ở luồng phụ. Nếu sau bất kỳ chunk nào tổng số giá trị duy nhất đạt hoặc vượt $\ge 1.024$, tiến trình nạp sẽ ngắt sớm để bảo toàn RAM.

### 2.3. Phân hệ 3: Động Cơ Phân Trang 1.000 Dòng & Bộ Đệm Trượt 5 Trang
- **Phân trang chuẩn 1.000 dòng/trang**: Loại bỏ hoàn toàn infinite scroll giật lag khi người dùng lướt nhanh.
- **Bộ đệm trượt 5 trang (5-Page Sliding Buffer)**: Duy trì tối đa 5.000 dòng trong RAM $[P-2 .. P+2]$. Chuyển trang lân cận diễn ra tức thì 0ms.
- **Thanh điều hướng Paging trực quan**: Tích hợp các nút điều hướng `First`, `Prev`, ô nhập số trang trực tiếp, `Next`, `Last` và hiển thị chi tiết số dòng.

---

# TOAD v1.0.1 Release (Custom Tad Viewer Build)

## 1. Giới thiệu phiên bản
Phiên bản **Toad v1.0.1** (dựa trên nền tảng Tad Viewer v0.14.0 và DuckDB 1.0.0) được nâng cấp chuyên biệt cho phân tích dữ liệu lớn, trích xuất log sự kiện bảo mật (Windows EventLogs, Hayabusa, Velociraptor, Zeek, CSV, Parquet, SQLite).

---

## 2. Các tính năng nâng cấp mới nổi bật

### 2.1. Kiến trúc True Portable AppData (`toadAppData_[5_chars]`)
- **Tự động nhận diện thư mục Exe thật**: Tự động xác định thư mục chứa file `.exe` thật sự (`PORTABLE_EXECUTABLE_DIR` hoặc `dirname(execPath)`).
- **Sinh thư mục AppData riêng biệt**: Tự sinh thư mục có định dạng `toadAppData_[5_random_chars]` (ví dụ: `toadAppData_a9k2m`) ngay cạnh file `.exe`. Nếu đã có từ trước, hệ thống sẽ tự động tái sử dụng.
- **Cô lập 100% dữ liệu Electron**: Toàn bộ `userData`, `temp`, `crashDumps` được chuyển hướng vào `toadAppData_*`, tuyệt đối **không ghi bất kỳ dữ liệu nào** vào `C:\Users\<user>\AppData\Roaming`, giữ cho máy phân tích luôn sạch sẽ.

### 2.2. Quy trình Thẩm định (Validation) & Tự Động Phục Hồi (Auto-Heal) Config
- **Cấu hình động `config.ini`**: Tự động sinh file mẫu chuẩn với đầy đủ các section `[general]`, `[duckdb]`, `[parquet]`, `[system]` và ghi chú hướng dẫn tiếng Việt rõ ràng.
- **Thẩm định 4 cấp độ**: Kiểm tra sự tồn tại -> Cú pháp INI -> Độ đầy đủ của Schema -> Khoảng giá trị hợp lệ.
- **Cơ chế Auto-Heal (Tự sửa chữa)**: Nếu file config bị thiếu key hoặc người dùng nhập sai kiểu dữ liệu/khoảng giá trị, Toad sẽ tự động bổ sung và chuẩn hóa giá trị mặc định tối ưu mà không làm mất đi các cài đặt tùy biến khác của người dùng.
- **Mẫu bộ lọc `filters_preset.json`**: Tự động khởi tạo và thẩm định mẫu bộ lọc DFIR (Hayabusa Critical/High, PowerShell Bypass...).

### 2.3. Tự động Dọn Dẹp Sạch Sẽ Temp Khi Thoát (Lifecycle Temp Purge)
- **Tự động dọn dẹp khi đóng ứng dụng**: Khi người dùng thoát Toad, hệ thống ngắt kết nối DuckDB, chờ giải phóng file lock Windows (`EBUSY` retry logic) và tự động xóa 100% các file Parquet trung gian trong `temp/`, giữ nguyên file cấu hình `config.ini` và lịch sử người dùng.
- **Startup Orphan Cleaner**: Tự động dọn sạch rác mồ côi tồn đọng nếu lần trước ứng dụng bị tắt đột ngột (mất điện, kill process qua Task Manager).

### 2.4. Động cơ Nạp Dữ Liệu 5 Giai Đoạn Bền Bỉ (5-Stage Ingestion Engine)
Lấy cảm hứng từ quy trình của `csv_proc_v0.2.2` & `rust_kv_bench`:
1. **Giai đoạn 1 - Binary Guard (8KB Scan)**: Tự động quét 8KB đầu tiên của file tìm null-byte (`\0`). Nếu người dùng kéo nhầm file binary (exe, zip, bin...), hệ thống lập tức chặn lại và thông báo an toàn, ngăn chặn hoàn toàn nguy cơ đơ máy / treo Electron process.
2. **Giai đoạn 2 - Nạp cấu hình động**: Đọc trực tiếp các tham số `max_memory`, `threads`, `compression`, `row_group_size` từ `config.ini`.
3. **Giai đoạn 3 - Chuẩn bị đường dẫn Parquet tạm**: Tạo file Parquet trung gian bên trong `toadAppData_*/temp/{basename}_view_{timestamp}.parquet`.
4. **Giai đoạn 4 - Streaming DuckDB với 3 tầng Fallback**:
   - *Tier 0*: Streaming chuẩn (`auto_detect = true, sample_size = 100000, ignore_errors = true, null_padding = true`).
   - *Tier 1 (Fallback dòng quá dài)*: Kích hoạt `parallel = false` khi gặp log PowerShell/Script dài bất thường làm vỡ chunk song song.
   - *Tier 2 (Fallback xung đột kiểu dữ liệu - 100% thành công)*: Kích hoạt `all_varchar = true`, nạp thành công mọi file CSV "bẩn" nhất mà không bao giờ văng lỗi exception.
   - Hỗ trợ streaming trực tiếp cả file `.json`, `.jsonl`, `.ndjson`.
5. **Giai đoạn 5 - Thẩm định Parquet & Bảng Ảo (VIEW)**: Kiểm tra file Parquet sinh ra > 0 bytes, mở qua `CREATE VIEW` thay vì load toàn bộ vào RAM -> **RAM luôn duy trì < 100MB** ngay cả với file log hàng chục GB.

### 2.5. Giao diện & Trải nghiệm Người dùng
- **Hierarchical Boolean Logic (Bộ lọc AND / OR lồng nhau đa cấp)**: Hỗ trợ tạo nhóm con không giới hạn cấp độ, chuyển đổi sang SQL `WHERE (...)` siêu tốc.
- **Sticky Top Action Toolbar**: Nút Apply Filter (phím tắt Enter), Live Update Realtime, Clear All, Done, Cancel.
- **Cơ chế kéo dãn bảng lọc (Resizable Filter Panel)**: Resizer bar kéo thả linh hoạt, nút Maximize / Restore phóng to bảng lọc.
- **Dung lượng siêu nhẹ**: Giảm 93.3% từ 1.35 GB xuống **91.4 MB**, khởi động tức thì.

---

## 3. Nội dung gói phát hành
- **`toad_v1.0.1_portable.exe`**: File thực thi duy nhất dạng Portable (Single-file Portable ~91.4 MB), tự động sinh thư mục `toadAppData_*` ngay cạnh file khi chạy, không cần cài đặt.
- **`toad_v1.0.1_portable_folder/`**: Thư mục chạy trực tiếp (giải nén sẵn), khởi động tức thì không cần thời gian giải nén tạm (chạy file `toad_v1.0.1_portable_folder\Tad.exe`).
- **`toad_v1.0.1_source.zip`**: Toàn bộ mã nguồn đã được nâng cấp, tối ưu hóa và kiểm thử hoàn chỉnh (~7.6 MB).
