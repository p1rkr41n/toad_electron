# BẢN THIẾT KẾ GIAO DIỆN MỚI (MOCKUP REDESIGN) - TOAD COLUMN EXTRACTOR

> **Mục tiêu:** Tái thiết kế toàn diện giao diện bóc tách cột (Regex & Simple Extractor) từ phong cách "kỹ thuật, rối rắm" sang phong cách **"Hiện đại, Tối giản, Trực quan cao cấp" (Modern Linear / Raycast Aesthetic)**.  
> **Tệp Mockup tương tác:** [`mockup/index.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/index.html)  
> **Phiên bản áp dụng:** Toad v2.0.2

---

## 1. PHÂN TÍCH NHỮNG ĐIỂM YẾU CỦA GIAO DIỆN CŨ (PAIN POINTS)

| Vấn đề của UI cũ | Tác động người dùng | Giải pháp thiết kế mới trong Mockup |
|---|---|---|
| **Bố cục 1 cột dọc quá dài (Vertical Clutter)** | Người dùng phải cuộn chuột liên tục để tìm chỗ sửa tên cột, các nút bị dồn ứ. | **Bố cục 2 cột (Split-View 5:7)**: Cột trái cấu hình dữ liệu nguồn, cột phải hiển thị danh sách cột trực quan không cần cuộn trang. |
| **Quá nhiều tùy chọn kỹ thuật đập vào mắt** | 5 nút radio, dropdown ký tự, checkbox trim, gộp space... xuất hiện cùng lúc gây choáng ngợp. | **Auto-Detection (Nhận diện thông minh)**: Tự động phát hiện JSON/KV/CSV từ dòng mẫu. Các tùy chọn chi tiết được thu gọn vào accordion **"Tùy chỉnh bổ sung"** chỉ mở khi cần. |
| **Bảng trích xuất cứng nhắc (Clunky Table)** | Dùng thẻ `<table>` truyền thống với viền xám thô, ô input nhỏ, khó quan sát trên màn hình tối. | **Thẻ cột hiện đại (Card-Based Column Items)**: Từng trường được trình bày dạng thẻ bo tròn tinh tế: `[ Mã nguồn ] → [ Tên cột mới gõ tùy ý ] [ Giá trị mẫu ] [ Xóa ]`. |
| **Thiếu xem trước câu lệnh SQL** | Người dùng chuyên sâu (SOC/DFIR) không biết Toad sẽ sinh lệnh gì bên dưới DuckDB. | **Live SQL Preview**: Hộp xem trước câu lệnh DuckDB `CREATE VIEW` thời gian thực (có thể mở/đóng bằng 1 click). |
| **Thiếu bộ dữ liệu mẫu thử nghiệm** | Người dùng phải tự gõ hoặc copy chuỗi dài vào để test regex. | **Quick Presets Bar**: Có sẵn các nút mẫu thực tế (`Firewall KV`, `JSON Object`, `CSV Quotes`, `Syslog Space`, `JSON Array`) để thử nghiệm tức thì. |

---

## 2. CÁC ĐIỂM NỔI BẬT TRONG MOCKUP MỚI

1. **Auto-Detect Badge thông minh (✨)**:
   - Khi dòng mẫu là `src=1.1.1.1 dst=2.2.2.2`, hệ thống tự bật badge `Auto-detect: Key-Value Log`.
   - Khi dòng mẫu là `{"user": "admin"}`, tự chuyển sang `Auto-detect: JSON Object`.
2. **Bộ chuyển đổi chế độ Segmented Pill**:
   - `[ ⚡ Trực quan (Simple) ]` và `[ 🛠️ Regex (Nâng cao) ]` chuyển đổi mượt mà.
3. **Thao tác nhanh trên danh sách cột**:
   - Tích chọn / bỏ chọn tức thì từng cột.
   - Nút `Chọn tất cả` / `Bỏ chọn`.
   - Nút `+ Thêm cột` cho phép bổ sung trường thủ công khi dòng mẫu bị thiếu.
4. **Phối màu & Typography**:
   - Theme Dark Slate cao cấp (`#020617` / `#0f172a`), điểm nhấn Indigo/Emerald rực rỡ, độ tương phản cao, phông chữ `JetBrains Mono` cho dữ liệu mã.

---

## 3. CÁCH XEM VÀ TRẢI NGHIỆM MOCKUP

1. **Mở trực tiếp trên trình duyệt Web (Chrome, Edge, Firefox)**:
   - Mở tệp: [`d:\Shared_UserData\Downloads\tad\mockup\index.html`](file:///d:/Shared_UserData/Downloads/tad/mockup/index.html)
   - Có thể click vào các nút mẫu thử (`Firewall KV`, `JSON Event`...), gõ thử đổi tên cột, bật tắt checkbox, mở xem câu lệnh SQL sinh ra.
2. **Xem trực tiếp trong Antigravity**:
   - Xem qua artifact HTML được nhúng trong khung trao đổi.

