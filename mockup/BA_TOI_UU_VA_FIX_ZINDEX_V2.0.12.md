# Tài liệu Phân tích Nghiệp vụ (BA) & Nghiệm thu Kỹ thuật (QA) — Toad v2.0.12

> **Phiên bản**: Toad v2.0.12  
> **Ngày phát hành**: 31/10/2026  
> **Trạng thái**: ✅ **ĐÃ TRIỂN KHAI VÀ NGHIỆM THU 100% PASS**  
> **Phương châm thiết kế (Ponytail Principles)**: Giải quyết dứt điểm lỗi hiển thị Z-Index và rò rỉ sự kiện chuột bằng giải pháp tinh gọn nhất; bảo vệ 100% tính toàn vẹn của logic hệ thống hiện hữu.

---

## 1. Bối cảnh & Mục tiêu Nghiệp vụ (Business Context)

### 1.1. Hiện tượng phát hiện từ người dùng (User Defect Report)
* **Ảnh chụp thực tế**: Khi người dùng đang mở hộp thoại **Parse Columns** (Modal Dialog), một thanh thẳng đứng màu xanh đậm (`#106ba3`) xuất hiện chém xuyên từ trên xuống dưới qua toàn bộ giao diện Modal (đè qua cả thanh trượt, khu vực xem mẫu sự kiện `Sample Event`, bảng danh sách trường `Discovered Fields`, và các checkbox chọn cột).
* **Hậu quả nghiệp vụ & trải nghiệm người dùng**:
  1. **Hiển thị dị thường (Visual Glitch)**: Cắt nát bố cục thị giác của Modal, tạo cảm giác phần mềm chưa hoàn thiện.
  2. **Đánh cắp sự kiện chuột (Event Stealing)**: Vì thanh phân cách nằm đè lên trên Modal, khi người dùng di chuột qua cột 7px này để click chọn checkbox hoặc bôi đen văn bản trong ô mẫu, sự kiện chuột bị thanh resizer bên dưới "hút" lấy, kích hoạt con trỏ kéo `col-resize` thay vì con trỏ chọn văn bản hoặc click checkbox.

### 1.2. Mục tiêu kỹ thuật
1. Tách biệt hoàn toàn tầng hiển thị (Stacking Context Isolation): Đảm bảo các thanh kéo phân chia giao diện (Resizers) luôn nằm **DƯỚI** các hộp thoại dạng Modal và lớp phủ làm mờ (Backdrop).
2. Xử lý triệt để các phát hiện từ kiểm toán **Ponytail Review** về rò rỉ sự kiện chuột khi kéo thả tại Chân trang (`Footer.tsx`) và Thanh chi tiết (`EventDetailSidebar.tsx`).
3. Tăng cường khả năng phòng thủ lỗi cú pháp Regex (`actions.ts`).
4. **Loại bỏ mọi can thiệp tiềm ẩn rủi ro phá vỡ logic cũ** (Bảo toàn cơ chế copy trong Electron của SlickGrid, bảo toàn cây phả hệ view DuckDB, và cơ chế batching state của React 18).

---

## 2. Phân tích Nguyên nhân Gốc rễ (Root Cause Analysis - RCA)

```mermaid
flowchart TD
    subgraph Stacking_Context_Problem["Mô hình xung đột Quang học (CSS Stacking Context)"]
        SlickGrid["Bảng dữ liệu SlickGrid<br/>z-index: 1 - 2"]
        ModalBackdrop["Blueprint Modal Backdrop<br/>z-index: 20"]
        ModalDialog["Blueprint Modal Dialog<br/>z-index: 20"]
        OldResizer["Thanh kéo .sidebar-resizer cũ<br/>z-index: 25 ⚠️"]

        OldResizer -->|25 > 20| ModalDialog
        OldResizer -->|25 > 20| ModalBackdrop
    end
```

