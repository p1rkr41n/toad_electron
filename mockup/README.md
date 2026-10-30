# BẢN THIẾT KẾ GIAO DIỆN CHÍNH THỨC (MOCKUP) - TOAD COLUMN EXTRACTOR & FAST PARSER

> **Mục tiêu:** Giao diện bóc tách cột và trích xuất dữ liệu nhanh (Fast Parsing & Regex) cho **Toad v2.0.9**, bổ sung phiên bản **Minimalist (Zen) Edition** làm **Mockup Chính (Primary Mockup)** tại `index.html`, đồng thời tích hợp bộ chuyển đổi đa phiên bản (Minimalist, Google Cloud UX, Blueprint Dark v2.0.2, Original v2.0.9), toàn bộ ngôn ngữ tiếng Anh 100%, tối ưu hóa hiệu năng cao với DuckDB.  
> **Tệp Mockup tương tác chính:** [`mockup/index.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/index.html)  
> **Tệp Mockup tham khảo độc lập:** [`mockup/parse_columns_mockup.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/parse_columns_mockup.html)  
> **Tệp Đặc tả yêu cầu kỹ thuật:** [`mockup/requirements.json`](file:///d:/Shared_UserData/Downloads/tad/mockup/requirements.json) *(24 yêu cầu chi tiết REQ-MOCKUP-001 đến REQ-MOCKUP-024)*  
> **Phiên bản áp dụng:** Toad v2.0.9 (tương thích ngược v2.0.2)

---

## 1. MOCKUP CHÍNH: MINIMALIST (ZEN) EDITION (TOAD v2.0.9)

Phiên bản **Minimalist (Zen) Edition** được thiết kế nhằm đạt đỉnh cao về công thái học nhận thức (cognitive ergonomics), giải quyết triệt để tình trạng phân mảnh ô nhập liệu (box-in-box clutter):

1. **Thanh Cấu hình Ngôn ngữ Tự nhiên (Natural Language Config Bar)**:
   - Thay thế toàn bộ 3 khối cấu hình cồng kềnh bằng 1 câu văn tự nhiên mạch lạc, dễ hiểu:  
     `Extract from [ Details ▾ ] using [ Key=Value ▾ ] split by [ ¦ ] and [ : ]`
   - Các cấu hình nâng cao (Header Prefix `:`, Header Column Name `log_header`, Quote Wrapper `" .. "`) được thu gọn tinh tế vào nút popover `[⚙ Rules]`.

2. **Hợp nhất Cột & Đổi tên Trực tiếp (Click-to-Rename Inline)**:
   - Trong hơn 90% trường hợp, người dùng giữ nguyên tên khóa gốc. Mockup hợp nhất cột `Key` và `New name` thành 1 nhãn duy nhất.
   - Khi cần đổi tên, chỉ cần click trực tiếp vào tên cột: nhãn chuyển thành ô nhập liệu ngay tức thì, gõ tên mới rồi nhấn `Enter` hoặc click ra ngoài để lưu lại (hiển thị trực quan dạng `str1 → user_id`).
   - Loại bỏ hoàn toàn hàng chục ô text input tĩnh dư thừa, giúp bảng dữ liệu cực kỳ gọn nhẹ và thoáng đãng.

3. **Menu Chọn Kiểu Dữ liệu Tinh tế (Ghost Type Select) & Xóa Nhanh Khi Hover**:
   - Kiểu dữ liệu (`string`, `int64`, `float`, `bool`) sử dụng phong cách dropdown mờ phẳng (ghost selector), không viền thô kệch.
   - Tỉ lệ xuất hiện (Fill Rate) hiển thị dạng chấm màu trực quan (xanh lá ≥50%, cam <50%) kèm tỉ lệ %.
   - Khi rê chuột (hover) vào hàng, nút xóa nhanh `✕` xuất hiện mượt mà cho phép loại bỏ cột khỏi schema chỉ với 1 click.

4. **Kiểm tra Trùng tên Cột Thời Gian Thực (Schema Guardrails)**:
   - Tự động phát hiện khi 2 cột có cùng tên định danh, hiển thị cảnh báo `⚠️ Duplicate column name detected` và tạm khóa nút `Apply` để ngăn ngừa lỗi cú pháp SQL.

5. **Nút Kiểm tra 1.000 Dòng Tích hợp Footer (Inline 1k-Row Verify)**:
   - Thu gọn khối Test 1.000 dòng cồng kềnh thành nút kiểm tra nhanh `▶ Verify 1k rows` ngay trên thanh Footer, hiển thị thời gian phản hồi siêu tốc (`< 15ms`).

6. **Nút Áp dụng Rõ ràng với Bộ đếm Cột (Apply Count Badge)**:
   - Nút `Apply (13)` tích hợp sẵn số lượng cột được chọn, mang lại sự tự tin tuyệt đối cho người dùng trước khi trích xuất.

---

## 2. BỘ CHUYỂN ĐỔI ĐA PHIÊN BẢN (MULTI-EDITION SWITCHER BAR)

Thanh điều khiển trên cùng của `mockup/index.html` cho phép xem và so sánh trực tiếp 4 biến thể thiết kế:

| Phiên bản | Biểu tượng | Mô tả đặc trưng |
| :--- | :---: | :--- |
| **Minimalist** *(Mặc định / Mockup chính)* | 🍃 | Phong cách Zen tối giản, cấu hình ngôn ngữ tự nhiên, click-to-rename, độ rộng 680px. |
| **Google UX** | ✨ | Giao diện hiện đại lấy cảm hứng từ Google Cloud: bộ lọc thông minh `⚡ ≥50% Rate`, thanh tiến độ test 1.000 dòng. |
| **Blueprint Dark** | 🌙 | Bản thiết kế chuẩn Toad v2.0.2 với BlueprintJS 4 Dark Theme palette `#293742` và Unified 2-tier Card. |
| **Original v2.0.9** | 🖥️ | Bản tái hiện nguyên bản 1:1 của hộp thoại Parse Columns v2.0.9 truyền thống. |

- **Nút Chuyển đổi Chủ đề Sáng / Tối (☀️ / 🌙 Theme Toggle)**: Hỗ trợ chuyển đổi giao diện Dark Mode / Light Mode cho phiên bản Minimalist Zen.
- **Hộp thoại Nghiên cứu Tình huống (UX Case Study Modal)**: Trình bày chi tiết 5 cải tiến lớn về trải nghiệm người dùng.

---

## 3. CÁC TÍNH NĂNG KỸ THUẬT NỀN TẢNG (DUCKDB ENGINE)

1. **Sinh Câu Lệnh DuckDB Tự Động (Live SQL Preview)**:
   - Tự động chuyển đổi quy tắc bóc tách sang câu lệnh DuckDB chuẩn (`REGEXP_EXTRACT`, `SPLIT_PART`, `json_extract_string`, `TRY_CAST`).
   - Hỗ trợ chế độ **Raw (No parsing)** giúp giữ nguyên dữ liệu gốc khi không cần bóc tách.
   - Tích hợp nút **Copy SQL** 1-click có phản hồi trực quan.

2. **Duyệt Mẫu Sự Kiện (Sample Event Cycler)**:
   - Bộ sưu tập 50 dòng log mô phỏng với điều hướng `Row 1 of 50` (`Prev` / `Next`), hiển thị số dòng `01` và nút sao chép mẫu nhanh.

---

## 4. CẤU TRÚC THƯ MỤC MOCKUP

- [`mockup/index.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/index.html): **Mockup chính thức tương tác toàn diện** (mặc định mở Minimalist Zen Edition).
- [`mockup/parse_columns_mockup.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/parse_columns_mockup.html): File mockup gốc tham khảo độc lập.
- [`mockup/requirements.json`](file:///d:/Shared_UserData/Downloads/tad/mockup/requirements.json): Danh sách 24 yêu cầu kỹ thuật chi tiết (`REQ-MOCKUP-001` đến `REQ-MOCKUP-024`).
- [`mockup/README.md`](file:///d:/Shared_UserData/Downloads/tad/mockup/README.md): Tài liệu hướng dẫn và mô tả kiến trúc thiết kế.
