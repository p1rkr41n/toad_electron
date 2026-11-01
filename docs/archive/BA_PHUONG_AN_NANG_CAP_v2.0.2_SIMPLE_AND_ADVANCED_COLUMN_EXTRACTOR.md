# TÀI LIỆU ĐẶC TẢ YÊU CẦU NGHIỆP VỤ & PHƯƠNG ÁN KỸ THUẬT (BA SPECIFICATION)
## PHIÊN BẢN v2.0.2: BỘ BÓC TÁCH CỘT ĐA ĐỊNH DẠNG VÀ TÙY CHỈNH ĐẶT TÊN CỘT (SIMPLE & ADVANCED MULTI-FORMAT COLUMN EXTRACTOR)

> **Dự án:** TOAD Viewer - Công cụ Phân tích Điều tra Số & Giám sát Log (DFIR / SOC Log Analyzer)  
> **Phiên bản mục tiêu:** v2.0.2 (Declarative Multi-Format Structured Parsing & Custom Column Naming)  
> **Ngày lập tài liệu:** 29/10/2026  
> **Trạng thái:** Bản Đặc tả Nghiệp vụ BA & Kế hoạch Kỹ thuật Chính thức (Chưa sửa code)

---

## 1. TỔNG QUAN BỐI CẢNH & HIỆN TRẠNG HỆ THỐNG

### 1.1. Hiện trạng tính năng trích xuất trong Toad v2.0.1
Tại phiên bản **Toad v2.0.1**, ứng dụng đã cung cấp công cụ Regex Extractor (`RegexDialog.tsx` & `actions.ts`) cho phép người dùng mở hộp thoại để trích xuất dữ liệu từ một cột nguồn:
- Người dùng chọn một cột chuỗi (ví dụ: `Message`, `RawPayload`, `LogLine`).
- Hệ thống lấy dòng dữ liệu đầu tiên không rỗng làm mẫu tham chiếu (`Sample Event`).
- Người dùng nhập biểu thức chính quy (Regular Expression) chứa các Capture Groups: `(\d+)\s+\[(\w+)\]\s+(.*)`.
- Hệ thống dùng nhân DuckDB sinh ra lệnh:
  ```sql
  CREATE VIEW "table_rx1" AS SELECT *,
    regexp_extract("Message", '...', 1) AS "str0",
    regexp_extract("Message", '...', 2) AS "str1"
  FROM "table";
  ```

### 1.2. Thách thức thực tế từ phía người dùng (User Pain Points)
Mặc dù công cụ Regex hiện tại rất mạnh mẽ, việc sử dụng trong thực tế gặp phải 3 rào cản lớn:

1. **Rào cản kỹ thuật Regex quá cao đối với người dùng thông thường**:
   - Phần lớn chuyên viên điều tra, phân tích viên SOC hoặc nghiệp vụ viên văn phòng không thành thạo việc viết cú pháp Regex phức tạp (lookaround, escape group, non-capturing group).
   - Khi gặp một cột log chứa JSON hoặc Key-Value đơn giản, việc phải ngồi "vật lộn" viết biểu thức Regex để bóc từng trường gây mất thời gian và dễ sai sót.
2. **Không thể đặt tên cột theo nghiệp vụ (Bị ép gán nhãn `str0`, `str1`, `str2`...)**:
   - Các cột mới sinh ra bắt buộc phải mang tên tự động `str0`, `str1`, `str2`... Khi bảng có nhiều cột, người dùng hoàn toàn mất dấu không biết `str0` là IP, `str1` là Username hay `str2` là Mã lỗi.
   - Người dùng có nhu cầu cấp thiết phải **gõ đặt tên cột trực tiếp ngay khi bóc tách** (ví dụ: `Timestamp`, `ClientIP`, `LogLevel`, `ErrorDetail`...).
3. **Dữ liệu log thực tế rất đa dạng về cấu trúc (Multi-Format Structures)**:
   - Một ô trong bảng log có thể chứa: một chuỗi **JSON** (`{"user": "admin", "ip": "1.1.1.1"}`), một mảng **JSON Array** (`["auth", "admin", "privilege"]`), danh sách **Key-Value** phân tách bằng khoảng trắng (`src=1.1.1.1 dst=2.2.2.2 action=block`), dữ liệu định dạng **CSV** có dấu nháy bọc chuỗi (`"Ha Noi, VN", 200`), hoặc chuỗi thô (**Raw Delimiter**) phân tách bằng space/tab/pipe.

