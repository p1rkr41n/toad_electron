# KẾ HOẠCH NÂNG CẤP VÀ PHÁT TRIỂN HỆ THỐNG TOAD (DFIR LOG ANALYSIS TOOL)
> **Phiên bản hiện tại:** v1.3.3 (Filter Builder & Grid Unification)  
> **Trạng thái thực hiện:**
> - ✅ **Phase 1 (v1.3.0 - Speed & Pivot)**: Hoàn thành, đóng gói binary `toad_v1.3.0_portable.exe` & QA Test 11/11 Passed.
> - ✅ **Phase 2 (v1.3.1 - Forensic Deep-Dive)**: Hoàn thành, đóng gói binary `toad_v1.3.1_portable.exe` & `Toad.exe` (92.18 MB) & QA Test 20/20 Passed.
> - ✅ **Bản vá ổn định (v1.3.2 - Filter & IPC Fix)**: Sửa triệt để lỗi IPC deserialization `subExp.toSqlWhere is not a function` khi dùng Omnisearch và Right-Click Filter; tích hợp hệ thống kiểm soát phiên bản **Jujutsu (`jj`)** local cho dự án.
> - ✅ **Bản chuẩn hóa (v1.3.3 - Filter Unification)**: Loại bỏ Omnisearch toolbar (tránh lỗi xung đột cột ảo `Rec` trên DuckDB); đồng nhất 100% bộ lọc chuột phải trên ô lưới với panel Filter Builder bên dưới; gán phím tắt `Ctrl+F` mở Filter Builder; toàn bộ mã nguồn được version control bằng Jujutsu (`jj`).
> - 🛑 **Phạm vi hoàn tất:** Đã hoàn thiện và chuẩn hóa trọn vẹn 4 tính năng đầu tiên theo chỉ đạo của người dùng. Các tính năng từ Severity trở đi được giữ nguyên/không làm theo yêu cầu.

---

## I. BẢNG TỔNG HỢP TOÀN BỘ TÍNH NĂNG VÀ CẢI TIẾN HỆ THỐNG

