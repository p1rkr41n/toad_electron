# ĐỊNH HƯỚNG TỐI ƯU HIỆU NĂNG & NÂNG CẤP KIẾN TRÚC TOAD TRONG TƯƠNG LAI (FUTURE ROADMAP)

> **Dự án:** TOAD Viewer - Công cụ Phân tích Điều tra Số & Giám sát Log (DFIR / SOC Log Analyzer)  
> **Tài liệu:** future.md  
> **Mục tiêu trọng tâm:** Tối ưu hóa thời gian khởi động ứng dụng (Startup Latency Reduction) từ 3 - 5s xuống dưới 0.8 - 1.0s và hoàn thiện kiến trúc mô-đun hóa.  
> **Trạng thái:** Đề xuất kỹ thuật tương lai (Backlog / Chưa áp dụng mã nguồn).

---

## 1. TỔNG QUAN BỐI CẢNH

Trong quá trình phát triển từ các phiên bản v1.3.7 đến v1.3.9.1, Toad đã được tích hợp thêm nhiều phân hệ mạnh mẽ:
- Động cơ lõi Rust SIMD độc lập (`toad-core.exe`) phục vụ giải mã log EVTX tốc độ cao.
- Bộ máy cơ sở dữ liệu nhúng DuckDB 1.0.0 với khả năng xử lý song song và tối ưu bộ đệm RAM (`max_memory = auto`).
- Hệ thống quản lý cấu hình di động và dọn dẹp tự động qua `config.ini` và `toadAppData`.
- Các tính năng UI mới: Master-Detail Continuous Triage, Cố định cột nút mở rộng (`_expand`), thanh phân trang linh hoạt không giới hạn trần.

Tuy nhiên, việc tích hợp nhiều thành phần khiến thời gian khởi động lần đầu của file thực thi di động (`Toad.exe`) dao động từ **3 đến 5 giây**. Dưới đây là 3 hướng tối ưu kỹ thuật khả thi đã được nghiên cứu và đề xuất để triển khai trong tương lai.

---

## 2. CHI TIẾT 3 ĐỀ XUẤT TỐI ƯU KHẢ THI TRONG TƯƠNG LAI

