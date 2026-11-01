# PHƯƠNG ÁN TRIỂN KHAI HỆ THỐNG NATIVE DARK MODE TOÀN DIỆN (TOAD V2.1)
## NÂNG TẦM TRẢI NGHIỆM THỊ GIÁC, TỐI ƯU HIỂN THỊ LOG CHUYÊN SÂU & GIẢM KÍCH THƯỚC PHẦN MỀM

> **Mục tiêu phiên bản:** Toad v2.1 (Major UI/UX Milestone)  
> **Thời gian lập kế hoạch:** 31/10/2026  
> **Trạng thái:** Bản thiết kế kiến trúc chi tiết (Chờ phê duyệt trước khi lập trình)

---

## I. TỔNG QUAN KIẾN TRÚC & ĐỘT PHÁ CÔNG NGHỆ

### 1. Hiện trạng v2.0.14: Bộ lọc đảo màu toàn cục (CSS Inversion Filter)
Hiện nay, Dark Mode của Toad (Dracula theme) được kích hoạt tại `tadviewer.less:242` bằng:
```css
html.theme-dracula {
  filter: invert(0.88) hue-rotate(120deg) contrast(1.02);
  background-color: #282a36 !important;
}
```
* **Ưu điểm trước đây:** Triển khai nhanh trong 1 dòng lệnh CSS, không phải viết lại style từng component.
* **Nhược điểm nghiêm trọng khi ứng dụng mở rộng:**
  1. **Mất độ sắc nét của chữ (Blurry Text):** Chromium vô hiệu hóa công nghệ làm mịn chữ Subpixel RGB (ClearType) trên toàn bộ layer có `filter`, khiến văn bản trên màn hình độ phân giải thông thường bị nhòe nhẹ.
  2. **Biến dạng màu sắc:** Các màu sắc không được kiểm soát. Màu nâu hổ phách (`#b45309`) của tiền tố cột `str` bị ép biến thành màu hồng cánh sen neon chói mắt (`#ec4899`).
  3. **Bẫy bảo trì (Counter-Invert Trap):** Mọi hình ảnh, biểu đồ canvas đều phải viết CSS "đảo ngược của đảo ngược" (`filter: invert(1) hue-rotate(240deg)`).
  4. **Nén dải tương phản:** `invert(0.88)` làm mất màu đen sâu (`#000000`), giao diện bị phủ một lớp sương xám đục.

---

### 2. Kiến trúc mục tiêu v2.1: Native Semantic Dark Mode
Chuyển đổi hoàn toàn sang **Native Dark Mode chuẩn công nghiệp** (tương tự kiến trúc của VS Code, GitHub Desktop và Linear):
* **Bỏ hoàn toàn** `filter: invert(...)`.
* **Khai thác hệ thống biến màu CSS (CSS Custom Properties / Design Tokens)**: Một bộ token duy nhất cho toàn bộ hệ thống, tự động đổi giá trị theo class `.toad-dark` và `.bp4-dark`.
* **Tận dụng tối đa BlueprintJS Dark Theme:** BlueprintJS đã có sẵn class `.bp4-dark` được tối ưu hóa cho tất cả Dialog, Button, Dropdown, Menu, Popover.
* **Chi phí kích thước:** Chỉ bổ sung khoảng **~4 KB mã nguồn CSS/TS** (sau khi nén chiếm chưa tới **0.003%** của file cài đặt). Không thêm bất kỳ thư viện ngoài nào!

---

## II. BẢNG MÃ MÀU THIẾT KẾ (SEMANTIC DESIGN TOKEN MATRIX)

| Token Name | Light Mode Value | Native Dark Mode Value (v2.1) | Mục đích sử dụng |
| :--- | :--- | :--- | :--- |
| `--toad-bg-canvas` | `#f8fafc` (Slate 50) | `#0b0f19` (Deep Slate Black) | Nền tổng thể cửa sổ ứng dụng |
| `--toad-bg-surface` | `#ffffff` (Pure White) | `#151c2c` (Navy Charcoal) | Nền của Modal, Sidebar, Card |
| `--toad-bg-surface-raised`| `#f1f5f9` (Slate 100) | `#1e293b` (Slate 800) | Nền của ô input, table row, dropdown |
| `--toad-border-subtle` | `#e2e8f0` (Slate 200) | `#243048` (Slate Muted) | Đường kẻ ngăn cách bảng, divider |
| `--toad-border-strong` | `#cbd5e1` (Slate 300) | `#3b4a6b` (Slate Accent) | Viền ô input đang focus, border modal |
| `--toad-text-primary` | `#0f172a` (Slate 900) | `#f8fafc` (Slate 50) | Tiêu đề, dữ liệu bảng chính |
| `--toad-text-secondary` | `#475569` (Slate 600) | `#94a3b8` (Slate 400) | Nhãn thuộc tính, thông số phụ |
| `--toad-text-muted` | `#94a3b8` (Slate 400) | `#64748b` (Slate 500) | Placeholder, watermark |
| `--toad-col-auto-str` | `#b45309` (Amber 700) | `#fbbf24` (Amber Gold 400) | **Tiền tố cột `str001`, `str002`** (dịu mắt) |
| `--toad-accent-brand` | `#0284c7` (Sky Blue) | `#38bdf8` (Electric Cyan) | Header icon, link, tab đang chọn |
| `--toad-accent-success` | `#10b981` (Emerald 500)| `#10b981` (Emerald Glow) | Nút Apply, chỉ số fill rate cao $\ge 80\%$ |
| `--toad-accent-warning` | `#f59e0b` (Amber 500) | `#f59e0b` (Warm Amber) | Fill rate trung bình $40-79\%$ |
| `--toad-accent-sparse` | `#cbd5e1` (Slate 300) | `#64748b` (Muted Slate) | Fill rate thưa thớt $<40\%$ |

