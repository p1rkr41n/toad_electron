# BẢN THIẾT KẾ GIAO DIỆN CHÍNH THỨC (MOCKUP) - TOAD COLUMN EXTRACTOR & FAST PARSER

> **Mục tiêu:** Giao diện bóc tách cột và trích xuất dữ liệu nhanh (Parse Columns & Regex) cho **Toad v2.0.9**, đồng bộ hóa 100% nguyên bản từ [`mockup/parse_columns_mockup.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/parse_columns_mockup.html) sang tệp mockup chính [`mockup/index.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/index.html), ngôn ngữ tiếng Anh chuẩn quốc tế, tối ưu hóa công thái học nhận thức (Zen Minimalist Edition).  
> **Tệp Mockup tương tác chính:** [`mockup/index.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/index.html)  
> **Tệp Mockup đối chiếu:** [`mockup/parse_columns_mockup.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/parse_columns_mockup.html)  
> **Tệp Đặc tả yêu cầu kỹ thuật:** [`mockup/requirements.json`](file:///d:/Shared_UserData/Downloads/tad/mockup/requirements.json) *(24 yêu cầu chi tiết REQ-MOCKUP-001 đến REQ-MOCKUP-024)*  
> **Phiên bản áp dụng:** Toad v2.0.9

---

## 1. MOCKUP CHÍNH: MINIMALIST (ZEN) EDITION (TOAD v2.0.9)

Phiên bản **Minimalist (Zen) Edition** giải quyết triệt để tình trạng phân mảnh ô nhập liệu (zero box-in-box clutter):

1. **Thanh Cấu hình Ngôn ngữ Tự nhiên (Natural Language Config Bar - `#minimalTopBar`)**:
   - Thay thế các khối thẻ rời rạc bằng 1 câu văn tự nhiên mạch lạc, dễ hiểu:  
     $$\text{Extract from [ Details ▾ ] using [ Key=Value ▾ ] split by [ ¦ ] and [ : ]}$$
   - Các cấu hình nâng cao (Header Prefix `:`, Header Column Name `log_header`, Quote Wrapper `" .. "`) được thu gọn tinh tế vào nút popover `[☵ Rules •]`.

2. **Hợp nhất Cột & Đổi tên Trực tiếp (Click-to-Rename Inline)**:
   - Hợp nhất cột `Key` và `New name` thành tiêu đề `Column` gọn gàng duy nhất (lược bỏ chữ `(Click to rename)` ở tiêu đề cột, vẫn giữ tính năng click đổi tên trực tiếp tại từng dòng).
   - Click trực tiếp vào tên cột: nhãn chuyển thành ô nhập liệu ngay tức thì, gõ tên mới rồi nhấn `Enter` hoặc click ra ngoài để lưu lại (hiển thị trực quan dạng `key → newName`).
   - Loại bỏ hoàn toàn hàng chục ô text input tĩnh dư thừa, giúp bảng dữ liệu thoáng đãng và giảm 70% nhiễu thị giác.

3. **Menu Chọn Kiểu Dữ liệu Tinh tế (Ghost Type Select) & Xóa Nhanh Khi Hover**:
   - Kiểu dữ liệu (`string`, `int64`, `float`, `bool`) sử dụng phong cách dropdown mờ phẳng (ghost selector), không viền thô kệch.
   - Tỉ lệ xuất hiện (Fill Rate) hiển thị dạng chấm màu trực quan (xanh lá ≥50%, cam <50%) kèm tỉ lệ %.
   - Khi rê chuột (hover) vào hàng, nút xóa nhanh `✕` xuất hiện mượt mà cho phép loại bỏ cột khỏi schema chỉ với 1 click.

4. **Thanh Công Cụ Trường Khám Phá Gom Trên 1 Dòng (Single-Line Toolbar)**:
   - Gom toàn bộ 5 thành phần điều khiển trên cùng 1 dòng ngang duy nhất (không rớt dòng): Tiêu đề `Discovered Fields (13)`, ô tìm kiếm `Search fields...`, nút lọc thông minh `⚡ ≥50% Rate`, nút thêm token vị trí `+ strX`, và cặp nút chọn nhanh `All` / `None`.

5. **Kiểm tra Trùng tên Cột Thời Gian Thực (Schema Guardrails)**:
   - Tự động phát hiện khi 2 cột có cùng tên định danh, hiển thị cảnh báo `⚠️ Duplicate column name detected` và tạm khóa nút `Apply` để ngăn ngừa lỗi cú pháp SQL.

6. **Nút Kiểm tra 1.000 Dòng Tích hợp Footer (Inline 1k-Row Verify)**:
   - Thu gọn khối Test 1.000 dòng cồng kềnh thành nút kiểm tra nhanh `▶ Verify 1k rows` ngay trên thanh Footer, hiển thị thời gian phản hồi siêu tốc (`< 15ms`).

7. **Nút Áp dụng Rõ ràng với Bộ đếm Cột (Apply Count Badge)**:
   - Nút `Apply (13)` tích hợp sẵn số lượng cột được chọn, mang lại sự tự tin tuyệt đối cho người dùng trước khi trích xuất.

---

## 2. BỘ CHUYỂN ĐỔI ĐA PHIÊN BẢN (MULTI-EDITION SWITCHER BAR)

Thanh điều khiển trên cùng của `mockup/index.html` cho phép xem và so sánh trực tiếp 3 biến thể thiết kế:

| Phiên bản | Biểu tượng | Mô tả đặc trưng |
| :--- | :---: | :--- |
| **Minimalist** *(Mặc định / Mockup chính)* | ◯ | Phong cách Zen tối giản, cấu hình ngôn ngữ tự nhiên, click-to-rename, độ rộng 680px. |
| **Google UX** | ✨ | Giao diện hiện đại lấy cảm hứng từ Google Cloud: bộ lọc thông minh `⚡ ≥50% Rate`, thanh tiến độ test 1.000 dòng. |
| **Original v2.0.9** | 🖥️ | Bản tái hiện nguyên bản 1:1 của hộp thoại Parse Columns v2.0.9 truyền thống. |

- **Hộp thoại Nghiên cứu Tình huống (UX Case Study Modal)**: Trình bày chi tiết 5 cải tiến lớn về trải nghiệm người dùng (`Natural Language Config Bar`, `Click-to-Rename`, `Smart Bulk Selection`, `Schema Guardrails`, `Apply Count Badge`).

---

## 3. DANH MỤC 24 ĐẶC TẢ KỸ THUẬT TRONG `requirements.json`

| ID | Danh mục | Tiêu đề đặc tả | Tình trạng |
| :--- | :--- | :--- | :---: |
| `REQ-MOCKUP-001` | Localization | Complete English UI Localization (Parse Columns v2.0.9) | `Implemented` |
| `REQ-MOCKUP-002` | Switcher | Design System View Bar & Multi-Edition Switcher | `Implemented` |
| `REQ-MOCKUP-003` | Layout | Minimalist Zen Container Layout & Proportions | `Implemented` |
| `REQ-MOCKUP-004` | Header | Top Header Bar with Split Icon & Visual vs Regex Segmented Switcher | `Implemented` |
| `REQ-MOCKUP-005` | Natural Language | Natural Language Extraction Config Bar (#minimalTopBar) | `Implemented` |
| `REQ-MOCKUP-006` | Popover | Advanced Extraction Rules Popover (#minimalRulesPopover) | `Implemented` |
| `REQ-MOCKUP-007` | Sample Event | Sample Event Editor with Line Gutter, 1 of 50 Cycler & 1-Click Copy | `Implemented` |
| `REQ-MOCKUP-008` | Classic Panels | Classic Source Column & Visual Config Panels (Google & Original) | `Implemented` |
| `REQ-MOCKUP-009` | Toolbar | Single-Line Discovered Fields Toolbar with Instant Column Search | `Implemented` |
| `REQ-MOCKUP-010` | Smart Filter | Smart Bulk Selection Filter (⚡ ≥50% Rate Pill) | `Implemented` |
| `REQ-MOCKUP-011` | Positional | Positional Field Extractor (+ + strX Button) | `Implemented` |
| `REQ-MOCKUP-012` | Sorting | Interactive Click-to-Sort Table Headers (Dual Minimal & Classic Headers) | `Implemented` |
| `REQ-MOCKUP-013` | Inline Renaming | Merged Column Typography with Inline Click-to-Rename Interaction | `Implemented` |
| `REQ-MOCKUP-014` | Type System | Ghost Type Selector & Native DuckDB Auto-Casting | `Implemented` |
| `REQ-MOCKUP-015` | Column Removal | Subtle Rate Indicator Dot & Hover-Reveal Column Deletion | `Implemented` |
| `REQ-MOCKUP-016` | Schema Safety | Real-Time SQL Schema Guardrails & Duplicate Name Detection | `Implemented` |
| `REQ-MOCKUP-017` | Validation | 1,000-Row Batch Verification (Inline Footer vs Classic Box) | `Implemented` |
| `REQ-MOCKUP-018` | SQL Preview | Collapsible Live DuckDB SQL Preview with Caret & 1-Click Copy | `Implemented` |
| `REQ-MOCKUP-019` | Action CTA | Action-Oriented Primary CTA with Column Count (Apply Badge) | `Implemented` |
| `REQ-MOCKUP-020` | Case Study | Google Cloud & Minimalist UX Case Study Modal | `Implemented` |
| `REQ-MOCKUP-021` | Feedback | Non-Blocking Toast Notification System (#toastNotice) | `Implemented` |
| `REQ-MOCKUP-022` | Sampling Pool | 50-Row Sample Event Simulation Pool | `Implemented` |
| `REQ-MOCKUP-023` | Data Model | 13 Discovered Fields Initial Data Model Matching Pixel-Perfect Spec | `Implemented` |
| `REQ-MOCKUP-024` | Scrollbar | Classic Desktop & Minimalist Zen Custom Scrollbars | `Implemented` |

---

## 4. CẤU TRÚC THƯ MỤC MOCKUP

- [`mockup/index.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/index.html): **Mockup chính thức tương tác toàn diện** (khớp 100% với `parse_columns_mockup.html`).
- [`mockup/parse_columns_mockup.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/parse_columns_mockup.html): Tệp mockup đối chiếu.
- [`mockup/requirements.json`](file:///d:/Shared_UserData/Downloads/tad/mockup/requirements.json): Danh sách 24 yêu cầu kỹ thuật chi tiết (`REQ-MOCKUP-001` đến `REQ-MOCKUP-024`).
- [`mockup/README.md`](file:///d:/Shared_UserData/Downloads/tad/mockup/README.md): Tài liệu hướng dẫn và mô tả kiến trúc thiết kế.