| STT | Tên Tính Năng / Hạng Mục | Phân Loại | Module / File Liên Quan | Giai Đoạn (Phase) | Trạng Thái | Mức Độ Ưu Tiên | Giá Trị Với Chuyên Viên IR / SOC |
|:---:|---|---|---|---|:---:|:---:|---|
| **1** | **Right-Click Context Menu** *(Filter In, Exclude, Time Bracket $\pm 5$m, Copy)* | Điều Hướng & Pivot | `DataGrid.tsx`, `GridPane.tsx` | **Phase 1** *(v1.3.0)* | ✅ **Đã hoàn thành & QA** | **P0 (Cực cao)** | Lọc ngay lập tức giá trị khả nghi, loại trừ dữ liệu nhiễu (noise reduction) và khoanh vùng thời gian sự cố chỉ với 1 cú click chuột |
| **2** | **Omnisearch / Global IoC Grep** *(Tìm kiếm chuỗi IoC trên tất cả các cột)* | Truy Vấn / Tìm Kiếm | `AppPane.tsx`, `reltab/FilterExp.ts` | **Phase 1** *(v1.3.0)* | ✅ **Đã hoàn thành & QA** | **P0 (Cực cao)** | Cho phép truy lùng dấu vết tấn công (IP, Hash, Username, Domain, Command-line) mà không cần biết chính xác tên cột chứa dữ liệu |
| **3** | **Type-Aware Filter Guard & Friendly Error Toast** *(Khắc phục triệt để lỗi kiểu dữ liệu)* | Ổn Định Hệ Thống | `FilterEditorRow.tsx`, `reltab` | **Phase 1** *(v1.3.0)* | ✅ **Đã hoàn thành & QA** | **P1 (Cao)** | Loại bỏ toàn bộ lỗi DuckDB Query Error khi lọc (như gọi `contains` trên số/ngày), tự động ẩn các toán tử không tương thích với kiểu cột |
| **4** | **Forensic In-App Decoders & Defanger** *(Base64 UTF-16LE, URL Decode, Defang IP/URL)* | Giải Mã Bằng Chứng | `EventDetailSidebar.tsx`, `ForensicDecoder.ts` | **Phase 2** *(v1.3.1)* | ✅ **Đã hoàn thành & QA** | **P1 (Cao)** | Tự động phát hiện và giải mã tức thì các lệnh PowerShell mã hóa Base64 (`-enc`), giải mã URL traversal, và vô hiệu hóa link độc hại chống click nhầm |
| **5** | **Severity & Threat Highlighting** *(Màu sắc trực quan cho Critical / High / Warning)* | Trực Quan Hóa | `DataGrid.tsx`, `grid.less` | **Phase 2** | 🛑 *Dừng theo yêu cầu* | **P1 (Cao)** | Làm nổi bật ngay các sự kiện mức độ nguy hiểm cao (Red/Orange/Blue) từ Hayabusa, Sigma, Sysmon |
| **6** | **UI/Text Polish & Forensic Terminology** *(Đồng bộ ngôn ngữ & chuẩn hóa nhãn)* | Trải Nghiệm UI | `quickstart.html`, Toolbar, Tooltip | **Phase 2** | 🛑 *Dừng theo yêu cầu* | **P2 (Trung bình)** | Chuẩn hóa thuật ngữ phân tích sự cố (Pivot, IoC, Timeline, Filter Expression) |
| **7** | **Delta Time ($\Delta t$) Analysis** *(Khoảng cách thời gian giữa 2 sự kiện liên tiếp)* | Phân Tích Timeline | `reltab-duckdb`, SQL Window Functions | **Phase 3** | 🛑 *Dừng theo yêu cầu* | **P1 (Cao)** | Nhận diện ngay C2 Beaconing, Password Brute-force ($\Delta t < 0.1\text{s}$) và tiến trình rà quét |
| **8** | **Evidence Bookmarking & Incident Timeline Export** *(Ghim bằng chứng & xuất báo cáo)* | Báo Cáo Điều Tra | `tadviewer/state`, Export Module | **Phase 3** | 🛑 *Dừng theo yêu cầu* | **P1 (Cao)** | Đánh dấu các sự kiện cấu thành chuỗi tấn công (Kill Chain) và xuất báo cáo sự cố (Incident Timeline) |
| **9** | **Threat Hunting Preset Packs** *(Mẫu bộ lọc dựng sẵn cho Windows Event, Hayabusa, Sysmon)* | Tự Động Hóa Săn Lùng | Preset Library JSON, Quick Filters | **Phase 3** | 🛑 *Dừng theo yêu cầu* | **P2 (Trung bình)** | Tải nhanh các bộ lọc săn mối nguy phổ biến: RDP Lateral Movement, LOLBAS Execution, Pass-the-Hash |ự kiện cấu thành chuỗi tấn công (Kill Chain) và xuất báo cáo sự cố (Incident Timeline) dạng Markdown hoặc CSV sạch | Trung bình |
| **9** | **Threat Hunting Preset Packs** *(Mẫu bộ lọc dựng sẵn cho Windows Event, Hayabusa, Sysmon)* | Tự Động Hóa Săn Lùng | Preset Library JSON, Quick Filters | **Phase 3** *(v1.4.0)* | **P2 (Trung bình)** | Tải nhanh các bộ lọc săn mối nguy phổ biến: RDP Lateral Movement, LOLBAS Execution, Pass-the-Hash, Kerberoasting mà không cần nhớ cú pháp | Thấp - Trung bình |

---

## II. LỘ TRÌNH VÀ KẾ HOẠCH TRIỂN KHAI THEO TỪNG GIAI ĐOẠN