---

## III. 5 BƯỚC TRIỂN KHAI KỸ THUẬT CHI TIẾT CHO V2.1

### Bước 1: Nâng cấp Theme Controller (`toadTheme.ts`)
* **Xóa bỏ filter đảo màu:** Loại bỏ rule `filter: invert(0.88)` trong `tadviewer.less`.
* **Cập nhật hàm `applyTheme`:**
  Kích hoạt đồng thời `.toad-dark` và `.bp4-dark` trên cả `<html>` và `<body>`.
* **Bổ sung Auto-Detect OS Theme:** Tự động kích hoạt dark theme theo hệ điều hành người dùng.

---

### Bước 2: Chuẩn hóa Modal Trích xuất Cột (`RegexDialog.tsx`)

#### 1. Triệt tiêu gạch chân chính tả đỏ/tím (Disable Spellcheck)
* Thêm thuộc tính `spellCheck={false}` và `autoCorrect="off"` vào thẻ `<textarea>` hiển thị log mẫu.
* Đặt `resize: "none"` để cố định layout modal.
* **Hiệu quả:** Xóa sạch 100% các đường lượn sóng màu tím gây nhiễu loạn thị giác.

#### 2. Đổi màu hiển thị tiền tố cột `str001` sang Vàng Hổ Phách dịu mắt
* Sử dụng biến `var(--toad-col-auto-str, #fbbf24)`.
* **Hiệu quả:** Không còn màu hồng cánh sen neon chói mắt; `str001` hiển thị bằng màu vàng hoàng yến êm dịu.

#### 3. Nâng cấp cột Fill Rate thành Mini Progress Bar 3 mức
* Thay dấu chấm tròn bằng **thanh tiến trình siêu nhỏ 40px** có phân tầng màu:
  - $\ge 80\%$: Xanh lục bảo (Emerald `#10b981`).
  - $40\% - 79\%$: Vàng cam (Amber `#f59e0b`).
  - $< 40\%$: Xám khói (Slate `#64748b`).

#### 4. Phân tách cụm thao tác & Nút Xóa
* Tách `[ + Column ]` ra độc lập với viền nét đứt.
* Gom `[ All | None ]` thành cụm segmented pill nhỏ gọn.
* Cải thiện icon xóa `✕`: Khi hover chuyển sang màu đỏ nhạt (`hover: #ef4444`).

#### 5. Nâng cấp Footer
* Nút `Cancel`: Dạng Ghost button viền mờ `border: 1px solid rgba(255,255,255,0.15)`.
* Nút `Apply`: Bổ sung hiệu ứng hào quang xanh ngọc `box-shadow: 0 0 16px rgba(16, 185, 129, 0.35)`.

---

### Bước 3: Chuẩn hóa Bảng Dữ liệu Chính (SlickGrid Dark Theme)
Tại `slickgrid.scss`:
* **Header cột (`.slick-header-column`):** Nền `#151c2c`, viền ngăn cách `#243048`, chữ trắng `#f8fafc`.
* **Zebra Striping:** Hàng chẵn `#0b0f19`, hàng lẻ `#101624`.
* **Thanh cuộn siêu mảnh (Custom Dark Scrollbars):** Rộng 6px màu xám mờ `#334155`.

---

### Bước 4: Tối ưu kích thước phần mềm (Giảm từ 97MB xuống ~85MB)
Cấu hình trong `tad-app/package.json`:
* **Locales Pruning (`electronLanguages`):** Chỉ giữ lại `en-US` và `vi`, loại bỏ hơn 48 file `.pak` thừa. Tiết kiệm ngay **~20 MB giải nén (~5 MB nén .exe)**.
* **Loại bỏ dữ liệu mẫu cũ:** Xóa file `resources/examples/movie_metadata.csv` (~1.43 MB).
* **Kết quả dự kiến:** File `Toad 2.1.exe` giảm xuống khoảng **~85 MB**!

---

### Bước 5: Bộ kiểm thử tự động QA (Suite T - Native Dark Mode Integrity)
Thêm **Suite T** vào `test_deep_integration_qa.js`:
- Kiểm tra biến màu CSS khai báo đầy đủ.
- Đảm bảo `tadviewer.less` không còn `filter: invert(...)`.
- Kiểm tra `RegexDialog.tsx` có `spellCheck={false}`.
- Kiểm tra logic 3 phân tầng màu của Fill Rate.
- Kiểm tra kích thước nhị phân đóng gói $\le 90\text{ MB}$.