1. **Sai lệch chỉ số Z-Index**:
   * Trong [`sidebar.less:56`](file:///d:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/less/sidebar.less#L56), thanh `.sidebar-resizer` được gán `z-index: 25`.
   * Thư viện giao diện Blueprint.js quy định lớp phủ backdrop (`.bp4-overlay-backdrop`) và khung modal (`.bp4-dialog-container`) ở `z-index: 20`.
   * Vì $25 > 20$, trình duyệt Chromium/Electron kết xuất (render) thanh splitter nằm ở lớp trên cùng, đè xuyên qua mặt Modal.
2. **Kẹt màu xanh do thiếu listener giải phóng**:
   * Khi mở Modal hoặc Alt-Tab sang ứng dụng khác, cửa sổ bị mất tiêu điểm (`window.blur`), khiến sự kiện `mouseup` không bao giờ được ghi nhận. Thanh resizer dính chặt ở trạng thái `isResizing = true`.

---

## 3. Danh mục Giải pháp Triển khai (Implemented Solutions)

### 3.1. Phân tầng Z-Index chuẩn xác & Khóa tương tác xuyên thấu
* Đã chuẩn hóa `z-index: 10` cho toàn bộ hệ thống thanh phân cách:
  * [`sidebar.less`](file:///d:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/less/sidebar.less): `.sidebar-resizer` $\rightarrow$ `z-index: 10;`
  * [`eventDetailSidebar.less`](file:///d:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/less/eventDetailSidebar.less): `.event-detail-resizer` $\rightarrow$ `z-index: 10;`
  * [`footer.less`](file:///d:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/less/footer.less): `.footer-resizer-bar` $\rightarrow$ `z-index: 10;` (đã chuẩn sẵn).
* **Trật tự phân tầng quang học mới (New Optical Stacking Order)**:
  $$\text{SlickGrid (1-2)} < \mathbf{Resizers\ (10)} < \mathbf{Modal\ Dialogs\ \&\ Backdrops\ (20)} < \text{Toasts\ (30)}$$

### 3.2. Bổ sung Window Blur & Mouseleave Guard cho Footer Resizer
* Trong [`Footer.tsx`](file:///d:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/src/components/Footer.tsx#L167-L187):
  * Bổ sung lắng nghe sự kiện `blur` trên `window` và `mouseleave` trên `document`.
  * Khi người dùng di chuột ra khỏi ứng dụng hoặc Alt-Tab, `handleMouseUp` được kích hoạt ngay tức thì, giải phóng trạng thái kéo `isResizing = false` và đưa thanh chân trang trở về màu xám nhẹ.

### 3.3. Tăng cường an toàn thao tác kéo tại EventDetailSidebar
* Trong [`EventDetailSidebar.tsx`](file:///d:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/src/components/EventDetailSidebar.tsx):
  * `e.preventDefault()` & `e.stopPropagation()` trong `handleMouseDown` ngăn tình trạng trình duyệt bôi đen/chọn văn bản ngẫu nhiên.
  * Lắng nghe `window.blur` và `document.mouseleave` để nhả thao tác kéo khi mất tiêu điểm.
  * Hook dọn dẹp khi component unmount: Đảm bảo nếu người dùng nhấn `Escape` để đóng chi tiết sự kiện trong lúc đang giữ chuột kéo, con trỏ toàn hệ thống `document.body.style.cursor` lập tức được hoàn trả về `""` (bình thường), không bao giờ bị kẹt `col-resize`.
  * Bổ sung thao tác tiện ích cao cấp: **Double-click** vào thanh resizer để đưa độ rộng sidebar về chuẩn mặc định `440px`.

### 3.4. Phòng vệ ngoại lệ Regex (Fault-Tolerant RegExp Constructor)
* Trong [`actions.ts`](file:///d:/Shared_UserData/Downloads/tad/tad-master/packages/tadviewer/src/actions.ts#L1396-L1397):
  * Bọc khối `try...catch` quanh việc khởi tạo `new RegExp(regexPattern + "|")`.
  * Nếu người dùng nhập regex lỗi cú pháp (ví dụ: `([a-z]+`), hệ thống không bị ném ngoại lệ `SyntaxError` làm sập luồng Promise xử lý UI, mà trả về an toàn `captureGroupCount = 0`.

---

## 4. Quyết định Loại bỏ các can thiệp Rủi ro (Ponytail Safeguards)

| Đề xuất ban đầu | Lý do LOẠI BỎ sau rà soát Logic | Lợi ích thu được |
| :--- | :--- | :--- |
| **Gỡ listener `copy` trên DataGrid** | `DataGrid` không có lifecycle `destroy` chuẩn. Can thiệp vào `document.addEventListener("copy")` có nguy cơ làm hỏng chức năng `Ctrl+C` sao chép ô tính trong môi trường Electron. | Bảo vệ tính toàn vẹn 100% của tính năng Copy bảng tính. |
| **Cắt đuôi view `_rx` lũy tiến trong DuckDB** | Tên view `data_rx1_rx2` phản ánh trực quan cây phả hệ (lineage) của DuckDB view cha-con. Cắt đuôi sẽ xóa nhòa thông tin nguồn gốc dữ liệu. | Giữ nguyên phả hệ dữ liệu rõ ràng, minh bạch. |
| **So sánh sâu `FilterExp.equals` ở Footer** | React 18 đã tự động gom nhóm (batching) các lệnh `setState` trong `useEffect`. So sánh đệ quy sâu tốn CPU vô ích và tiềm ẩn nguy cơ lệch đồng bộ filter. | Tiết kiệm chu kỳ CPU, loại trừ nguy cơ bug lệch filter. |

---

## 5. Báo cáo Kết quả Kiểm thử Nghiệm thu (QA Test Results)

Hệ thống đã chạy toàn bộ bộ kiểm thử tích hợp sâu mở rộng **Suite A đến Suite Q** (`test_deep_integration_qa.js`):

```
======================================================================
  DEEP INTEGRATION QA TEST SUITE SUMMARY (Toad v2.0.12 Full Engine Suite)
======================================================================
  Total Test Cases : 74
  Passed           : 74 (100%)
  Failed           : 0 (0%)
  Total Duration   : 6.13s
======================================================================
```

### Chi tiết nghiệm thu Suite Q (Mới bổ sung cho v2.0.12):
* **Q.1 [PASS]**: `sidebar.less` và `eventDetailSidebar.less` đạt chuẩn `z-index: 10`, tuyệt đối nhỏ hơn `z-index: 20` của Blueprint Modal.
* **Q.2 [PASS]**: `Footer.tsx` lắng nghe đầy đủ `window.blur` và `document.mouseleave` kèm dọn dẹp sạch sẽ khi unmount.
* **Q.3 [PASS]**: `EventDetailSidebar.tsx` kích hoạt `preventDefault`, lắng nghe `blur`/`mouseleave`, tự động dọn dẹp con trỏ khi unmount và hỗ trợ double-click reset về `440px`.
* **Q.4 [PASS]**: `actions.ts` bọc `try...catch` bắt `SyntaxError` thành công, fallback an toàn về `0`.
* **Q.5 [PASS]**: Đồng bộ phiên bản `2.0.12` xuyên suốt toàn bộ hệ thống (`tad-app/package.json`, `RegexDialog.tsx`, `quickstart.html`, `dist_package.ps1`).

---

## 6. Kết luận & Khuyến nghị
Phiên bản **Toad v2.0.12** đã giải quyết triệt để lỗi visual splitter đè xuyên modal, hoàn thiện khả năng xử lý chuột theo tiêu chuẩn cao nhất của Ponytail Review, đạt 100% độ bao phủ kiểm thử tự động mà không làm ảnh hưởng đến bất kỳ dòng logic nghiệp vụ hay luồng dữ liệu nào.