```mermaid
graph LR
    subgraph Phase 1: v1.3.0 Speed & Pivot
        F1[1. Context Menu]
        F2[2. Omnisearch Grep]
        F3[3. Filter Type Guard]
    end
    subgraph Phase 2: v1.3.1 Deep Forensic
        F4[4. Decoders & Defanger]
        F5[5. Severity Badges]
        F6[6. UI/Text Polish]
    end
    subgraph Phase 3: v1.4.0 Advanced IR
        F7[7. Delta Time Analysis]
        F8[8. Bookmarking & Export]
        F9[9. Hunting Presets]
    end
    Phase 1 --> Phase 2 --> Phase 3
```

---

## III. KẾ HOẠCH CHI TIẾT TỪNG TÍNH NĂNG (CẬP NHẬT & QA TEST)

### 1. Tính Năng: Right-Click Context Menu (Menu Chuột Phải Ngữ Cảnh)
* **Vấn đề giải quyết trong IR**:  
  Khi điều tra viên phát hiện một giá trị đáng ngờ trên bảng (ví dụ IP máy tấn công, tên tiến trình độc hại, hoặc một mốc thời gian), việc phải cuộn lên thanh công cụ, mở dropdown chọn tên cột, chọn toán tử rồi gõ lại chuỗi tốn rất nhiều thời gian. Menu chuột phải cho phép "Pivot" trực tiếp trên ô dữ liệu.
* **Cập nhật kỹ thuật như thế nào**:
  * **File can thiệp**: `packages/tadviewer/src/components/DataGrid.tsx`.
  * **Cơ chế**: Lắng nghe sự kiện `grid.onContextMenu(e, args)` của SlickGrid.
  * **Xử lý dữ liệu**: Lấy `cell = args.cell`, `row = args.row`, tìm ra `columnId = grid.getColumns()[cell].id` và giá trị `val = dataView.getItem(row)[columnId]`.
  * **Menu Actions (Blueprint ContextMenu)**:
    1. **"Filter for this value"**: Thêm `RelExp.binOp("=", columnId, val)` vào danh sách filter hiện tại của `ViewParams`.
    2. **"Exclude this value"**: Thêm `RelExp.binOp("<>", columnId, val)` (hỗ trợ lọc bỏ nhiễu/whitelist tức thì).
    3. **"Time Bracket (±5 minutes)"**: Nếu cột là kiểu `timestamp` hoặc `date`, tự động parse mốc thời gian $T$, tính $[T - 5\text{m}, T + 5\text{m}]$ và thêm 2 bộ lọc `>=` và `<=`.
    4. **"Copy Cell Value"**: Ghi đè nhanh giá trị ô vào Clipboard để tra cứu OSINT/VirusTotal.