### 1.3. Mục tiêu của phiên bản Toad v2.0.2
Phiên bản **Toad v2.0.2** chuyển dịch mục Regex thành một **Bộ Bóc Tách Cột Toàn Diện (Toad Column Splitter & Extractor)** với 2 chế độ:
- **Chế độ Simple (Đơn giản)**: Hoàn toàn không cần viết code/regex. Người dùng chỉ cần chọn dạng dữ liệu của ô (JSON, JSON Array, Key-Value, CSV, Raw Delimiter) $\to$ chọn ký tự phân cách (nếu có) $\to$ hệ thống tự động bóc tách các trường mẫu và cho phép người dùng **sửa tên cột trực tiếp theo ý muốn** trước khi tạo bảng.
- **Chế độ Advanced (Nâng cao)**: Giữ nguyên cơ chế Regex mạnh mẽ hiện tại của v2.0.1 nhưng bổ sung thêm bảng **cho phép đổi tên các cột `strX` thành tên tự do**.

---

## 2. MA TRẬN YÊU CẦU NGHIỆP VỤ (BA REQUIREMENTS MATRIX)

| Mã YC (ID) | Bối cảnh Nghiệp vụ | Yêu cầu Chức năng | Tiêu chí Nghiệm thu (Acceptance Criteria) |
|---|---|---|---|
| **BA-2.0.2-01** | Người dùng mở hộp thoại tách cột từ ActivityBar hoặc Footer. | Hộp thoại cung cấp 2 chế độ hiển thị qua thanh Tab: `[ Simple (Đơn giản) ]` và `[ Advanced (Regex Nâng cao) ]`. | - Mặc định mở ở tab `Simple`.<br>- Chuyển đổi tab mượt mà, ghi nhớ cột nguồn đang chọn. |
| **BA-2.0.2-02** | Ô dữ liệu chứa dữ liệu có cấu trúc khác nhau. | Chế độ Simple cho phép chọn 5 định dạng dữ liệu:<br>1. **JSON Object**<br>2. **JSON Array**<br>3. **Key-Value (K-V)**<br>4. **CSV Formatted**<br>5. **Raw Delimiter** | - Thay đổi định dạng lập tức kích hoạt lại thuật toán phân tích trên dòng mẫu.<br>- Các nút điều khiển thích ứng động (contextual) theo định dạng đã chọn. |
| **BA-2.0.2-03** | Người dùng chọn định dạng hoặc đổi ký tự phân cách. | Hệ thống tự động phân tích dòng mẫu (`Sample Event`) và tự sinh danh sách các trường bóc tách được (Auto-Discovery). | - Với JSON/Key-Value: Nhận diện tự động tên các Key và giá trị tương ứng.<br>- Với Raw/CSV/Array: Nhận diện danh sách các phần tử theo vị trí thứ tự `1..N`. |
| **BA-2.0.2-04** | Người dùng xem bảng danh sách các trường bóc tách được. | Cung cấp ô Input cho phép **gõ đổi tên cột trực tiếp** (Custom Column Naming) và Checkbox để chọn lấy hoặc bỏ qua từng cột. | - Tên cột gợi ý tự động (Key name hoặc `col_1`, `col_2`...).<br>- Người dùng có thể sửa thành bất kỳ tên nào (hỗ trợ tiếng Việt, khoảng trắng, gạch dưới).<br>- Bỏ tích cột nào thì cột đó không được tạo trong VIEW. |
| **BA-2.0.2-05** | Người dùng chọn chế độ Raw Delimiter hoặc Key-Value. | Cung cấp bộ chọn ký tự phân cách (Delimiter): Space, Comma, Semicolon, Pipe, Tab, Custom, kèm tùy chọn Trim và Collapse Delimiters. | - Gộp nhiều khoảng trắng liên tiếp nếu bật `Collapse consecutive delimiters`.<br>- Tự động cắt khoảng trắng thừa hai đầu nếu bật `Trim whitespace`. |
| **BA-2.0.2-06** | Người dùng chuyên sâu sử dụng chế độ Advanced (Regex). | Cho phép người dùng nhập biểu thức Regex tự do, đồng thời cho phép đổi tên các cột Capture Groups thay vì cố định `strX`. | - Giữ nguyên toàn bộ tính năng kiểm tra Regex hợp lệ và tính số nhóm.<br>- Thêm cột ô Input cho phép gõ tên cột đích cho từng group. |
| **BA-2.0.2-07** | Người dùng bấm nút "Apply". | Sinh câu lệnh DuckDB `CREATE VIEW` tối ưu hóa native, mount bảng mới vào DataGrid trong thời gian $< 50\text{ ms}$. | - Tạo View tức thì với đúng các tên cột tùy chỉnh.<br>- Cột mới được thêm ngay vào cuối danh sách hiển thị của DataGrid. |

