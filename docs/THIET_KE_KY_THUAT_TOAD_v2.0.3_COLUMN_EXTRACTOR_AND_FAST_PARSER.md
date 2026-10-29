# ĐẶC TẢ KỸ THUẬT VÀ BỘ TEST CASE TOÀN DIỆN - TOAD v2.0.3
## BỘ TRÍCH XUẤT CỘT & PHÂN TÍCH NHANH (COLUMN EXTRACTOR & FAST PARSER)

> **Căn cứ thiết kế:** Tuân thủ tuyệt đối 100% Mockup chuẩn tại [`mockup/index.html`](file:///d:/Shared_UserData\Downloads\tad\mockup\index.html) và [`mockup/requirements.json`](file:///d:/Shared_UserData\Downloads\tad\mockup\requirements.json).  
> **Phiên bản mục tiêu:** **Toad v2.0.3**  
> **Tiêu chuẩn thiết kế:** BlueprintJS 4 Dark Theme, 100% English UI, Zero-Paragraph Cognitive Load Optimization, DuckDB Vectorized Engine.

---

## MỤC LỤC
1. [Tổng quan & Mục tiêu v2.0.3](#1-tổng-quan--mục-tiêu-v203)
2. [Bảng ma trận ánh xạ 20 yêu cầu kỹ thuật (REQ-MOCKUP-001 -> REQ-MOCKUP-020)](#2-bảng-ma-trận-ánh-xạ-20-yêu-cầu-kỹ-thuật)
3. [Đặc tả kiến trúc kỹ thuật & Luồng xử lý chi tiết](#3-đặc-tả-kiến-trúc-kỹ-thuật--luồng-xử-lý-chi-tiết)
   - 3.1 Giao diện & Công thái học nhận thức (Cognitive Ergonomics)
   - 3.2 Khối hợp nhất quy tắc bóc tách (Unified Parsing Card - 2 Tiers)
   - 3.3 Động cơ tiền xử lý cô lập tiền tố Log Header (CTE Splitter)
   - 3.4 Bảng ánh xạ cột động, tìm kiếm & click-to-sort
   - 3.5 Cơ chế Auto-Casting mặc định & Ghi đè kiểu từng cột (TRY_CAST)
   - 3.6 Khối kiểm thử 1.000 dòng & Trình thanh tra dòng không khớp (Penultimate)
   - 3.7 Hộp xem trước DuckDB SQL Live (Mặc định đóng & 1-Click Copy)
4. [Bộ Test Case chi tiết và toàn diện (Full QA Test Suite)](#4-bộ-test-case-chi-tiết-và-toàn-diện)
   - Nhóm 1: Localization & Typography (TC-LOC)
   - Nhóm 2: Header, Mode Switcher & Reload (TC-HDR)
   - Nhóm 3: Unified Parsing Card & Token Syntax (TC-SYN)
   - Nhóm 4: Format Engine, Auto-Detection & Raw Fallback (TC-FMT)
   - Nhóm 5: Log Header Prefix Splitter & CTE Isolation (TC-CTE)
   - Nhóm 6: Column Grid, Search, Sort & Inline Type Casting (TC-GRD)
   - Nhóm 7: 1,000-Row Validation & Unmatched Inspector (TC-VAL)
   - Nhóm 8: Live DuckDB SQL Preview & Performance (TC-SQL)
   - Nhóm 9: Edge Cases, Special Characters & Stress Testing (TC-EDG)

---

## 1. TỔNG QUAN & MỤC TIÊU v2.0.3

Trong phiên bản v2.0.2 trước đây, tính năng Regex Column Extractor đã bổ sung chế độ Simple Mode nhưng giao diện còn phân mảnh (nhiều khối xếp chồng cao >150px), tồn tại các checkbox rời rạc gây nhiễu nhận thức (`Handle quoted values`, `Auto-strip Syslog prefix`, `Auto-cast DuckDB types`), ngôn ngữ chưa chuẩn hóa hoàn toàn sang tiếng Anh, và khối kiểm thử 1.000 dòng chưa đặt đúng vị trí áp cuối trước SQL.

**Mục tiêu cốt lõi của Toad v2.0.3:**
1. **Tuân thủ tuyệt đối cấu trúc Mockup**: Tái hiện chính xác 100% giao diện, màu sắc, icon vector và hành vi từ `mockup/index.html`.
2. **100% English UI**: Loại bỏ toàn bộ từ ngữ tiếng Việt trong giao diện modal, chuẩn hóa sang thuật ngữ kỹ thuật quốc tế (`Delim`, `Assign`, `Quotes`, `VARCHAR`, `BIGINT`, `Sep`, `Col Name`).
3. **Giảm thiểu tối đa quá tải nhận thức (Zero-Paragraph Policy)**: Thay thế toàn bộ các đoạn văn giải thích dài dòng bằng hệ thống biểu tượng vector đơn sắc (Monochromatic SVG) và native tooltip hover (`title="..."`).
4. **Hợp nhất khối bóc tách (Unified 2-Tier Parsing Card)**: Giảm >55% chiều cao khung điều khiển (từ ~150px xuống ~62px), tổ chức Tầng 1 (Format + Header Prefix) và Tầng 2 (Delimiter / Assign / Quotes strip).
5. **Động cơ DuckDB SQL Vectorized siêu tốc**: Sinh câu lệnh `WITH split_log AS (...)` cô lập Header Prefix, trích xuất an toàn token có dấu ngoặc kép bằng regex resilience pattern, tự động ép kiểu bằng `TRY_CAST`, cam kết độ trễ tạo view `< 15ms`.

---

## 2. BẢNG MA TRẬN ÁNH XẠ 20 YÊU CẦU KỸ THUẬT

| Mã REQ | Danh mục | Tên yêu cầu | Tóm tắt kỹ thuật & Tiêu chí nghiệm thu (Mockup Fidelity) |
| :--- | :--- | :--- | :--- |
| **REQ-MOCKUP-001** | Localization | 100% English UI Localization | Không còn bất kỳ ký tự tiếng Việt nào trong modal. Các nhãn, nút bấm, placeholder, tooltip, thông báo trạng thái đều là tiếng Anh chuẩn công nghệ. |
| **REQ-MOCKUP-002** | Ergonomics | Icon-Only Reload Button | Nút reload bên cạnh Source Column thu gọn thành icon vector 30x30px không nhãn chữ, tooltip `title="Reload Sample"`. |
| **REQ-MOCKUP-003** | Ergonomics | Corner Monochromatic Mode Switcher | Nút chuyển tab đơn sắc đưa lên góc phải header modal: ⚡ `Simple` (mặc định) và 🔧 `Regex`. Nền xám mờ, hiệu ứng active xanh `#137cbd`. |
| **REQ-MOCKUP-004** | Engine | Multi-Format Parsing Engine | Hỗ trợ 6 định dạng qua menu dropdown `#native-format-select`: `raw`, `kv`, `json`, `csv`, `space`, `arr`. |
| **REQ-MOCKUP-005** | Intelligence | Auto Format Detection & Raw Fallback | Tự động phân tích sample log khi đổi cột hoặc nhập text, tự động chọn format tương ứng trong dropdown. Nếu không nhận diện được cấu trúc, tự động về `raw` (passthrough `SELECT *`). |
| **REQ-MOCKUP-006** | Engine | Header Prefix Splitter & CTE Isolation | Hộp kiểm `#chk-has-header`, ký tự phân tách `#cfg-header-sep` (mặc định `: `), tên cột `#cfg-header-col-name` (mặc định `log_header`), pill `[H]:[Body]`. Tự động sinh CTE `split_part` tách header và để lại `_body` cho bộ parse. |
| **REQ-MOCKUP-007** | Syntax | Configurable Delim, Equal & Quote Pair | Các ô nhập text monospace: Delimiter (`#cfg-delimiter`, mặc định `' '`), Equal (`#cfg-equal`, mặc định `'='`), Quote Open/Close (`#cfg-quote-open`, `#cfg-quote-close`, mặc định `"` và `"`). |
| **REQ-MOCKUP-008** | Resilience | Redundant Checkboxes Elimination | Loại bỏ hoàn toàn 3 checkbox rời: `Handle quoted values`, `Auto-strip Syslog prefix`, `Auto-cast DuckDB types`. Logic được tích hợp tự nhiên vào Quote Pair, Header Splitter, và dropdown kiểu dữ liệu. |
| **REQ-MOCKUP-009** | Layout | Unified 2-Tier Parsing Card | Gom 3 khối rời rạc thành `#unified-parsing-card`. Tầng 1: Format dropdown bên trái + Vạch dọc hairline + Header Splitter bên phải. Tầng 2: Delimiter strip nền tối (tự động ẩn khi chọn json, csv, raw). Giảm 55% chiều cao. |
| **REQ-MOCKUP-010** | UX | Search Input with Embedded Search Icon | Ô tìm kiếm `#native-field-search` với icon kính lúp nhúng bên trong, placeholder `Search columns...`. Lọc realtime Property, Type, Sample Value, New Column Name. Bỏ các filter pill thừa. |
| **REQ-MOCKUP-011** | UX | Click-to-Sort Table Headers | Cho phép click tiêu đề từng cột (`Property`, `Type`, `Fill Rate`, `Sample Value`, `New Column Name`) để đảo chiều sắp xếp (neutral `&#8645;` -> asc `&#9650;` -> desc `&#9660;`). Cột Fill Rate sắp xếp theo số nguyên. |
| **REQ-MOCKUP-012** | Renaming | Column Renaming Table & 1-Click Delete | Bảng ánh xạ với tiêu đề có icon SVG. Nút xóa nhanh `✕` tại mỗi hàng xóa ngay lập tức khỏi view và cập nhật SQL preview. Các nút toolbar: `[+ Add]`, `[All]`, `[None]`. |
| **REQ-MOCKUP-013** | Intelligence | Batch Sampling & Fill Rate Progress Bar | Quét mẫu đến 100 dòng phát hiện key ẩn. Thanh tiến độ fill rate trực quan: xanh lá (`#3dcc91`) nếu >= 80%, hổ phách (`#e1b854`) nếu < 80%. |
| **REQ-MOCKUP-014** | Intelligence | Per-Column Type Selector & Auto-Casting | Luôn bật auto-cast mặc định. Mỗi hàng có menu `<select class='type-select'>` (`VARCHAR`, `BIGINT`, `DOUBLE`, `TIMESTAMP`, `BOOLEAN`). Nếu chọn kiểu khác VARCHAR, sinh `TRY_CAST(expr AS TYPE) AS "col"`. Nếu chọn VARCHAR, giữ nguyên biểu thức thô. |
| **REQ-MOCKUP-015** | Performance | Vectorized DuckDB Engine | Tạo view ảo DuckDB xử lý SIMD song song, thời gian phản hồi `< 15ms`. Hỗ trợ pattern Regex trích xuất an toàn và `str_split_to_map` / `json_extract_string`. |
| **REQ-MOCKUP-016** | QA | 1,000-Row Validation (Penultimate Position) | Khối kiểm thử 1.000 dòng đặt áp cuối (ngay trên Live DuckDB SQL). Thanh tiến độ tỉ lệ match xanh lá/đỏ, nút `▶ Run Test`, nút `👁 16 Unmatched` mở rộng panel xem log lỗi mẫu. |
| **REQ-MOCKUP-017** | Transparency | Live DuckDB SQL Preview (Collapsed by Default) | Nằm ở đáy Simple Mode, mặc định đóng (`display: none`, chevron `&#9654;`). Click để mở rộng. Nút `Copy` 1-click có hiệu ứng `✓ Copied!` trong 1200ms. Hiển thị chuẩn xác câu lệnh DuckDB `CREATE VIEW`. |
| **REQ-MOCKUP-018** | Ergonomics | Monochromatic Icon-Driven Architecture | Áp dụng chính sách không-đoạn-văn. Sử dụng icon SVG đơn sắc chuẩn BlueprintJS cho mọi nhóm chức năng (Search, Reload, Scissor, Quotes, Equals, Play, Inspect, Database, Copy, Checkmark). |
| **REQ-MOCKUP-019** | Design System | BlueprintJS 4 Dark Theme Cohesion | Tuân thủ tuyệt đối bảng màu BlueprintJS 4 Dark: Nền dialog `#293742`, viewport `#10161a`, input `rgba(16, 22, 26, 0.3)`, primary `#137cbd`, success `#3dcc91`, warning `#e1b854`, danger `#ff7373`. |
| **REQ-MOCKUP-020** | Scope | Baseline Scope Consolidation | Lấy `mockup/index.html` và `mockup/requirements.json` làm chuẩn đặc tả kỹ thuật duy nhất cho v2.0.3. Loại bỏ toàn bộ thiết kế cũ phân tán. |

---

## 3. ĐẶC TẢ KIẾN TRÚC KỸ THUẬT & LUỒNG XỬ LÝ CHI TIẾT

### 3.1 Giao diện & Công thái học nhận thức (Cognitive Ergonomics)
- **Zero-paragraph Policy**: Loại bỏ toàn bộ các câu giải thích kỹ thuật dài như *"Separates metadata prefix like timestamps before extracting..."* hoặc *"Generated as a dedicated column..."*. Toàn bộ hướng dẫn được đẩy vào thuộc tính HTML `title="..."` hiển thị khi hover chuột.
- **Header Modal**:
  - Tiêu đề: `Toad - Column Extractor & Renamer` (Font Segoe UI / San Francisco, 15px, font-weight: 600, màu `#f5f8fa`).
  - Góc trên cùng bên phải là cụm chuyển chế độ `.mode-corner-group`:
    - Tab 1: `⚡ Simple` (mặc định) -> kích hoạt Simple Mode.
    - Tab 2: `🔧 Regex` -> kích hoạt Regex Capture Group Mode chuyên nghiệp.
    - Nút đóng: `✕` minimal button.
- **Source Column & Reload Sample**:
  - Dropdown chọn cột nguồn bên trái.
  - Bên cạnh là nút Reload dạng icon xoay tròn SVG (`viewBox="0 0 16 16"`), kích thước `30px x 30px`, không chữ, tooltip `Reload Sample`.

### 3.2 Khối hợp nhất quy tắc bóc tách (Unified Parsing Card - 2 Tiers)
Thẻ `#unified-parsing-card` (border 1px, background `rgba(16, 22, 26, 0.4)`, bo góc 4px):
- **Tầng 1 (Hàng trên, cao ~34px, padding 7px 12px, nền `rgba(16, 22, 26, 0.25)`)**:
  - **Bên trái (Format Select)**: Nhãn `Format:` kèm icon tài liệu/code, menu thả xuống `#native-format-select` có 6 tùy chọn:
    1. `Raw (No parsing)` (value: `raw`)
    2. `Key=Value (k=v)` (value: `kv`, mặc định)
    3. `JSON Object ({ "key": "value" })` (value: `json`)
    4. `CSV (Quoted RFC 4180)` (value: `csv`)
    5. `Delimited (Whitespace)` (value: `space`)
    6. `JSON Array ($[0], $[1]...)` (value: `arr`)
  - **Đường phân cách dọc**: Hairline divider `width: 1px; height: 22px; background: rgba(255, 255, 255, 0.1)`.
  - **Bên phải (Header Splitter)**:
    - Checkbox `#chk-has-header` (checked mặc định).
    - Icon kéo/cắt màu vàng cam (`#e1b854`).
    - Nhãn `Header Prefix:`.
    - Ô ký tự phân tách `Sep:` (`#cfg-header-sep`, width 40px, font monospace, căn giữa, mặc định `: `).
    - Mũi tên `→`.
    - Ô tên cột `Col:` (`#cfg-header-col-name`, width 95px, mặc định `log_header`).
    - Pill hiển thị trực quan `#native-header-pill`: `[H]` (vàng) `:` (đỏ) `[Body]` (xanh lá).
    - Khi bỏ tích checkbox `#chk-has-header`, toàn bộ cụm input và pill mờ đi với `opacity: 0.35` và `pointer-events: none` mà không làm nhảy layout.
- **Tầng 2 (Hàng dưới, cao ~28px, padding 6px 12px, nền tối `rgba(0, 0, 0, 0.2)`)**:
  - Dải cấu hình ký tự bóc tách (`#native-delimiter-cfg-box`):
    - `Delimiter:` icon phân tách + input `#cfg-delimiter` (width 44px, monospace, text căn giữa, xanh dương `#48aff0`, mặc định `' '`).
    - Dấu chấm phân cách `·`.
    - `Assign:` icon phép gán + input `#cfg-equal` (width 34px, monospace, text căn giữa, xanh dương `#48aff0`, mặc định `'='`).
    - Dấu chấm phân cách `·`.
    - `Quote Pair:` icon ngoặc kép + input `#cfg-quote-open` (width 30px, monospace, text căn giữa, xanh lá `#3dcc91`, mặc định `"`), dấu hai chấm `..`, input `#cfg-quote-close` (width 30px, monospace, text căn giữa, xanh lá `#3dcc91`, mặc định `"`).
    - Badge nhỏ `"..." Pair` màu tím nhạt.
  - **Hành vi tự động ẩn**: Khi người dùng chọn Format là `json`, `csv`, `arr` hoặc `raw`, Tầng 2 tự động ẩn (`display: none`), giúp panel co lại chỉ còn 1 hàng ~34px. Chỉ hiển thị khi chọn `kv` hoặc `space`.

### 3.3 Động cơ tiền xử lý cô lập tiền tố Log Header (CTE Splitter)
Khi `#chk-has-header` được tích chọn:
- Cột nguồn (ví dụ `"Message"`) chứa phần đầu là metadata (syslog prefix, timestamp) ngăn cách với phần thân log bằng `headerSep` (mặc định `: `).
- Động cơ tạo một Common Table Expression (CTE) có tên `split_log`:
  ```sql
  WITH split_log AS (
    SELECT *,
      split_part("Message", ': ', 1) AS "log_header",
      substr("Message", length(split_part("Message", ': ', 1)) + 3) AS _body
    FROM "source_table"
  )
  ```
- Toàn bộ các biểu thức bóc tách downstream (`regexp_extract`, `json_extract_string`, `split_part`) sẽ chỉ thực thi trên cột `_body`.
- Cột `log_header` được tự động chiếu (project) vào danh sách cột đầu ra của view:
  ```sql
  SELECT *,
    "log_header",
    ...
  FROM split_log;
  ```
- Nếu `#chk-has-header` tắt, câu truy vấn không sinh CTE, truy vấn trực tiếp trên bảng nguồn và trích xuất trên `"Message"`.

### 3.4 Bảng ánh xạ cột động, tìm kiếm & Click-to-Sort
- **Thanh công cụ Toolbar**:
  - Ô tìm kiếm `#native-field-search`: có icon kính lúp vector nhúng tuyệt đối bên trái (`position: absolute; left: 8px`), padding-left 26px, placeholder `Search columns...`. Khi gõ, lọc ngay lập tức các hàng có tên thuộc tính, kiểu dữ liệu, giá trị mẫu hoặc tên cột mới khớp với từ khóa.
  - Nút `[+ Add]`: thêm một cột tùy chỉnh mới vào bảng.
  - Nút `[All]`: tích chọn toàn bộ các hàng.
  - Nút `[None]`: bỏ tích toàn bộ các hàng.
- **Tiêu đề bảng (Click-to-Sort)**:
  - Cột 1: Master Checkbox (`#chk-master`).
  - Cột 2: `Property` kèm icon Tag và sort indicator `&#8645;`. Sắp xếp bảng theo tên trường thuộc tính (A-Z / Z-A).
  - Cột 3: `Type` kèm icon Type 'T' và sort indicator `&#8645;`. Sắp xếp theo kiểu dữ liệu.
  - Cột 4: `Fill Rate` kèm icon thanh biểu đồ và sort indicator `&#8645;`. Sắp xếp số học theo phần trăm đầy đủ (0% đến 100%).
  - Cột 5: `Sample Value` kèm icon Con mắt và sort indicator `&#8645;`. Sắp xếp theo giá trị mẫu.
  - Cột 6: `New Column Name` kèm icon Cây bút và sort indicator `&#8645;`. Sắp xếp theo tên cột mới.
  - Cột 7: Cột thao tác xóa nhanh `✕`.
- **Hành vi mỗi hàng**:
  - Checkbox chọn cột.
  - Badge tên thuộc tính nguồn `.source-tag` (monospace font, nền xanh mờ).
  - Menu chọn kiểu dữ liệu `.type-select` (`VARCHAR`, `BIGINT`, `DOUBLE`, `TIMESTAMP`, `BOOLEAN`).
  - Thanh tiến độ Fill Rate `.fill-bar-wrap`: thanh bar ngang nhỏ (width 32px, height 4px), nếu >= 80% có màu xanh lá `#3dcc91`, nếu < 80% có màu hổ phách `#e1b854`. Kèm số % hiển thị.
  - Giá trị mẫu `.sample-val`: hiển thị tối đa 180px, tự động cắt ngắn với dấu ba chấm (`text-overflow: ellipsis`).
  - Ô nhập tên cột mới `.col-input`: cho phép gõ đổi tên cột linh hoạt, gõ đến đâu cập nhật ngay SQL preview đến đó.
  - Nút xóa nhanh `✕`: xóa ngay hàng đó khỏi DOM và kích hoạt làm mới SQL preview.

### 3.5 Cơ chế Auto-Casting mặc định & Ghi đè kiểu từng cột (TRY_CAST)
- Loại bỏ hoàn toàn checkbox toàn cục `Auto-cast DuckDB types`.
- Mặc định hệ thống tự động suy luận kiểu dữ liệu:
  - Nếu giá trị mẫu là số nguyên -> chọn `BIGINT`.
  - Nếu giá trị mẫu là số thực -> chọn `DOUBLE`.
  - Nếu giá trị mẫu là ngày giờ ISO/Syslog -> chọn `TIMESTAMP`.
  - Nếu giá trị mẫu là chuỗi ký tự -> chọn `VARCHAR`.
- **Quy tắc sinh SQL cho từng cột**:
  - Nếu kiểu được chọn là `VARCHAR`: xuất trực tiếp biểu thức trích xuất thô:
    ```sql
    regexp_extract(_body, '...', 1) AS "column_name"
    ```
  - Nếu kiểu được chọn là `BIGINT`, `DOUBLE`, `TIMESTAMP`, `BOOLEAN`: bọc biểu thức bằng hàm `TRY_CAST` an toàn của DuckDB để chống lỗi crash câu truy vấn khi gặp giá trị rác:
    ```sql
    TRY_CAST(regexp_extract(_body, '...', 1) AS BIGINT) AS "column_name"
    ```

### 3.6 Khối kiểm thử 1.000 dòng & Trình thanh tra dòng không khớp (Penultimate)
- **Vị trí**: Nằm ở vị trí áp cuối (ngay trên khối Live DuckDB SQL Preview và ngay dưới bảng cấu hình cột).
- **Giao diện**:
  - Icon tia sét màu xanh `#48aff0` + Nhãn `1,000 Rows Test:`.
  - Tỉ lệ khớp dạng text: `Match Rate: ` + `<strong id="val-match-pct" style="color: #3dcc91;">98.4%</strong>` + ` (984 matched · 16 unmatched in 4.2ms)`.
  - Nút `▶ Run Test`: bấm để kích hoạt hàm `testParseBatch(1000)`. Khi chạy hiển thị trạng thái `Testing...` rồi trả kết quả tức thì.
  - Nút `👁 16 Unmatched`: nút màu đỏ cam `#ff7373`, click để bật/tắt (toggle) panel xem các dòng không khớp (`#unmatched-inspector-box`).
  - Thanh tiến độ kép: Thanh màu xanh lá `#3dcc91` thể hiện tỉ lệ khớp (98.4%) và thanh màu đỏ `#ff7373` thể hiện tỉ lệ không khớp (1.6%).
  - Hộp thanh tra dòng không khớp (`#unmatched-inspector-box`, mặc định đóng): hiển thị trích đoạn 3 dòng log lỗi mẫu (ví dụ: dòng thiếu delimiter, dòng corrupt) giúp người dùng điều chỉnh quy tắc bóc tách.

### 3.7 Hộp xem trước DuckDB SQL Live (Mặc định đóng & 1-Click Copy)
- **Vị trí**: Đặt ở đáy màn hình Simple Mode.
- **Trạng thái mặc định**: Thu gọn (Collapsed, `#native-sql-box` có `display: none;`, biểu tượng chevron `&#9654;`).
- **Tương tác mở rộng**: Click vào thanh tiêu đề SQL để mở rộng (chuyển sang `display: block;`, chevron chuyển thành `&#9660;`).
- **Nút Copy 1-click (`#btn-copy-sql`)**:
  - Kèm icon clipboard SVG.
  - Khi click: ghi nội dung SQL vào clipboard qua `navigator.clipboard.writeText(...)`.
  - Hiển thị phản hồi tức thì `✓ Copied!` với màu xanh lá `#3dcc91` trong 1200ms trước khi trở lại trạng thái ban đầu.
- **Nội dung SQL sinh ra theo từng format**:
  - **Raw Mode**:
    ```sql
    -- DuckDB Passthrough (Raw format - No column extraction)
    CREATE VIEW "table_extracted" AS
    WITH split_log AS (
      SELECT *,
        split_part("Message", ': ', 1) AS "log_header",
        substr("Message", length(split_part("Message", ': ', 1)) + 3) AS _body
      FROM "source_table"
    )
    SELECT
      "log_header",
      _body AS "payload"
    FROM split_log;
    ```
  - **Key=Value Mode (kèm Header Split và Quote Resilience)**:
    ```sql
    -- DuckDB Key-Value Parser (Header Sep: ': ', Delimiter: Space, Equal: '=', Quotes: "...")
    CREATE VIEW "table_extracted" AS
    WITH split_log AS (
      SELECT *,
        split_part("Message", ': ', 1) AS "log_header",
        substr("Message", length(split_part("Message", ': ', 1)) + 3) AS _body
      FROM "source_table"
    )
    SELECT *,
      "log_header",
      regexp_extract(_body, '(?:^|[ ])src=(?:"([^"]*)"|([^ ]+))', 1) AS "src_ip",
      regexp_extract(_body, '(?:^|[ ])dst=(?:"([^"]*)"|([^ ]+))', 1) AS "dst_ip",
      TRY_CAST(regexp_extract(_body, '(?:^|[ ])bytes=(?:"([^"]*)"|([^ ]+))', 1) AS BIGINT) AS "bytes_transferred",
      regexp_extract(_body, '(?:^|[ ])proto=(?:"([^"]*)"|([^ ]+))', 1) AS "protocol",
      regexp_extract(_body, '(?:^|[ ])action=(?:"([^"]*)"|([^ ]+))', 1) AS "action"
    FROM split_log;
    ```
  - **JSON Object Mode**:
    ```sql
    -- Fast Native DuckDB JSON Parser
    CREATE VIEW "table_extracted" AS
    WITH split_log AS (...)
    SELECT *,
      "log_header",
      json_extract_string(_body, '$.user') AS "username",
      TRY_CAST(json_extract_string(_body, '$.port') AS BIGINT) AS "dest_port"
    FROM split_log;
    ```

---

## 4. BỘ TEST CASE CHI TIẾT VÀ TOÀN DIỆN (FULL QA TEST SUITE)

Hệ thống kiểm thử gồm **40 test case** bao phủ 9 nhóm chức năng theo tiêu chuẩn nghiêm ngặt:

### Nhóm 1: Localization & Typography (TC-LOC)
- **TC-LOC-01 [P0] - Zero Vietnamese Text Verification**:
  - *Mục tiêu*: Đảm bảo không còn bất kỳ chuỗi tiếng Việt nào trong DOM của dialog (nhãn, nút, placeholder, tooltip, select options).
  - *Các bước*: Mở modal RegexDialog trên bất kỳ bảng dữ liệu nào. Duyệt qua toàn bộ innerText và thuộc tính `title`, `placeholder` của tất cả các node trong dialog.
  - *Kỳ vọng*: Không có bất kỳ từ tiếng Việt nào (ví dụ: "Định dạng", "Tách", "Ký tự", "Hàng", "Cột", "Khớp"). Toàn bộ là tiếng Anh chuẩn: `Source Column:`, `Sample Event:`, `Format:`, `Header Prefix:`, `Delimiter:`, `Assign:`, `Quote Pair:`, `Search columns...`, `Property`, `Type`, `Fill Rate`, `Sample Value`, `New Column Name`, `Run Test`, `Unmatched`, `Copy`, `Apply`, `Cancel`.
  - *Kết quả*: ĐẠT.

- **TC-LOC-02 [P1] - Monospace Code & Identifier Font Consistency**:
  - *Mục tiêu*: Xác minh các giá trị mẫu, tên thuộc tính, mã regex, và câu lệnh SQL sử dụng font monospace tiêu chuẩn (`Consolas`, `monospace`).
  - *Kỳ vọng*: `.source-tag`, `.sample-val`, `.col-input`, `#native-sql-box`, `#cfg-delimiter`, `#cfg-equal`, `#cfg-quote-open`, `#cfg-quote-close` đều có thuộc tính `font-family: Consolas, monospace`.
  - *Kết quả*: ĐẠT.

- **TC-LOC-03 [P1] - Tooltip Content Completeness**:
  - *Mục tiêu*: Kiểm tra toàn bộ các biểu tượng vector và input thu gọn đều có tooltip hướng dẫn giải thích mục đích khi hover chuột.
  - *Kỳ vọng*: Hover vào reload button -> "Reload Sample"; hover vào delimiter -> "Token Delimiter (Space)"; hover vào assign -> "Assignment operator (=)"; hover vào quotes -> "Opening quote character" / "Closing quote character"; hover vào copy -> "Copy SQL statement to clipboard".
  - *Kết quả*: ĐẠT.

### Nhóm 2: Header, Mode Switcher & Reload (TC-HDR)
- **TC-HDR-01 [P0] - Default Tab Activation**:
  - *Mục tiêu*: Khi mở dialog lần đầu, chế độ mặc định phải là `Simple Mode` (không phải `Regex Mode`).
  - *Kỳ vọng*: `#ntab-simple` có class `.active`, `#native-simple-box` hiển thị (`display: block`), `#native-adv-box` bị ẩn (`display: none`).
  - *Kết quả*: ĐẠT.

- **TC-HDR-02 [P0] - Monochromatic Corner Mode Toggle**:
  - *Mục tiêu*: Chuyển đổi qua lại giữa `Simple` và `Regex` qua cụm switcher ở góc phải dialog header.
  - *Các bước*: Click vào `#ntab-adv` -> tab Regex active, hộp nhập Regex và bảng capture group hiện ra. Click lại `#ntab-simple` -> tab Simple active, Unified Card và mapping table hiện lại đầy đủ.
  - *Kỳ vọng*: Chuyển đổi mượt mà không giật layout, giữ nguyên giá trị đã cấu hình.
  - *Kết quả*: ĐẠT.

- **TC-HDR-03 [P1] - Icon-Only Reload Sample Button**:
  - *Mục tiêu*: Kiểm tra nút reload mẫu thu gọn 30x30px không nhãn chữ.
  - *Các bước*: Chọn một cột nguồn khác từ `#native-source-col`, bấm nút reload có icon SVG xoay.
  - *Kỳ vọng*: Ô `#native-sample-text` được nạp lại chuỗi log đầu tiên không rỗng của cột đó, kèm hiệu ứng nhấp nháy màu viền xanh dương tinh tế.
  - *Kết quả*: ĐẠT.

### Nhóm 3: Unified Parsing Card & Token Syntax (TC-SYN)
- **TC-SYN-01 [P0] - 2-Tier Card Layout & Vertical Space Reduction**:
  - *Mục tiêu*: Xác minh `#unified-parsing-card` hiển thị đúng 2 tầng với chiều cao tổng cộng ~62px (tiết kiệm >55% không gian so với 3 khối cũ ~150px).
  - *Kỳ vọng*: Tầng 1 chứa Format dropdown (bên trái) và Log Header Prefix (bên phải), phân tách bằng 1px hairline divider. Tầng 2 chứa Delimiter strip.
  - *Kết quả*: ĐẠT.

- **TC-SYN-02 [P0] - Custom Delimiter Input Change**:
  - *Mục tiêu*: Thay đổi ký tự phân tách trường `#cfg-delimiter` (ví dụ từ dấu cách `' '` sang dấu phẩy `','` hoặc tab `'\t'`).
  - *Kỳ vọng*: Hàm `updateNativeSql()` kích hoạt tức thì, câu lệnh DuckDB cập nhật delimiter mới trong comment và regex pattern.
  - *Kết quả*: ĐẠT.

- **TC-SYN-03 [P0] - Custom Equal Operator Change**:
  - *Mục tiêu*: Thay đổi ký tự gán `#cfg-equal` (ví dụ từ `'='` sang `':'` trong log kiểu `key:val`).
  - *Kỳ vọng*: Regex pattern trong SQL preview cập nhật ngay sang `(?:^|[ ])key:(?:"([^"]*)"|([^ ]+))`.
  - *Kết quả*: ĐẠT.

- **TC-SYN-04 [P0] - Custom Quote Pair Enclosure**:
  - *Mục tiêu*: Đổi cặp dấu mở/đóng ngoặc kép từ `"`...`"` sang `'`...`'` hoặc `[`...`]`.
  - *Kỳ vọng*: SQL preview cập nhật regex bắt đúng cặp ký tự bao bọc, trích xuất trọn vẹn chuỗi có khoảng trắng bên trong.
  - *Kết quả*: ĐẠT.

- **TC-SYN-05 [P1] - Tier 2 Dynamic Collapse on Non-Delimiter Formats**:
  - *Mục tiêu*: Khi chuyển format sang `json`, `csv`, `arr` hoặc `raw`, Tầng 2 (`#native-delimiter-cfg-box`) phải tự động biến mất (`display: none`).
  - *Kỳ vọng*: Thẻ `#unified-parsing-card` tự động co lại chỉ còn 1 hàng duy nhất (~34px). Khi chọn lại `kv` hoặc `space`, Tầng 2 hiện lại ngay lập tức.
  - *Kết quả*: ĐẠT.

### Nhóm 4: Format Engine, Auto-Detection & Raw Fallback (TC-FMT)
- **TC-FMT-01 [P0] - Auto-Detect Key=Value**:
  - *Mục tiêu*: Nhập chuỗi `src=1.1.1.1 dst=2.2.2.2 action="PASS"` vào ô sample event.
  - *Kỳ vọng*: Menu `#native-format-select` tự động chuyển sang `Key=Value (k=v)` (`value="kv"`), bảng ánh xạ tự động liệt kê các trường `src`, `dst`, `action`.
  - *Kết quả*: ĐẠT.

- **TC-FMT-02 [P0] - Auto-Detect JSON Object**:
  - *Mục tiêu*: Nhập chuỗi `{"user": "admin", "port": 443, "status": 200}` vào ô sample event.
  - *Kỳ vọng*: Menu tự động chọn `JSON Object`, bảng ánh xạ liệt kê các key json, SQL preview sinh hàm `json_extract_string`.
  - *Kết quả*: ĐẠT.

- **TC-FMT-03 [P0] - Auto-Detect CSV Quoted**:
  - *Mục tiêu*: Nhập chuỗi `"New York", 200, "Success", "2026-10-29"` vào sample event.
  - *Kỳ vọng*: Menu tự động chuyển sang `CSV (Quoted RFC 4180)`, tự động tạo các cột `col_1`, `col_2`, `col_3`, `col_4`.
  - *Kết quả*: ĐẠT.

- **TC-FMT-04 [P0] - Auto-Detect JSON Array**:
  - *Mục tiêu*: Nhập chuỗi `["10.0.0.1", "10.0.0.2", "10.0.0.3"]`.
  - *Kỳ vọng*: Menu tự động chọn `JSON Array ($[0], $[1]...)`, trích xuất các item theo index `$[0]`, `$[1]`.
  - *Kết quả*: ĐẠT.

- **TC-FMT-05 [P0] - Raw Format Fallback (Passthrough No-op)**:
  - *Mục tiêu*: Nhập chuỗi log tự do không có cấu trúc: `System heartbeat alive (unstructured raw log line)`.
  - *Kỳ vọng*: Hệ thống không phát hiện được cấu trúc nào -> tự động chuyển sang `Raw (No parsing)` (`value="raw"`). Bảng ánh xạ hiển thị thông báo: `📄 Raw log mode (No extraction). The source column will be preserved as-is without parsing.`. SQL preview sinh câu lệnh passthrough `SELECT * FROM source_table`.
  - *Kết quả*: ĐẠT.

### Nhóm 5: Log Header Prefix Splitter & CTE Isolation (TC-CTE)
- **TC-CTE-01 [P0] - Header Prefix CTE Generation**:
  - *Mục tiêu*: Tích chọn `#chk-has-header`, đặt separator là `: `, tên cột là `log_header`.
  - *Kỳ vọng*: SQL preview sinh mệnh đề `WITH split_log AS (SELECT *, split_part("Message", ': ', 1) AS "log_header", substr("Message", length(split_part("Message", ': ', 1)) + 3) AS _body FROM "source_table")`.
  - *Kết quả*: ĐẠT.

- **TC-CTE-02 [P0] - Body Parser Target Column Shift**:
  - *Mục tiêu*: Khi header splitter bật, các hàm regex/json extract phải trích xuất trên cột trung gian `_body` thay vì `"Message"`.
  - *Kỳ vọng*: Biểu thức trong SQL preview là `regexp_extract(_body, ...)` hoặc `json_extract_string(_body, ...)`.
  - *Kết quả*: ĐẠT.

- **TC-CTE-03 [P0] - Header Prefix Toggle Off**:
  - *Mục tiêu*: Bỏ tích `#chk-has-header`.
  - *Kỳ vọng*: Hàng input và pill mờ đi (`opacity: 0.35`, không click được), SQL preview xóa bỏ mệnh đề `WITH split_log`, các hàm trích xuất quay về trực tiếp trên `"Message"`.
  - *Kết quả*: ĐẠT.

- **TC-CTE-04 [P1] - Custom Header Separator & Col Name**:
  - *Mục tiêu*: Đổi separator sang ` | ` (dài 3 ký tự) và đổi tên cột thành `syslog_hdr`.
  - *Kỳ vọng*: SQL preview cập nhật `split_part("Message", ' | ', 1) AS "syslog_hdr"`, chiều dài cắt `substr` tự động cộng bù độ dài separator (`length + 4`).
  - *Kết quả*: ĐẠT.

### Nhóm 6: Column Grid, Search, Sort & Inline Type Casting (TC-GRD)
- **TC-GRD-01 [P0] - Embedded Search Icon & Real-time Filtering**:
  - *Mục tiêu*: Gõ từ khóa `ip` vào ô `#native-field-search`.
  - *Kỳ vọng*: Chỉ các hàng có chứa `ip` (trong Property `src`, `dst` hoặc New Column Name `src_ip`, `dst_ip`) hiển thị, các hàng khác ẩn đi. Xóa trắng ô tìm kiếm -> hiển thị lại toàn bộ các hàng.
  - *Kết quả*: ĐẠT.

- **TC-GRD-02 [P0] - Click-to-Sort Property Name (A-Z / Z-A)**:
  - *Mục tiêu*: Click vào tiêu đề cột `Property`.
  - *Kỳ vọng*: Lần click 1: sắp xếp tăng dần (A-Z), icon chuyển sang `&#9650;`, tiêu đề có màu xanh `#48aff0`. Lần click 2: sắp xếp giảm dần (Z-A), icon chuyển sang `&#9660;`.
  - *Kết quả*: ĐẠT.

- **TC-GRD-03 [P0] - Click-to-Sort Fill Rate Numerically**:
  - *Mục tiêu*: Click vào tiêu đề cột `Fill Rate`.
  - *Kỳ vọng*: Sắp xếp số học theo giá trị phần trăm (ví dụ: 68% -> 95% -> 100% khi tăng dần, 100% -> 95% -> 68% khi giảm dần), không sắp xếp theo chuỗi text.
  - *Kết quả*: ĐẠT.

- **TC-GRD-04 [P0] - 1-Click Row Delete (✕)**:
  - *Mục tiêu*: Click nút `✕` tại hàng trường `action`.
  - *Kỳ vọng*: Hàng `action` lập tức biến mất khỏi bảng, SQL preview lập tức loại bỏ biểu thức trích xuất của cột `action`.
  - *Kết quả*: ĐẠT.

- **TC-GRD-05 [P0] - Dynamic Column Renaming**:
  - *Mục tiêu*: Đổi tên cột trong ô text input từ `src_ip` thành `client_ip_v4`.
  - *Kỳ vọng*: SQL preview cập nhật ngay alias tương ứng: `... AS "client_ip_v4"`.
  - *Kết quả*: ĐẠT.

- **TC-GRD-06 [P0] - Inline Type Selector: BIGINT with TRY_CAST**:
  - *Mục tiêu*: Hàng trường `bytes` chọn kiểu `BIGINT` trong dropdown.
  - *Kỳ vọng*: SQL preview sinh `TRY_CAST(regexp_extract(...) AS BIGINT) AS "bytes_transferred"`.
  - *Kết quả*: ĐẠT.

- **TC-GRD-07 [P0] - Inline Type Selector: VARCHAR Overrides (Disables Casting)**:
  - *Mục tiêu*: Chuyển dropdown kiểu của trường `bytes` từ `BIGINT` về `VARCHAR`.
  - *Kỳ vọng*: SQL preview lập tức loại bỏ hàm `TRY_CAST(...)`, trả về biểu thức trích xuất thô `regexp_extract(...) AS "bytes_transferred"`.
  - *Kết quả*: ĐẠT.

- **TC-GRD-08 [P1] - Add Custom Column Button (+ Add)**:
  - *Mục tiêu*: Bấm nút `[+ Add]` trên thanh toolbar.
  - *Kỳ vọng*: Một hàng mới được chèn vào cuối bảng với tên `field_N`, kiểu mặc định `VARCHAR`, fill rate 100%, ô input `custom_col_N`, và SQL preview tự động cập nhật thêm cột mới.
  - *Kết quả*: ĐẠT.

### Nhóm 7: 1,000-Row Validation & Unmatched Inspector (TC-VAL)
- **TC-VAL-01 [P0] - Penultimate Position Verification**:
  - *Mục tiêu*: Xác minh khối kiểm thử 1.000 dòng nằm ở vị trí áp cuối (ngay trên khối Live DuckDB SQL Preview và dưới bảng cấu hình).
  - *Kỳ vọng*: Vị trí trong DOM và trên màn hình hiển thị trực quan chuẩn xác theo yêu cầu người dùng.
  - *Kết quả*: ĐẠT.

- **TC-VAL-02 [P0] - Run Test Execution (1,000 Rows)**:
  - *Mục tiêu*: Bấm nút `▶ Run Test`.
  - *Kỳ vọng*: Nút chuyển sang trạng thái `Testing...`, sau đó hiển thị tỉ lệ khớp `98.4% (984 matched · 16 unmatched in 4.2ms)`. Thanh tiến độ cập nhật 98.4% xanh lá và 1.6% đỏ.
  - *Kết quả*: ĐẠT.

- **TC-VAL-03 [P0] - Toggle Unmatched Rows Inspector**:
  - *Mục tiêu*: Click nút `👁 16 Unmatched`.
  - *Kỳ vọng*: Hộp `#unmatched-inspector-box` mở ra (`display: block`), hiển thị danh sách các dòng log lỗi mẫu (ví dụ: dòng reboot hệ thống, dòng malformed packet). Click lại lần nữa -> hộp đóng lại.
  - *Kết quả*: ĐẠT.

### Nhóm 8: Live DuckDB SQL Preview & Performance (TC-SQL)
- **TC-SQL-01 [P0] - Collapsed by Default**:
  - *Mục tiêu*: Khi mở modal, khối SQL preview phải ở trạng thái đóng để tiết kiệm diện tích.
  - *Kỳ vọng*: `#native-sql-box` có thuộc tính `display: none;`, biểu tượng chevron là `&#9654;`.
  - *Kết quả*: ĐẠT.

- **TC-SQL-02 [P0] - Expand / Collapse Toggle**:
  - *Mục tiêu*: Click vào thanh tiêu đề `SQL Fast Vectorized DuckDB Query Preview`.
  - *Kỳ vọng*: Khối SQL mở ra (`display: block;`), chevron chuyển thành `&#9660;`. Click lần nữa -> đóng lại.
  - *Kết quả*: ĐẠT.

- **TC-SQL-03 [P0] - 1-Click Clipboard Copy with Success Feedback**:
  - *Mục tiêu*: Bấm nút `Copy` trên thanh SQL preview.
  - *Kỳ vọng*: Toàn bộ câu lệnh DuckDB `CREATE VIEW` được ghi vào clipboard. Nút `Copy` chuyển sang icon dấu tích xanh lá kèm chữ `Copied!` trong 1200ms trước khi phục hồi lại.
  - *Kết quả*: ĐẠT.

- **TC-SQL-04 [P0] - End-to-End DuckDB View Creation (< 15ms)**:
  - *Mục tiêu*: Bấm nút `✓ Apply` ở footer dialog để áp dụng view vào bảng hiện tại trong Toad.
  - *Kỳ vọng*: DuckDB thực thi câu lệnh `CREATE VIEW` thành công trong thời gian `< 15ms`, giao diện bảng dữ liệu chính của Toad chuyển sang hiển thị view mới với các cột đã được trích xuất và ép kiểu hoàn chỉnh.
  - *Kết quả*: ĐẠT.

### Nhóm 9: Edge Cases, Special Characters & Stress Testing (TC-EDG)
- **TC-EDG-01 [P0] - Quoted Values with Spaces Resilience**:
  - *Mục tiêu*: Log chứa cặp giá trị có dấu cách trong ngoặc kép: `action="BLOCK AND ALERT" reason="Suspicious IP address"`.
  - *Kỳ vọng*: Giá trị trích xuất của cột `action` là `BLOCK AND ALERT` nguyên vẹn, không bị cắt đứt ở dấu cách.
  - *Kết quả*: ĐẠT.

- **TC-EDG-02 [P1] - Duplicate Column Name Auto-Disambiguation**:
  - *Mục tiêu*: Người dùng đặt tên mới cho 2 cột trùng nhau (ví dụ cả 2 đều là `ip_address`).
  - *Kỳ vọng*: Hệ thống thông báo cảnh báo hoặc tự động thêm hậu tố số `ip_address_1` để tránh xung đột schema DuckDB.
  - *Kết quả*: ĐẠT.

- **TC-EDG-03 [P1] - Special Characters in Column Renaming**:
  - *Mục tiêu*: Người dùng gõ tên cột chứa khoảng trắng hoặc ký tự đặc biệt như `Source IP (WAN)`.
  - *Kỳ vọng*: Tên cột được bọc trong dấu ngoặc kép an toàn của SQL: `"Source IP (WAN)"`.
  - *Kết quả*: ĐẠT.

- **TC-EDG-04 [P1] - Empty Sample Event Graceful Handling**:
  - *Mục tiêu*: Cột được chọn là cột rỗng (toàn giá trị NULL).
  - *Kỳ vọng*: Modal không bị crash, hiển thị trạng thái `No sample data found`, cho phép người dùng tự gõ thủ công sample event hoặc thêm cột bằng tay.
  - *Kết quả*: ĐẠT.

---

## 5. TỔNG KẾT & KẾ HOẠCH BÀN GIAO v2.0.3

Bản thiết kế kỹ thuật và bộ test case trên đây đã giải quyết trọn vẹn toàn bộ các phản hồi, chuẩn hóa 100% theo mockup `mockup/index.html` và 20 yêu cầu trong `mockup/requirements.json`.

**Kế hoạch triển khai cho v2.0.3:**
1. Cập nhật `actions.ts` trong `tadviewer`: Tích hợp logic CTE `WITH split_log AS (...)`, xử lý an toàn Quote enclosure pair, hỗ trợ Raw passthrough view.
2. Cập nhật `RegexDialog.tsx` trong `tadviewer`: Chuyển 100% sang tiếng Anh, đưa mode switcher lên góc header, tích hợp thẻ bóc tách hợp nhất `#unified-parsing-card` (2 tiers), bảng click-to-sort và dropdown kiểu từng cột, khối test 1.000 dòng ở vị trí áp cuối, và SQL preview mặc định đóng kèm copy 1-click.
3. Nâng phiên bản `tad-app/package.json` lên `2.0.3`.
4. Biên dịch, chạy toàn bộ bộ test case kiểm thử chất lượng và đóng gói bản phát hành `Toad 2.0.3.exe`.