* **Quy trình QA Test chi tiết**:
  * **Dataset kiểm thử**: `data_sample/Windows.EventLogs.Hayabusa_Results.csv` (37,241 dòng).
  * **Kịch bản 1 (Filter In)**: Click chuột phải vào ô cột `Channel` có giá trị `Security` $\rightarrow$ Chọn *Filter for this value* $\rightarrow$ **Kết quả mong đợi**: Bảng lập tức chỉ hiển thị các dòng có `Channel = 'Security'`, thanh Filter UI xuất hiện chip điều kiện tương ứng.
  * **Kịch bản 2 (Exclude Noise)**: Click chuột phải vào ô `TargetFilename` có giá trị `svchost.exe` $\rightarrow$ Chọn *Exclude this value* $\rightarrow$ **Kết quả mong đợi**: Không còn dòng nào chứa `svchost.exe` trong bảng dữ liệu.
  * **Kịch bản 3 (Time Bracket)**: Click chuột phải vào ô thời gian `2023-04-12 14:30:00` $\rightarrow$ Chọn *Time Bracket (±5 mins)* $\rightarrow$ **Kết quả mong đợi**: Bảng dữ liệu co hẹp lại chính xác trong khoảng từ `14:25:00` đến `14:35:00`.
  * **Kịch bản 4 (Edge cases)**: Kiểm tra click chuột phải trên ô chứa `NULL`, chuỗi rỗng `""`, chuỗi có dấu nháy đơn `O'Reilly`, đường dẫn Windows `C:\Windows\System32\` $\rightarrow$ **Kết quả mong đợi**: Không xảy ra lỗi SQL Injection hoặc crash ứng dụng.

---

### 2. Tính Năng: Omnisearch / Global IoC Grep (Tìm Kiếm Toàn Cục)
* **Vấn đề giải quyết trong IR**:  
  Khi nhận được một IoC (chỉ số xâm nhập) như mã băm SHA256, địa chỉ IP ngoại vi, tên User độc hại... điều tra viên không thể biết trước giá trị đó sẽ nằm ở cột `CommandLine`, `ParentCommandLine`, `TargetFilename`, `DestinationIp` hay `ScriptBlockText`. Omnisearch cho phép tìm kiếm chuỗi đó trên toàn bộ bảng.
* **Cập nhật kỹ thuật như thế nào**:
  * **File can thiệp**: `packages/tadviewer/src/components/AppPane.tsx` (UI thanh tìm kiếm `Ctrl+F`) và `packages/reltab/src/toSql.ts` (Backend SQL Query Builder).
  * **Cơ chế truy vấn DuckDB**:
    Khi tham số Omnisearch `searchTerm` được kích hoạt, câu truy vấn SQL chuyển đổi sang:
    ```sql
    WHERE CONCAT_WS(' ', COALESCE(col1::VARCHAR, ''), COALESCE(col2::VARCHAR, ''), ...) ILIKE '%<searchTerm>%'
    ```
    Hàm `CONCAT_WS` của DuckDB ghép toàn bộ các cột dưới dạng chuỗi và hàm `ILIKE` thực hiện tìm kiếm chuỗi con không phân biệt hoa thường với tốc độ SIMD cực nhanh.
  * Áp dụng kỹ thuật **Debounce 350ms** để đảm bảo không bắn query liên tục khi người dùng đang gõ.
* **Quy trình QA Test chi tiết**:
  * **Dataset kiểm thử**: `data_sample/Windows.EventLogs.Hayabusa_Results.csv` (25.6 MB).
  * **Kịch bản 1 (Tìm kiếm IP)**: Nhấn `Ctrl+F`, gõ IP `192.168.1.10` $\rightarrow$ **Kết quả mong đợi**: Trả về tất cả các sự kiện mạng, firewall, authentication có liên quan đến IP trên bất kỳ trường nào.
  * **Kịch bản 2 (Tìm kiếm câu lệnh chứa khoảng trắng)**: Gõ `powershell -enc` $\rightarrow$ **Kết quả mong đợi**: Trả về toàn bộ các dòng log liên quan đến thực thi mã PowerShell.
  * **Kịch bản 3 (Hiệu năng & Hủy tìm kiếm)**: Xóa trắng ô tìm kiếm $\rightarrow$ Bảng ngay lập tức hoàn nguyên về toàn bộ dữ liệu ban đầu mà không bị đơ hoặc giữ cache cũ.

---

### 3. Tính Năng: Type-Aware Filter Guard & Error Handling (Bảo Vệ Kiểu Dữ Liệu)
* **Vấn đề giải quyết trong IR**:  
  DuckDB là cơ sở dữ liệu có định kiểu mạnh (Strongly Typed). Khi người dùng vô tình chọn toán tử `contains` trên cột số (`integer`, `bigint`) hoặc thời gian (`timestamp`), DuckDB sẽ ném lỗi `Invalid Error: contains() requires varchar arguments`.
* **Cập nhật kỹ thuật như thế nào**:
  * **File can thiệp**: `packages/tadviewer/src/components/FilterEditorRow.tsx`.
  * **Cơ chế**:
    * Đọc kiểu cột (`colType`) từ Schema.
    * Nếu kiểu thuộc nhóm số (`integer`, `bigint`, `real`) hoặc thời gian (`date`, `timestamp`): Tự động loại bỏ toán tử `contains` khỏi dropdown toán tử.
    * Chỉ hiển thị các toán tử toán học phù hợp: `=`, `<>`, `>`, `>=`, `<`, `<=`, `is null`, `is not null`.
    * Thêm cơ chế kiểm tra tính hợp lệ trước khi cho bấm nút **Apply**: Nếu chọn cột số mà gõ ký tự chữ, nút Apply sẽ bị vô hiệu hóa kèm cảnh báo viền đỏ.
* **Quy trình QA Test chi tiết**:
  * **Kịch bản 1**: Mở Filter Editor $\rightarrow$ Chọn cột `EventID` (kiểu bigint/integer) $\rightarrow$ **Kết quả mong đợi**: Danh sách toán tử không hiển thị `contains`.
  * **Kịch bản 2**: Cố tình nhập giá trị không hợp lệ (ví dụ nhập chữ `abc` vào cột số) $\rightarrow$ **Kết quả mong đợi**: Nút Apply bị mờ (disabled), không thể kích hoạt truy vấn lỗi.
  * **Kịch bản 3 (QA Stress Test)**: Thử nghiệm chuyển đổi qua lại giữa 10 cột khác nhau với các kiểu dữ liệu khác nhau $\rightarrow$ Xác nhận trạng thái form cập nhật chính xác 100%.

---

### 4. Tính Năng: Forensic In-App Decoders & Defanger (Giải Mã Bằng Chứng)
* **Vấn đề giải quyết trong IR**:  
  Tin tặc thường xuyên sử dụng PowerShell EncodedCommand (Base64 định dạng UTF-16LE) hoặc URL Encoding để ẩn giấu payload. Chuyên viên IR thường phải copy ra ngoài sang CyberChef để giải mã. Tính năng này giải mã ngay tại chỗ trong ứng dụng.
* **Cập nhật kỹ thuật như thế nào**:
  * **File can thiệp**: `packages/tadviewer/src/components/EventDetailSidebar.tsx`, tạo mới `packages/tadviewer/src/utils/ForensicDecoder.ts`.
  * **Thuật toán**:
    * **Base64 UTF-16LE (PowerShell)**: Nhận diện chuỗi Base64 hợp lệ, chuyển đổi `Buffer.from(str, 'base64').toString('utf16le')` và `utf8`.
    * **URL Decoder**: `decodeURIComponent(str)`.
    * **Defanger**: Chuyển `http://` $\rightarrow$ `hxxp://`, `https://` $\rightarrow$ `hxxps://`, `1.1.1.1` $\rightarrow$ `1[.]1[.]1[.]1`, `domain.com` $\rightarrow$ `domain[.]com`.
  * **Giao diện**: Trong Sidebar chi tiết sự kiện, nếu ô dữ liệu có chứa chuỗi mã hóa, hiển thị thêm nút bấm nhỏ `[Decode]` và `[Defang]`. Khi click, mở một khung phụ hiển thị văn bản đã giải mã kèm nút Copy.