---

## 3. THIẾT KẾ TRẢI NGHIỆM NGƯỜI DÙNG (UI/UX SPECIFICATION)

### 3.1. Cấu trúc tổng thể hộp thoại `RegexDialog`
- **Kích thước**: Rộng 780px, Responsive trên màn hình nhỏ.
- **Tiêu đề**: `Toad Column Splitter & Extractor (Bộ bóc tách & Chuyển đổi cột)`
- **Header**: Thanh chuyển Tab:
  ```
  +-----------------------------------------------------------------------------------------+
  |  Toad Column Splitter & Extractor                                              [ X ]    |
  |  [  Simple (Bóc tách trực quan)  ]       [  Advanced (Biểu thức Regex)  ]              |
  +-----------------------------------------------------------------------------------------+
  ```

---

### 3.2. Chi tiết Giao diện Chế độ Simple

```
+-----------------------------------------------------------------------------------------+
| Source Column: [ Message ▼ ]                         [ Reload Sample ]                   |
+-----------------------------------------------------------------------------------------+
| Sample Event (Dòng dữ liệu mẫu):                                                        |
| [ src_ip=192.168.1.105 dst_ip=10.0.0.1 action=ALLOW bytes=1420 proto=TCP            ]   |
+-----------------------------------------------------------------------------------------+
| Data Format (Định dạng ô dữ liệu):                                                      |
| ( ) JSON Object    ( ) JSON Array    (*) Key-Value    ( ) CSV Formatted   ( ) Raw Delim |
+-----------------------------------------------------------------------------------------+
| Format Options (Tùy chọn tương ứng):                                                    |
| Pair Separator: [ Space ' ' ▼ ]    Assignment Symbol: [ Equal '=' ▼ ]                   |
| [x] Trim whitespace                [x] Ignore empty values                              |
+-----------------------------------------------------------------------------------------+
| Extracted Columns & Custom Naming (Danh sách cột trích xuất & Đặt tên tùy ý):           |
|                                                                                         |
|  [x] STT | Thuộc tính nguồn | Giá trị trích xuất mẫu | Tên cột mới (Gõ tùy thích)       |
|  -------------------------------------------------------------------------------------- |
|  [x]  1  | key: "src_ip"    | 192.168.1.105          | [ IP Nguồn                   ]   |
|  [x]  2  | key: "dst_ip"    | 10.0.0.1               | [ IP Đích                    ]   |
|  [x]  3  | key: "action"    | ALLOW                  | [ Hành động                  ]   |
|  [x]  4  | key: "bytes"     | 1420                   | [ Dung lượng (Bytes)         ]   |
|  [ ]  5  | key: "proto"     | TCP                    | [ proto                      ]   |
+-----------------------------------------------------------------------------------------+
| Summary: Sẽ tạo 4 cột mới: "IP Nguồn", "IP Đích", "Hành động", "Dung lượng (Bytes)"      |
| [ Cancel ]                                                             [ Apply (Áp dụng) ]|
+-----------------------------------------------------------------------------------------+
```

---

### 3.3. Các Tùy chọn Định dạng Chi tiết (Format Contextual Behaviors)

#### 1. Định dạng JSON Object
- **Mẫu thực tế**: `{"user": "alice", "auth_type": "mfa", "client": {"os": "win11"}}`
- **Tùy chọn kèm theo**: 
  - `Trích xuất lồng nhau (Flatten 1 cấp)`: Nếu bật, tự động bóc cả các key lồng: `client.os`.
- **Ánh xạ cột**: Các `key` gốc được tự động gán làm tên cột mặc định. Người dùng chỉ cần gõ lại nếu muốn đổi tên.