### 📌 Đề xuất 1: Phân phối thêm bản "Fast Portable" (Folder / ZIP)
* **Mô tả**: Đóng gói ứng dụng dưới dạng một thư mục giải nén sẵn (chứa `Toad.exe` gốc cùng toàn bộ các thư viện `.dll`, runtime Electron và thư mục `resources/app.asar`), nén lại thành file `Toad_vX.X_fast_portable.zip`.
* **Hiện trạng hiện tại**:
  - Bản phân phối hiện nay ([`Toad.exe`](file:///D:/Shared_UserData/Downloads/tad/Toad.exe)) là dạng **Single-file Self-Extracting Executable** do `electron-builder` nén 7z một tệp.
  - Mỗi lần người dùng click đúp, Windows phải tự động bung giải nén toàn bộ ~250MB vào thư mục tạm `C:\Users\<user>\AppData\Local\Temp\<random_hash>\` rồi mới thực thi. Bước này chiếm tới **60% - 75%** tổng thời gian chờ khởi động.
* **Phương án triển khai**:
  - Tận dụng thư mục [`packages/tad-app/release/win-unpacked`](file:///D:/Shared_UserData/Downloads/tad/tad-master/packages/tad-app/release/win-unpacked) vốn đã được sinh ra trong quá trình build.
  - Viết script tự động nén thư mục này thành `releases/toad_vX.X_fast_portable.zip`.
  - Người dùng chỉ cần giải nén 1 lần duy nhất vào một thư mục bất kỳ trên ổ đĩa hoặc USB, sau đó click chạy trực tiếp file `Toad.exe` bên trong.
* **Hiệu quả dự kiến**: Ứng dụng khởi động ngay lập tức trong **~1.0 giây**, loại bỏ hoàn toàn độ trễ tự bung nén vào thư mục Temp của Windows.

---

### 📌 Đề xuất 2: Chuyển `init-portable` sang Bất đồng bộ (Async Non-Blocking)
* **Mô tả**: Không để tác vụ khởi tạo môi trường di động và gọi Rust Core chặn (block) luồng chính (Main Process) của Electron trong quá trình khởi động.
* **Hiện trạng hiện tại**:
  - Tại [`packages/tad-app/app/portableAppData.ts:L644`](file:///D:/Shared_UserData/Downloads/tad/tad-master/packages/tad-app/app/portableAppData.ts#L644), hàm `initPortableEnvironment()` đang dùng lệnh đồng bộ chặn luồng:
    ```typescript
    const output = child_process.execFileSync(toadCore, ["init-portable", exeDir], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 15000,
    });
    ```
  - Tại [`packages/tad-app/app/main.ts:L504`](file:///D:/Shared_UserData/Downloads/tad/tad-master/packages/tad-app/app/main.ts#L504), lệnh này chạy đồng bộ ngay trước khi tạo cửa sổ, khiến Electron Main Process bị đóng băng khoảng 200 - 400ms.
* **Phương án triển khai**:
  - **Tách 2 giai đoạn khởi tạo**:
    1. *Giai đoạn 1 (Thiết yếu - Sync siêu nhẹ)*: Xác định nhanh đường dẫn thư mục di động và gọi ngay `app.setPath("userData", ...)` để Electron kịp nhận diện trước sự kiện `ready`.
    2. *Giai đoạn 2 (Tác vụ nền - Async Non-blocking)*: Chuyển lệnh gọi `toad-core init-portable`, tác vụ dọn dẹp tệp rác temp tồn đọng (`cleanTempDir`) và đọc chi tiết cấu hình sang `child_process.execFile` bất đồng bộ (Promise/async-await), chạy song song trong khi cửa sổ đang render.
* **Hiệu quả dự kiến**: Luồng chính của Electron thông suốt 100%, loại bỏ độ trễ nghẽn CPU lúc khởi động ban đầu.

---

### 📌 Đề xuất 3: Tối ưu Webpack (Code Splitting / Lazy Loading)
* **Mô tả**: Phân tách gói mã nguồn giao diện (Bundle Splitting), chỉ nạp các thành phần giao diện và thư viện nặng khi người dùng thực sự mở tính năng đó.
* **Hiện trạng hiện tại**:
  - Cấu hình Webpack tại [`packages/tad-app/webpack.config.js`](file:///D:/Shared_UserData/Downloads/tad/tad-master/packages/tad-app/webpack.config.js) hiện đóng gói toàn bộ ứng dụng Renderer thành **1 file nguyên khối khổng lồ**:
    - `tadapp.bundle.js`: **4.68 MiB**
    - `tadviewer.js`: **2.5 MiB**
  - Trình duyệt Chromium của Electron phải tải, biên dịch và parse toàn bộ ~7.2 MiB mã JavaScript (bao gồm BlueprintJS components, DuckDB client, biểu đồ Pivot, bộ phân tích cú pháp RelTab) ngay từ khung hình đầu tiên.
* **Phương án triển khai**:
  - Áp dụng kỹ thuật `React.lazy()` và dynamic `import()` của ES6:
    - Module tài liệu trợ giúp (`QuickStartModal`, `HelpView`): Chỉ nạp khi bấm menu Help.
    - Module biểu đồ và Pivot nâng cao: Chỉ nạp khi người dùng kích hoạt tab Pivot/Chart.
    - Bộ lọc đa cột phức tạp và xuất tệp (Export CSV/Parquet): Nạp theo nhu cầu (on-demand).
  - Cấu hình `optimization.splitChunks` trong Webpack để tách các thư viện bên thứ ba (`vendor.bundle.js`) và lưu cache trình duyệt lâu dài.
* **Hiệu quả dự kiến**: Giảm kích thước bundle khởi động ban đầu xuống còn **< 1.2 MiB**, giảm **50% thời gian phân tích cú pháp JavaScript** của V8 Engine.

---

### 📌 Đề xuất 4: Nâng cấp Hệ thống Trích xuất Regex Đa năng (Flexible Sample Navigator & Live Column Renaming)
* **Mô tả**: Nâng cấp toàn diện hộp thoại `Toad Regex` phục vụ phân tích log chuyên sâu: cho phép người dùng duyệt qua nhiều dòng sự kiện khác nhau trong bảng hoặc tự do chỉnh sửa mẫu thử nghiệm (thay vì bị cố định ở dòng đầu tiên), đồng thời cho phép đặt lại tên cột trực tiếp ngay tại bảng Live Preview khi các nhóm trích xuất (Capture Groups) được sinh ra.
* **Hiện trạng hiện tại**:
  - Tại [`RegexDialog.tsx`](file:///D:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/src/components/RegexDialog.tsx), hàm `fetchSampleEvent()` chỉ quét và lấy cố định **dòng đầu tiên có dữ liệu khác rỗng** (`rawData[0]`). Người dùng không thể chuyển sang xem dòng thứ 5 hay dòng thứ 10 để kiểm tra độ khớp của biểu thức Regex trên các dạng log biến thiên.
  - Tên cột sinh ra trong câu lệnh DuckDB `CREATE VIEW` đang bị **gán cứng tự động theo định dạng `str0`, `str1`, `str2`...** tại [`actions.ts:L903`](file:///D:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/src/actions.ts#L903). Khi hiển thị trên DataGrid chính, người dùng rất khó nhớ cột nào chứa thông tin gì (như IP, Port, User, Action) mà không mở lại hộp thoại Regex.
* **Phương án triển khai**:
  - **Sample Navigator & Flexible Editor**:
    - Trích xuất danh sách tất cả các dòng non-null từ `viewState.dataView.rawData`.
    - Bổ sung thanh điều hướng dòng `[ ◀ Trước ] Sự kiện X / Y [ Tiếp ▶ ]` cho phép chuyển đổi tức thì giữa các dòng sự kiện trong bảng dữ liệu.
    - Cho phép gõ, dán tự do bất kỳ chuỗi log mẫu nào vào TextArea, kèm nút `↺ Reset về dòng gốc` để khôi phục dữ liệu ban đầu.
  - **Live Column Renaming & Named Group Detection**:
    - Tại bảng `Live Output Preview`, hiển thị danh sách các nhóm trích xuất dạng bảng tương tác với ô nhập `<InputGroup>` cho phép gõ trực tiếp tên cột mong muốn (ví dụ: `Client_IP`, `User_Agent`, `Status_Code`).
    - Tự động nhận diện **Named Capture Groups** trong Regex (ví dụ: `(?<ip>\d+\.\d+\.\d+\.\d+)` hoặc `(?<action>[A-Z]+)`) để tự động điền sẵn tên cột mà người dùng không cần gõ lại.
    - Cập nhật hàm `applyRegexExtraction(targetCol, regexPattern, customColNames, stateRef)` trong `actions.ts` để sinh câu lệnh DuckDB View với tên cột người dùng đã định nghĩa:
      ```sql
      CREATE VIEW "table_rx1" AS SELECT *, 
        regexp_extract("raw_msg", '...', 1) AS "Client_IP", 
        regexp_extract("raw_msg", '...', 2) AS "Status_Code" 
      FROM "table"
      ```
* **Hiệu quả dự kiến**: Tăng 300% hiệu suất trích xuất và chuẩn hóa trường log trong các tác vụ DFIR / SOC điều tra sự cố; các cột dữ liệu sinh ra lập tức có ý nghĩa rõ ràng trên DataGrid chính mà không cần bước đổi tên thủ công.

---

### 📌 Đề xuất 5: Điều tiết Luồng Nền Động khi Mở Bảng (Dynamic Thread Pacing - Phương Pháp 3)
* **Mô tả**: Tạm thời hạ mức tiêu thụ tài nguyên của tiến trình nạp nền `db_ingest` trong khoảnh khắc người dùng tương tác mở một bảng dữ liệu mới, sau đó tự động khôi phục toàn bộ công suất.
* **Hiện trạng & Lý do chưa triển khai ngay**:
  - Khi triển khai đồng thời Phương pháp 1 (Fix IPC + Windows I/O Priority) và Phương pháp 2 (RAM First-Page Micro-Cache), bảng dữ liệu đã mở ra tức thì trong $0\text{ ms} - 2\text{ ms}$ từ bộ nhớ mà không chạm đĩa, nên việc can thiệp hạ luồng CPU của DuckDB chưa cần thiết ở giai đoạn hiện tại.
* **Phương án triển khai tương lai**:
  - Bổ sung cơ chế hook sự kiện `onUserOpenTableStart`: Gửi tín hiệu hạ tạm thời `SET threads = 2` trên `ingestDb` trong vòng 500ms để nhường tối đa bus CPU/RAM cho việc khởi tạo các component React của DataGrid.
  - Khi sự kiện `onUserOpenTableComplete` phát ra (hoặc sau timeout 500ms), tự động khôi phục lại `SET threads = background_threads` ban đầu.
* **Hiệu quả dự kiến**: Giảm thiểu tối đa hiện tượng cạnh tranh tài nguyên V8 render UI trên các máy trạm có số lượng core CPU ít ($\le 4$ cores).

---

### 📌 Đề xuất 6: Tối ưu hóa Ghi Đĩa Tuần tự Khối Lớn (Batch Sequential I/O row_group_size = 122880 - Phương Pháp 4)
* **Mô tả**: Nâng cao kích thước khối Parquet (`row_group_size`) trong pipeline chuyển đổi của DuckDB để chuyển đổi toàn bộ I/O ghi từ dạng ngắt quãng nhỏ sang ghi tuần tự khối lớn (Large Sequential Write).
* **Hiện trạng & Lý do chưa triển khai ngay**:
  - Giá trị hiện tại `row_group_size = 25000` đang hoạt động ổn định và cân bằng tốt trên hầu hết các máy trạm có RAM từ 8GB đến 16GB. Việc tăng lên `122880` cần được đánh giá thêm mức tiêu thụ RAM trên các tập dữ liệu có số lượng cột cực lớn (> 200 cột).
* **Phương án triển khai tương lai**:
  - Thêm tùy chọn `row_group_size` linh hoạt trong `config.ini` dưới mục `[parquet]`:
    ```ini
    [parquet]
    compression = snappy
    row_group_size = 122880  # Kích thước khối lớn tối ưu cho ổ cứng HDD / SATA SSD
    ```
  - Xây dựng thuật toán tự động tính toán `dynamic_row_group_size` dựa trên số lượng cột và kích thước RAM khả dụng: nếu bảng ít cột (< 30 cột) và RAM lớn (> 16GB), tự động áp dụng `row_group_size = 122880`.
* **Hiệu quả dự kiến**: Giảm 70% số lượng lần gọi hàm ghi đĩa ngẫu nhiên, tăng tuổi thọ và giảm nhiệt độ SSD, tạo các khoảng lặng I/O tự nhiên (I/O breathing gaps) cho hệ điều hành.

---

## 3. LỘ TRÌNH TRIỂN KHAI KHUYẾN NGHỊ (RECOMMENDED IMPLEMENTATION PHASES)

| Giai Đoạn | Hạng Mục Công Việc | Mức Độ Phức Tạp | Tác Động / Lợi Ích |
|:---:|---|:---:|:---:|
| **Phase 1** | **Bản Fast Portable (Folder / ZIP)**: Bổ sung script tạo file zip của `win-unpacked` vào quy trình release. | Thấp (1 - 2 giờ) | 🟢 **Giảm ngay 2.5 - 3.5 giây** thời gian khởi động |
| **Phase 2** | **Bất đồng bộ hóa `init-portable`**: Tách nhẹ phase `setPath` và đẩy dọn dẹp temp/config sang async. | Trung bình (0.5 ngày) | 🟡 **Giảm thêm 200 - 400ms** |
| **Phase 3** | **Webpack Code Splitting**: Refactor các component lớn sang `React.lazy()` và cấu hình `splitChunks`. | Cao (1 - 2 ngày) | 🟡 **Giảm thêm 300 - 500ms** thời gian render UI |
| **Phase 4** | **Nâng cấp Hệ thống Regex Đa năng**: Tích hợp Sample Navigator, Custom Editor và Live Column Renaming. | Trung bình (1 ngày) | 🚀 **Tối ưu vượt bậc trải nghiệm phân tích DFIR & trích xuất log** |
| **Phase 5** | **Dynamic Thread Pacing (Phương Pháp 3)**: Điều tiết luồng CPU động khi mở bảng trên máy cấu hình yếu. | Thấp (0.5 ngày) | 🟢 **Bảo đảm độ mượt trên máy $\le 4$ cores** |
| **Phase 6** | **Batch Sequential I/O (Phương Pháp 4)**: Cấu hình `row_group_size = 122880` thích ứng theo RAM/cột. | Thấp (0.5 ngày) | 🟢 **Tối ưu hóa I/O tuần tự khối lớn trên SSD/HDD** |

---

## 4. TÀI LIỆU LIÊN QUAN

- [BA_PHUONG_AN_SUA_CHUA_VA_NANG_CAP_v1.3.9.1.md](file:///D:/Shared_UserData/Downloads/tad/docs/BA_PHUONG_AN_SUA_CHUA_VA_NANG_CAP_v1.3.9.1.md)
- [RELEASE_NOTES.md](file:///D:/Shared_UserData/Downloads/tad/releases/RELEASE_NOTES.md)
- [QUICK_START.md](file:///D:/Shared_UserData/Downloads/tad/QUICK_START.md)
- [DFIR_FEATURES_ROADMAP_PLAN.md](file:///D:/Shared_UserData/Downloads/tad/docs/DFIR_FEATURES_ROADMAP_PLAN.md)