* **Quy trình QA Test chi tiết**:
  * **Dataset kiểm thử**: Mẫu log sự kiện chứa PowerShell Encoded Command (`powershell -enc JABjAGwAYQBzAHMA...`).
  * **Kịch bản 1 (Base64 UTF-16LE)**: Bấm vào dòng sự kiện $\rightarrow$ Mở Sidebar $\rightarrow$ Bấm nút `[Decode Base64]` $\rightarrow$ **Kết quả mong đợi**: Hiển thị chính xác mã PowerShell gốc có thể đọc được bằng mắt thường.
  * **Kịch bản 2 (URL Decode)**: Thử nghiệm với chuỗi `GET /vuln?id=%27%20OR%201%3D1--` $\rightarrow$ Bấm `[Decode URL]` $\rightarrow$ **Kết quả mong đợi**: Hiển thị `/vuln?id=' OR 1=1--`.
  * **Kịch bản 3 (Defang Link)**: Bấm nút `[Defang]` $\rightarrow$ **Kết quả mong đợi**: Toàn bộ liên kết và địa chỉ IP bị vô hiệu hóa an toàn, không thể kích hoạt ngoài ý muốn.

---

### 5. Tính Năng: Severity & Threat Level Badge Highlighting (Đánh Dấu Mức Độ Nguy Hiểm)
* **Vấn đề giải quyết trong IR**:  
  Trong hàng trăm nghìn dòng log, mắt thường rất dễ bỏ sót các cảnh báo nguy hiểm nếu toàn bộ bảng chỉ có một màu văn bản đồng nhất.