#### 2. Định dạng JSON Array
- **Mẫu thực tế**: `["10.0.0.1", "10.0.0.2", "10.0.0.3"]` hoặc `[{"port": 80}, {"port": 443}]`
- **Ánh xạ cột**: Tự động đánh số phần tử `item_0`, `item_1`... kèm giá trị mẫu tương ứng.

#### 3. Định dạng Key-Value (K-V)
- **Mẫu thực tế**: `user=john status=success code=00 ip=172.16.0.4` hoặc `user:john, status:success`
- **Tùy chọn kèm theo**:
  - `Pair Separator`: Khoảng trắng ` `, Dấu phẩy `,`, Dấu chấm phẩy `;`, Dấu gạch đứng `|`.
  - `Assign Symbol`: Dấu bằng `=`, Dấu hai chấm `:`.
- **Ánh xạ cột**: Nhận diện thông minh toàn bộ các cặp `k=v` xuất hiện trên dòng mẫu.

#### 4. Định dạng CSV Formatted
- **Mẫu thực tế**: `"John Doe, Jr.", 35, "Engineer, Senior", "New York, USA"`
- **Tùy chọn kèm theo**:
  - `Delimiter`: Dấu phẩy `,`, Dấu chấm phẩy `;`.
  - `Quote Character`: Dấu nháy kép `"` (chuẩn RFC 4180).
- **Đặc tính**: Tôn trọng các chuỗi nằm trong nháy kép, không làm tách nhầm các dấu phẩy bên trong nháy kép.

#### 5. Định dạng Raw Delimiter
- **Mẫu thực tế**: `2026-10-29 17:45:00|SEC_LOG|192.168.1.1|DROP`
- **Tùy chọn kèm theo**:
  - `Delimiter Selection`: Nút bấm nhanh `[Space]` `[Comma ,]` `[Semicolon ;]` `[Pipe |]` `[Tab \t]` `[Custom Input]`.
  - `Collapse consecutive delimiters`: Gộp các dấu cách thừa liền nhau thành 1.
  - `Trim whitespace`: Cắt khoảng trắng 2 đầu.

---

## 4. THIẾT KẾ KỸ THUẬT & DUCKDB SQL GENERATION

DuckDB là động cơ phân tích dữ liệu phân tích cột (Columnar Database) hỗ trợ hoàn hảo việc xử lý JSON, String Regex, và Array ở mức C++ Engine mà không cần tải dữ liệu lên Node.js JavaScript layer:

### 4.1. Câu lệnh SQL sinh ra theo từng Định dạng

#### Trường hợp 1: JSON Object
Sử dụng toán tử bóc chuỗi JSON `->>` siêu nhanh của DuckDB:
```sql
CREATE VIEW "table_rx1" AS 
SELECT * EXCLUDE ("IP Nguồn", "IP Đích"),
  "RawPayload"->>'$.src_ip' AS "IP Nguồn",
  "RawPayload"->>'$.dst_ip' AS "IP Đích",
  "RawPayload"->>'$.action' AS "Hành động"
FROM "table_goc";
```

#### Trường hợp 2: JSON Array
Truy cập chỉ mục phần tử mảng JSON:
```sql
CREATE VIEW "table_rx1" AS 
SELECT * EXCLUDE ("IP Chính", "IP Phụ"),
  "IpList"->>0 AS "IP Chính",
  "IpList"->>1 AS "IP Phụ"
FROM "table_goc";
```

#### Trường hợp 3: Key-Value Pairs
DuckDB hỗ trợ trích xuất theo mẫu cặp Khóa=Giá trị hoặc qua hàm `str_to_map`:
```sql
CREATE VIEW "table_rx1" AS 
SELECT * EXCLUDE ("IP Nguồn", "Hành động"),
  regexp_extract("LogMessage", '(?:^|[\s,;])src_ip=([^ \t,;]+)', 1) AS "IP Nguồn",
  regexp_extract("LogMessage", '(?:^|[\s,;])dst_ip=([^ \t,;]+)', 1) AS "IP Đích",
  regexp_extract("LogMessage", '(?:^|[\s,;])action=([^ \t,;]+)', 1) AS "Hành động"
FROM "table_goc";
```

