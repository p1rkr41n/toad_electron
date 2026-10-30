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
     $$\text{Extract from [ Details ▾ ] using [ Key=Value ▾ ] split by [ ¦ ] and [ : ]}$$
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

## 3. DANH MỤC 24 ĐẶC TẢ KỸ THUẬT (MAPPING THEO MOCKUP MINIMALISM)

Toàn bộ 24 yêu cầu trong [`mockup/requirements.json`](file:///d:/Shared_UserData/Downloads/tad/mockup/requirements.json) đã được cập nhật chuẩn hóa hoàn toàn theo kiến trúc **Minimalist (Zen)**:

| ID | Danh mục | Tiêu đề đặc tả | Tình trạng |
| :--- | :--- | :--- | :---: |
| `REQ-MOCKUP-001` | Localization | Complete English UI Localization across Minimalist Interface | `Implemented` |
| `REQ-MOCKUP-002` | Sample Event | Streamlined Sample Event Navigator with Line Gutter & 1-Click Copy | `Implemented` |
| `REQ-MOCKUP-003` | Header & Modes | Segmented Visual vs Regex Mode Switcher & Rebranded Parse Header | `Implemented` |
| `REQ-MOCKUP-004` | Natural Language | Natural Language Extraction Sentence (Natural Language Config Bar) | `Implemented` |
| `REQ-MOCKUP-005` | Natural Language | Advanced Extraction Rules Popover (Header Prefix & Quote Wrapper) | `Implemented` |
| `REQ-MOCKUP-006` | Parsing Formats | Multi-Format Parsing Engine with Raw Passthrough Fallback | `Implemented` |
| `REQ-MOCKUP-007` | Delimiters | Configurable Delimiter, Equal Operator & Automatic Quote Resilience | `Implemented` |
| `REQ-MOCKUP-008` | Data Grid | Discovered Fields Toolbar with Instant Column Search | `Implemented` |
| `REQ-MOCKUP-009` | Smart Filter | Smart Bulk Selection Filter (⚡ ≥50% Rate Pill) | `Implemented` |
| `REQ-MOCKUP-010` | Positional Tokens | Positional Field Extractor (+ strX Adder) | `Implemented` |
| `REQ-MOCKUP-011` | Sorting | Interactive Click-to-Sort Table Headers | `Implemented` |
| `REQ-MOCKUP-012` | Inline Renaming | Merged Column Typography with Inline Click-to-Rename Interaction | `Implemented` |
| `REQ-MOCKUP-013` | Type System | Ghost Type Selector & Default Auto-Casting Engine | `Implemented` |
| `REQ-MOCKUP-014` | Column Removal | Subtle Rate Indicator Dot & Hover-Reveal Column Deletion | `Implemented` |
| `REQ-MOCKUP-015` | Schema Safety | Real-Time SQL Schema Guardrails & Duplicate Name Detection | `Implemented` |
| `REQ-MOCKUP-016` | Validation | Footer-Integrated 1,000-Row Inline Verification (▶ Verify 1k rows) | `Implemented` |
| `REQ-MOCKUP-017` | Action CTA | Action-Oriented Primary CTA with Column Count (Apply Badge) | `Implemented` |
| `REQ-MOCKUP-018` | DuckDB Engine | Collapsible Live DuckDB SQL Query Preview with 1-Click Copy | `Implemented` |
| `REQ-MOCKUP-019` | Architecture | Multi-Edition Switcher Bar (Minimalist, Google UX, Blueprint, Original) | `Implemented` |
| `REQ-MOCKUP-020` | Visual Theme | Dual Theme Adaptability (Dark / Light Zen Mode) | `Implemented` |
| `REQ-MOCKUP-021` | Documentation | UX Case Study Modal Highlighting 5 Key Innovations | `Implemented` |
| `REQ-MOCKUP-022` | Feedback | Non-Blocking Toast Notification System | `Implemented` |
| `REQ-MOCKUP-023` | Sampling Pool | Comprehensive 50-Row Sample Event Pool for Realistic Testing | `Implemented` |
| `REQ-MOCKUP-024` | Primary Standard | Minimalist Zen Edition as Primary Mockup Architecture | `Implemented` |

---

## 4. CẤU TRÚC THƯ MỤC MOCKUP

- [`mockup/index.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/index.html): **Mockup chính thức tương tác toàn diện** (mặc định mở Minimalist Zen Edition).
- [`mockup/parse_columns_mockup.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/parse_columns_mockup.html): File mockup gốc tham khảo độc lập.
- [`mockup/requirements.json`](file:///d:/Shared_UserData/Downloads/tad/mockup/requirements.json): Danh sách 24 yêu cầu kỹ thuật chi tiết (`REQ-MOCKUP-001` đến `REQ-MOCKUP-024`).
- [`mockup/README.md`](file:///d:/Shared_UserData/Downloads/tad/mockup/README.md): Tài liệu hướng dẫn và mô tả kiến trúc thiết kế.