* **Cập nhật kỹ thuật như thế nào**:
  * **File can thiệp**: `packages/tadviewer/src/components/DataGrid.tsx`, `packages/tadviewer/less/grid.less`.
  * **Cơ chế**:
    * Trong hàm Formatter hiển thị ô dữ liệu của SlickGrid, kiểm tra tên cột: Nếu cột là `Level`, `Severity`, `RuleSeverity`, `AlertLevel`, `Status`.
    * Áp dụng định dạng CSS Badge:
      * `critical`, `high`, `fatal` $\rightarrow$ Class `.cell-badge-critical` (Nền đỏ đậm `#791a1f`, viền `#d9383a`, chữ trắng).
      * `medium`, `warning`, `warn` $\rightarrow$ Class `.cell-badge-medium` (Nền vàng cam `#783c00`, viền `#c87619`, chữ trắng).
      * `low`, `info`, `informational` $\rightarrow$ Class `.cell-badge-info` (Nền xanh lam nhạt hoặc xám trung tính).
* **Quy trình QA Test chi tiết**:
  * **Dataset kiểm thử**: `data_sample/Windows.EventLogs.Hayabusa_Results.csv` (có cột `RuleSeverity`).
  * **Kịch bản 1 (Hiển thị màu)**: Mở bảng dữ liệu $\rightarrow$ **Kết quả mong đợi**: Các dòng có `RuleSeverity = high` lập tức xuất hiện badge màu đỏ nổi bật.
  * **Kịch bản 2 (Hiệu năng cuộn bảng)**: Cuộn liên tục lên xuống qua 30,000 dòng log $\rightarrow$ **Kết quả mong đợi**: Tốc độ hiển thị mượt mà $\ge 60\text{ FPS}$, bộ nhớ RAM tăng không quá 10MB.

---

### 6. Tính Năng: Delta Time ($\Delta t$) Analysis (Khoảng Cách Thời Gian Giữa Các Sự Kiện)
* **Vấn đề giải quyết trong IR**:  
  Xác định nhịp độ tấn công (Attack Cadence):
  * **Malware C2 Beaconing**: Mã độc gửi tín hiệu về máy chủ C2 theo chu kỳ thời gian cố định hoặc có độ lệch nhỏ (ví dụ cứ đúng $60\text{s} \pm 5\text{s}$).
  * **Password Brute-force / Credential Stuffing**: Hàng nghìn lượt đăng nhập thất bại xảy ra với khoảng cách thời gian cực ngắn ($\Delta t < 0.05\text{s}$).
* **Cập nhật kỹ thuật như thế nào**:
  * **File can thiệp**: `packages/reltab-duckdb/src/reltab-duckdb.ts`.
  * **Cơ chế**:
    * Cho phép người dùng chọn một cột mốc thời gian (Timestamp) và bấm *"Calculate $\Delta t$"*.
    * Sinh truy vấn SQL Window Function:
      ```sql
      EPOCH(TimestampCol) - LAG(EPOCH(TimestampCol), 1) OVER (ORDER BY TimestampCol ASC) AS delta_seconds
      ```
    * Hiển thị cột mới `delta_t` kèm định dạng thân thiện: `+0.05s`, `+1.20s`, `+1m 30s`, `+2h 15m`.