#### Trường hợp 4: Raw Delimiter (Ký tự phân cách)
Sử dụng hàm C++ tối ưu hóa vector `split_part(string, delimiter, index)`:
```sql
CREATE VIEW "table_rx1" AS 
SELECT * EXCLUDE ("Thời gian", "Cấp độ lỗi"),
  TRIM(split_part("LogMessage", ' ', 1)) AS "Thời gian",
  TRIM(split_part("LogMessage", ' ', 2)) AS "Cấp độ lỗi",
  TRIM(split_part("LogMessage", ' ', 3)) AS "Chi tiết thông báo"
FROM "table_goc";
```

#### Trường hợp 5: CSV Formatted (Chuỗi CSV có nháy kép)
Sử dụng biểu thức trích xuất mảng CSV hoặc regex split an toàn với quote:
```sql
CREATE VIEW "table_rx1" AS 
SELECT * EXCLUDE ("Họ và Tên", "Địa chỉ"),
  str_split_regex("CsvRecord", '(?!\B"[^"]*),(?![^"]*"\B)')[1] AS "Họ và Tên",
  str_split_regex("CsvRecord", '(?!\B"[^"]*),(?![^"]*"\B)')[2] AS "Tuổi",
  str_split_regex("CsvRecord", '(?!\B"[^"]*),(?![^"]*"\B)')[3] AS "Địa chỉ"
FROM "table_goc";
```

---

### 4.2. Xử lý Tránh Va Chạm Tên Cột (Column Collision Prevention)
1. **Kiểm tra tên trùng**: Trước khi tạo VIEW, hệ thống so sánh danh sách tên cột người dùng đã đặt với danh sách cột sẵn có trong `baseSchema.columns`.
2. **Cú pháp `EXCLUDE`**: Nếu tên cột mới trùng với một cột cũ, hệ thống tự động chèn mệnh đề `SELECT * EXCLUDE ("colName")` để cột mới ghi đè hợp lệ mà không phát sinh lỗi `Duplicate column name`.
3. **Validate tên cột**:
   - Tự động trim khoảng trắng thừa ở tên cột.
   - Nếu người dùng để trống tên cột, hệ thống tự động fallback về `col_1`, `col_2`... hoặc giữ nguyên tên key gốc.
   - Cho phép các ký tự Unicode có dấu tiếng Việt (bọc an toàn trong dấu ngoặc kép `""` trong SQL).

---

### 4.3. Cập nhật Giao diện & Hiển thị trên DataGrid
Sau khi lệnh `CREATE VIEW` thực thi thành công trong DuckDB:
1. `dbc.runSqlQuery(createViewSql)` hoàn tất trong $< 10\text{ ms}$.
2. Hệ thống truy vấn Schema mới qua `aggtree.getBaseSchema`.
3. Cập nhật mảng `displayColumns` của `ViewState`: Giữ nguyên vị trí các cột hiện có, chèn thêm các cột mới vừa sinh vào ngay phía sau cột nguồn hoặc ở cuối bảng.
4. DataGrid re-render ngay tức thì mà không cần nạp lại toàn bộ tệp từ đầu.

---

## 5. MA TRẬN KIỂM THỬ CHẤP NHẬN (ACCEPTANCE TEST MATRIX)

Dưới đây là ma trận kiểm thử tự động cần bổ sung khi triển khai phiên bản v2.0.2:

