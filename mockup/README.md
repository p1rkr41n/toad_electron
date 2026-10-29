# BẢN THIẾT KẾ GIAO DIỆN CHÍNH THỨC (MOCKUP) - TOAD COLUMN EXTRACTOR & FAST PARSER

> **Mục tiêu:** Giao diện bóc tách cột và trích xuất dữ liệu nhanh (Fast Parsing & Regex) cho **Toad v2.0.2**, tuân thủ nguyên bản phong cách thiết kế **BlueprintJS 4 Dark Theme** của Toad, toàn bộ ngôn ngữ giao diện tiếng Anh 100%, tối ưu hóa hiệu năng với DuckDB.  
> **Tệp Mockup tương tác:** [`mockup/index.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/index.html)  
> **Tệp Đặc tả yêu cầu kỹ thuật:** [`mockup/requirements.json`](file:///d:/Shared_UserData/Downloads/tad/mockup/requirements.json)  
> **Phiên bản áp dụng:** Toad v2.0.2

---

## 1. CÁC TÍNH NĂNG VÀ CẢI TIẾN NỔI BẬT (TOAD v2.0.2)

1. **Giao diện Tiếng Anh toàn diện (100% English Localization)**:
   - Toàn bộ nhãn, nút bấm, thông báo trạng thái, tooltip và câu lệnh SQL đều sử dụng tiếng Anh chuẩn công cụ lập trình quốc tế.

2. **Nút tải lại mẫu dạng Icon-Only & Bộ chuyển chế độ Đơn sắc ở góc Header**:
   - Nút `Reload Sample` dạng icon xoay gọn gàng bên cạnh Source Column.
   - **Monochromatic Corner Mode Switcher**: Icon tia sét (Simple) và cờ lê (Regex) dạng vector đơn sắc (monolithic monochrome) được đưa gọn vào góc trên cùng bên phải thanh tiêu đề dialog. Mặc định là Simple Mode; click chuyển đổi mượt mà giữa chế độ Trực quan (Simple) và Regex chuyên nghiệp.

3. **Khối Hợp Nhất Quy Tắc Bóc Tách (Unified Parsing Rules Panel - Gom thành 1 Card duy nhất)**:
   - Gom toàn bộ 3 phần rời rạc trước đây (*Data Format*, *Log Header Prefix*, *Delimiter & Quotes*) thành **1 Card thống nhất duy nhất**, tiết kiệm hơn 55% chiều cao.
   - **Tầng 1 (Hàng trên)**: Menu chọn `Format: [ Key=Value ▾ ]` đặt bên trái, ngăn cách bằng vạch dọc hairline tinh tế với nhóm `Header Prefix: [ : ] → [ log_header ]` và pill `[H] : [Body]` bên phải.
   - **Tầng 2 (Hàng dưới)**: Dải ký tự bóc tách `Delimiter: [ Space ]`, `Assign: [ = ]`, `Quote Pair: [ " ]..[ " ]` nằm ngay bên dưới trên nền tối nhẹ. Tự động ẩn đi khi chọn JSON, CSV hoặc Raw để giao diện tối giản nhất có thể.

4. **Tùy chỉnh Ký tự Phân tách, Toán tử Bằng & Cặp Dấu Ngoặc Kép (Tự động thích ứng)**:
   - **Item Delimiter**: Ký tự phân tách các trường (mặc định: phím cách `" "`, dấu phẩy, tab...).
   - **Equal Operator**: Ký tự gán cặp Key-Value (mặc định: `"="`).
   - **Quote Enclosure Pair**: Cặp ô mở/đóng (mặc định: `"` và `"`) tự động bảo vệ chuỗi có khoảng trắng (ví dụ: `action="BLOCK AND ALERT"`). Không cần thêm checkbox riêng.

5. **Kiểm tra Tỉ lệ Khớp trên 1.000 Dòng (Test Parse 1,000 Rows Match Rate - Đặt áp cuối)**:
   - Được bố trí ở vị trí áp cuối (ngay phía trên hộp xem trước câu lệnh DuckDB raw query và dưới bảng cấu hình cột/resilience toggles).
   - Cho phép quét thử nghiệm 1.000 dòng từ bảng dữ liệu hiện tại trước khi hoàn tất áp dụng.
   - Hiển thị thanh tiến độ trực quan với tỉ lệ khớp % (ví dụ: `98.4% Matched · 16 Unmatched in 4.2ms`).
   - Bảng xem chi tiết các dòng không khớp (Unmatched Inspector) giúp người dùng tinh chỉnh quy tắc bóc tách kịp thời.

6. **Menu Thả xuống Tự động Nhận diện & Chế độ Raw (Data Format Auto-Select & Raw Mode)**:
   - Tinh giản giao diện: Bỏ badge nhận diện riêng bên cạnh để tránh rối mắt.
   - **Tự động lăn đến dòng phát hiện**: Menu thả xuống `<select>` tự động chuyển đến định dạng khớp với mẫu (Key=Value, JSON, CSV, Delimited, JSON Array).
   - **Chế độ Raw (không làm gì cả)**: Nếu không phát hiện định dạng cấu trúc nào, hệ thống tự động để là `Raw (No parsing)` – giữ nguyên cột nguồn nguyên bản không bóc tách.

7. **Tìm kiếm Cột Tối giản & Sắp xếp tại Đầu mỗi Cột (Column Search & Header Sorting)**:
   - Tinh giản giao diện: Lược bỏ các nút lọc pill dư thừa, chỉ giữ ô tìm kiếm cột gọn gàng (`Search columns...`).
   - **Click-to-Sort tại đầu mỗi cột**: Cho phép click vào từng tiêu đề cột (`Property`, `Inferred Type`, `Fill Rate`, `Sample Value`, `New Column Name`) để sắp xếp tăng dần / giảm dần tức thì với biểu tượng trực quan (`&#8645;`, `&#9650;`, `&#9660;`).

8. **Bảng Ánh xạ Cột & Bộ Chọn Kiểu Dữ liệu Từng Cột (Inline Type Selector & Auto-Casting)**:
   - **Tự động ép kiểu luôn bật theo từng cột**: Mỗi cột có một menu chọn kiểu dữ liệu riêng (`VARCHAR`, `BIGINT`, `DOUBLE`, `TIMESTAMP`, `BOOLEAN`), mặc định chọn kiểu suy luận (ví dụ: `BIGINT` cho số) và tự động sinh `TRY_CAST(... AS BIGINT)`.
   - **Tắt ép kiểu linh hoạt**: Nếu muốn giữ nguyên chuỗi thô không ép kiểu cho cột nào, người dùng chỉ cần chuyển menu của cột đó về `VARCHAR`.
   - **Lược bỏ toàn bộ checkbox rời rạc**: Bỏ hoàn toàn các checkbox thừa dưới bảng, giao diện nối liền mạch từ bảng ánh xạ sang khối Test 1.000 dòng.
   - Thanh tỉ lệ xuất hiện (`Fill Rate %`) và ô đổi tên cột tùy ý.

9. **Live DuckDB SQL Query Preview (Mặc định đóng / Collapsed by Default)**:
   - Hộp xem trước câu lệnh DuckDB `CREATE VIEW` thời gian thực với xử lý an toàn Regex, `split_part`, `TRY_CAST` và `WITH split_log AS (...)`. Mặc định được đóng gọn lại để tiết kiệm diện tích màn hình, người dùng click để mở rộng xem khi cần, tích hợp nút sao chép 1-click.

10. **Giảm thiểu Quá tải Nhận thức & Tận dụng Tối đa Biểu tượng (Cognitive Ergonomics & Icon-Driven UI - Mới)**:
   - **Chính sách Không-đoạn-văn (Zero-paragraph policy)**: Lược bỏ hoàn toàn các câu từ/đoạn văn dài dòng giải thích kỹ thuật (như *"Separates metadata prefix..."*, *"Generated as dedicated column..."*, *"Separator character..."*). Mọi chú thích chi tiết được chuyển thành tooltip bản địa (`title="..."`) hiển thị khi hover.
   - **Thanh điều khiển thu gọn một hàng (High-density inline strip)**: Khối Header Prefix và khay cấu hình Delimiter/Quotes được thu gọn thành hàng ngang siêu gọn (34-36px), tiết kiệm diện tích và giảm mỏi mắt.
   - **Hệ thống Icon Vector Đơn sắc Toàn diện**:
     - Ô tìm kiếm nhúng icon kính lúp vector trực tiếp.
     - Nhóm nút thao tác: `[+ Add]` (cộng), `[All]` (hộp kiểm chọn tất cả), `[None]` (hộp rỗng bỏ chọn).
     - Tiêu đề cột bảng: Tag icon (Property), Type 'T' (Type), Bar meter (Fill Rate), Eye (Sample Value), Pencil (New Column Name).
     - Nút xóa cột nhanh 1-click (`✕`) tại mỗi hàng.
     - Khối Test 1.000 dòng: Icon Play (`▶ Run Test`), Icon con mắt (`👁 16 Unmatched`).
     - Hộp SQL: Icon Cơ sở dữ liệu/Terminal, nút sao chép `Copy` với icon Clipboard và phản hồi trạng thái tức thì.
     - Dialog Footer: Icon tia sét xác nhận độ trễ `< 15ms` và icon dấu tích `✓ Apply`.

---

## 2. CẤU TRÚC THƯ MỤC MOCKUP

- [`mockup/index.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/index.html): Giao diện Mockup tương tác đầy đủ duy nhất của Toad v2.0.2.
- [`mockup/requirements.json`](file:///d:/Shared_UserData/Downloads/tad/mockup/requirements.json): Mảng JSON 20 yêu cầu kỹ thuật chi tiết (`REQ-MOCKUP-001` đến `REQ-MOCKUP-020`).
- [`mockup/README.md`](file:///d:/Shared_UserData/Downloads/tad/mockup/README.md): Tài liệu hướng dẫn và mô tả tính năng.