* **Quy trình QA Test chi tiết**:
  * **Dataset kiểm thử**: Tập mẫu log xác thực (Logon Events EventID 4624/4625).
  * **Kịch bản 1 (Phát hiện Brute-force)**: Sắp xếp theo thời gian tăng dần và kích hoạt $\Delta t$ $\rightarrow$ **Kết quả mong đợi**: Cột $\Delta t$ hiển thị các khoảng cách thời gian tính bằng phần trăm giây, làm lộ rõ hành vi vét cạn mật khẩu.
  * **Kịch bản 2 (Dòng đầu tiên)**: Dòng đầu tiên không có dòng trước đó $\rightarrow$ **Kết quả mong đợi**: Giá trị hiển thị là `null` hoặc `-`, không bị lỗi toán học.

---

### 7. Tính Năng: Evidence Bookmarking & Incident Timeline Export (Ghim Bằng Chứng & Xuất Báo Cáo)
* **Vấn đề giải quyết trong IR**:  
  Sau khi lọc và phát hiện được 5 - 10 sự kiện chứng minh đường đi của kẻ tấn công, điều tra viên cần "nhặt" riêng các sự kiện này ra để đưa vào báo cáo sự cố chính thức, thay vì phải ghi chép thủ công.
* **Cập nhật kỹ thuật như thế nào**:
  * **File can thiệp**: `packages/tadviewer/src/components/DataGrid.tsx`, tạo mới cột ghim `__bookmark__`.
  * **Cơ chế**:
    * Người dùng có thể click vào icon lá cờ ở đầu mỗi dòng hoặc nhấn phím tắt `B` trên bàn phím.
    * Lưu mảng các `rowId` được đánh dấu vào `ViewParams`.
    * Nút công cụ trên Toolbar: *"Show Bookmarked Only"* (chỉ hiển thị những dòng đã ghim).
    * Nút *"Export Timeline Report"*: Xuất riêng các dòng được ghim ra file Markdown bảng hoặc CSV sạch để đính kèm vào báo cáo sự cố kỹ thuật.
* **Quy trình QA Test chi tiết**:
  * **Kịch bản 1 (Ghim & Bỏ ghim)**: Chọn dòng số 12, 45, 102 và bấm phím `B` $\rightarrow$ Icon cờ chuyển sang màu vàng nổi bật. Bấm lại phím `B` để bỏ ghim.
  * **Kịch bản 2 (Lọc Bookmark)**: Bấm *"Show Bookmarked Only"* $\rightarrow$ Bảng ngay lập tức co lại chỉ còn đúng 3 dòng đã ghim.
  * **Kịch bản 3 (Xuất báo cáo)**: Bấm *"Export Timeline Report"* $\rightarrow$ Kiểm tra file `.md` được xuất ra: Các cột quan trọng (Timestamp, EventID, User, Details) được sắp xếp đúng thứ tự thời gian, định dạng bảng Markdown hoàn chỉnh.

---

## IV. TIÊU CHÍ BÀN GIAO & KẾ HOẠCH PHÁT HÀNH (RELEASE PLAN)

| Phiên Bản | Tên Mục Tiêu | Hạng Mục Chính | Thời Gian Dự Kiến | Điều Kiện Đạt Chuẩn (Gate Criteria) |
|:---:|---|---|:---:|---|
| **v1.3.0** | **Speed & Pivot Release** | Context Menu + Omnisearch + Type Guard | Tuần 1 | 0 crash khi lọc dữ liệu, chuột phải pivot hoạt động tức thì trên file 25MB Hayabusa |
| **v1.3.1** | **Forensic Deep-Dive** | Decoders Base64/URL + Severity Highlighting | Tuần 2 | Giải mã chuẩn xác PowerShell UTF-16LE, bảng cuộn mượt mà $\ge 60\text{ FPS}$ |
| **v1.4.0** | **Advanced IR Suite** | Delta Time ($\Delta t$) + Bookmarking & Report Export | Tuần 3 | Xuất được báo cáo dòng thời gian sự cố sạch, nhận diện chính xác chu kỳ Beaconing |