| Mã Kiểm Thử | Tình Huống Kiểm Thử (Scenario) | Dữ Liệu Đầu Vào Mẫu | Kết Quả Kỳ Vọng |
|---|---|---|---|
| **TC-202-01** | Bóc tách JSON Object đơn giản | `{"user": "admin", "ip": "1.1.1.1", "status": 200}` | - Tự động phát hiện 3 key: `user`, `ip`, `status`.<br>- Người dùng đổi tên thành `Tài khoản`, `Địa chỉ IP`, `Mã lỗi`.<br>- VIEW tạo thành công 3 cột mới đúng tên. |
| **TC-202-02** | Bóc tách JSON chứa mảng hoặc lồng nhau | `{"event": "login", "tags": ["auth", "vpn"]}` | - Nhận diện trường `event` và các phần tử trong `tags`.<br>- Bóc tách mượt mà không bị lỗi parse. |
| **TC-202-03** | Bóc tách Key-Value log Firewall | `src=10.0.0.5 dst=8.8.8.8 action=ALLOW len=64` | - Tách thành 4 cột: `src`, `dst`, `action`, `len`.<br>- Thử nghiệm với dấu `=` và dấu `:`. |
| **TC-202-04** | Bóc tách Raw Delimiter với Space | `2026-10-29 17:00:00 [INFO] Task completed` | - Ký tự phân cách: Space.<br>- Bật `Collapse multiple delimiters`.<br>- Tách đúng 4 phần, không bị sinh cột rỗng giữa các dấu cách thừa. |
| **TC-202-05** | Bóc tách CSV có nháy kép bọc dấu phẩy | `"Hanoi, Vietnam", 200, "OK, Success"` | - Dấu phẩy nằm trong `"Hanoi, Vietnam"` không bị cắt nhầm.<br>- Tách thành đúng 3 cột. |
| **TC-202-06** | Đổi tên cột trong chế độ Advanced Regex | Pattern: `(\d+)\s+(\w+)` với Sample: `123 abc` | - Người dùng gõ tên `ID` cho Group 1, `Code` cho Group 2.<br>- Sinh ra cột `ID` và `Code` thay vì `str0` và `str1`. |
| **TC-202-07** | Đặt tên cột tiếng Việt có dấu và khoảng trắng | Tên cột: `Địa chỉ IP Máy chủ` | - Câu lệnh SQL bọc tên trong `"Địa chỉ IP Máy chủ"`.<br>- Hiển thị nguyên vẹn tiếng Việt trên header DataGrid. |
| **TC-202-08** | Dòng dữ liệu NULL hoặc chuỗi rỗng | Cột nguồn có các dòng mang giá trị `NULL` hoặc `""` | - Các dòng NULL trích xuất ra giá trị NULL an toàn, không làm crash View hay ngắt quãng bảng. |

---

## 6. PHẠM VI TÁC ĐỘNG MÃ NGUỒN (CODE IMPACT ANALYSIS)

Khi tiến hành hiện thực mã nguồn cho bản **v2.0.2**, phạm vi tác động sẽ tập trung hoàn toàn vào các tệp giao diện và action của `tadviewer`:

1. **[`packages/tadviewer/src/components/RegexDialog.tsx`](file:///d:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/src/components/RegexDialog.tsx)**:
   - Thêm tab bar `Simple / Advanced`.
   - Xây dựng giao diện chọn Format (JSON, JSON Array, Key-Value, CSV, Raw).
   - Xây dựng bảng cấu hình ánh xạ trường động (Dynamic Field Mapping Grid) cho phép gõ đổi tên cột và tích chọn cột cần lấy.
2. **[`packages/tadviewer/src/actions.ts`](file:///d:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/src/actions.ts)**:
   - Mở rộng hàm `applyRegexExtraction` hoặc bổ sung hàm mới `applySimpleExtraction`:
     - Tham số: `mode: "simple" | "advanced"`, `formatType: string`, `fieldMappings: Array<{ sourceKeyOrIdx: any; outputColName: string; enabled: boolean }>`.
     - Sinh câu lệnh DuckDB `CREATE VIEW` với `json_extract_string`, `split_part`, hoặc `regexp_extract`.
3. **[`packages/tadviewer/src/AppState.ts`](file:///d:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/src/AppState.ts)**:
   - Lưu trạng thái cấu hình trích xuất gần nhất của người dùng để khi mở lại không phải chọn lại từ đầu.
4. **[`test_qa_all_use_cases.js`](file:///d:/Shared_UserData/Downloads/tad/test_qa_all_use_cases.js)**:
   - Bổ sung Suite kiểm thử cho toàn bộ 5 định dạng Simple Mode và chức năng Custom Column Naming.

---

## 7. KẾT LUẬN & ĐỀ XUẤT

Tài liệu này định hình đầy đủ và toàn diện các yêu cầu nghiệp vụ (BA) cho tính năng **Simple & Advanced Column Extractor** trên phiên bản **Toad v2.0.2**. Tính năng này sẽ mang lại bước nhảy vọt về trải nghiệm người dùng, biến Toad thành công cụ phân tích log và dữ liệu bán cấu trúc (Semi-structured Data) mạnh mẽ, thân thiện và linh hoạt hàng đầu.

Tài liệu đã sẵn sàng để chuyển sang giai đoạn lập kế hoạch chi tiết và thực thi code khi người dùng phê duyệt!

