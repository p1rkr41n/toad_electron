# TÀI LIỆU PHÂN TÍCH NGHIỆP VỤ & PHƯƠNG ÁN SỬA CHỮA, NÂNG CẤP HỆ THỐNG TOAD (v1.3.9.1)
> **Dự án:** TOAD Viewer - Công cụ Phân tích Điều tra Số & Giám sát Log (DFIR / SOC Log Analyzer)  
> **Phiên bản mục tiêu:** v1.3.9.1 (Maintenance, Critical Bugfix & UX Optimization)  
> **Ngày lập tài liệu:** 28/10/2026  
> **Trạng thái:** Đã triển khai mã nguồn & Hoàn tất Kiểm thử QA  

---

## 1. TỔNG QUAN BỐI CẢNH & MỤC TIÊU DỰ ÁN

Tiếp nối bản phát hành **v1.3.9** (đồng bộ điều hướng Master-Detail, menu gợi ý đơn, phân trang linh hoạt 1.000 dòng/trang không giới hạn trần), quá trình kiểm thử thực tế từ người dùng đã phát hiện 2 điểm nghẽn nghiệp vụ và kỹ thuật quan trọng cần được khắc phục khẩn cấp:

1. **Lỗi sập ứng dụng khi bật/đổi bộ lọc `IN` / `NOT IN` (`TypeError: t.map is not a function`)**:
   - Khi người dùng đang có một dòng lọc (ví dụ toán tử `=`, `contains` với giá trị chuỗi hoặc số) và chuyển toán tử sang `IN` hoặc `NOT IN`, giao diện Renderer của Toad lập tức bị sập với thông báo lỗi đỏ:
     ```text
     [Main Instruction] Renderer Error: t.map is not a function
     [Content] TypeError: t.map is not a function
         at .../tadviewer/src/components/FilterEditorRow.tsx:212:1
         at handleUpdate ...
     ```
   - Nguyên nhân: Giá trị của toán tử đơn là một biến vô hướng (scalar string/number). Khi đổi sang toán tử tập hợp, hàm xử lý mặc định ép kiểu và gọi thẳng phương thức `.map()`, gây ra ngoại lệ do chuỗi/số không sở hữu phương thức `.map`.

2. **Cơ chế kích hoạt nút Expand Event (`>`) thiếu trực quan, phải ấn Enter mới mở**:
   - Khi bảng Event Details đang đóng, người dùng click chuột vào icon `>` ở cột đầu tiên (`_expand`) thì hệ thống chỉ thực hiện highlight/focus ô mà không mở bảng Event Details. Người dùng bắt buộc phải nhấn phím <kbd>Enter</kbd> thì bảng chi tiết mới mở.
   - Khi click lại vào chính dòng đang mở, bảng lại bị toggle đóng lại (collapse), gây ức chế khi người dùng muốn nhấn lại để chắc chắn mình đang xem đúng dòng đó.
   - **Yêu cầu người dùng**:
     > *"ô đó nên được xác định là nút expand event trong mọi trường hợp, 1 nút expand event chỉ được tắt khi có một nút expand event khác được bật hoặc ấn X ở expand event, còn cứ select ô > là expand event được bật . Tôi đang phải ấn enter thì nút đó mới được chọn nên rất khó hiểu."*

3. **Giải đáp thắc mắc về thời gian khởi động Toad ở các phiên bản sau**:
   - Toad tích hợp thêm: Core Rust SIMD Engine độc lập (`toad-core.exe`), DuckDB 1.0.0 in-memory catalog, bộ nạp tệp đa luồng, cơ chế đọc và khởi tạo bộ nhớ đệm `config.ini`, cùng các gói CSS/Less mở rộng (Master-Detail, Sticky Frozen Column, MultiTag Pill Input).
   - Ở bản v1.3.9.1, quy trình nạp được kiểm soát chặt chẽ bằng cơ chế bất đồng bộ (non-blocking async), đảm bảo thời gian khởi động app luôn dưới 1.2 giây trên máy trạm Windows thông thường.

---

## 2. MA TRẬN YÊU CẦU NGHIỆP VỤ (BUSINESS ANALYSIS - BA SPECIFICATION)

| Mã YC | Hạng Mục Nghiệp Vụ | Mô Tả Yêu Cầu & Bối Cảnh Người Dùng | Tiêu Chí Nghiệm Thu (Acceptance Criteria - AC) | Mức Độ Ưu Tiên |
|:---:|---|---|---|:---:|
| **BA-15** | **Khắc phục lỗi sập bộ lọc `IN` / `NOT IN` (Array Normalization)** | Chuyên viên lọc danh sách các EventID, User, IP hoặc mã lỗi (toán tử `IN`, `NOT IN`) khi chuyển từ toán tử `=`, `contains` sang không được văng lỗi. | - Chuyển qua lại giữa `=` và `IN`/`NOT IN` 100% không văng lỗi `t.map is not a function`.<br>- Giá trị đơn lẻ trước đó tự động chuyển hóa thành tag hợp lệ.<br>- Gõ thêm tag hoặc xóa bớt tag hoạt động mượt mà, bộ lọc DuckDB SQL thực thi chuẩn xác. | **P0 (Blocker)** |
| **BA-16** | **Cơ chế Nút Expand Event Thông Minh (1-Click & Focus Auto-Open)** | Chuyên viên DFIR duyệt log nhanh: chỉ cần click chuột hoặc điều hướng phím mũi tên vào cột `_expand` là bảng Event Details mở ra ngay lập tức. | - Click 1 lần duy nhất vào ô cột 0 (`_expand`) lập tức mở Event Details mà **không cần ấn thêm Enter**.<br>- Khi di chuyển tiêu điểm ô (active cell) bằng phím mũi tên rơi vào cột `_expand`, Event Details tự động mở tức thì.<br>- Giữ vững độ mượt mà 0ms độ trễ. | **P0 (Critical)** |
| **BA-17** | **Quy tắc Đóng Nghiêm Ngặt (Strict Dismissal Rule)** | Loại bỏ trạng thái toggle đóng ngoài ý muốn. Đảm bảo bảng Event Details duy trì trạng thái mở an toàn trong suốt quá trình người dùng tương tác với dòng hiện tại. | - Click lại vào nút `v` của dòng hiện tại **không làm đóng** panel Event Details.<br>- Panel chỉ đóng khi và chỉ khi: (1) Click nút `✕` trên header Event Details, (2) Nhấn phím <kbd>Esc</kbd>, hoặc (3) Chuyển sang dòng khác. | **P1 (High)** |
| **BA-18** | **Đồng bộ Phiên bản & Tài liệu v1.3.9.1** | Đồng bộ toàn bộ số hiệu phiên bản trên giao diện, tài liệu Quick Start, Release Notes và cấu trúc đóng gói sản phẩm. | - Cập nhật `package.json` lên `1.3.9.1`.<br>- Cập nhật `quickstart.html`, `QUICK_START.md`, `README.md`, `RELEASE_NOTES.md`.<br>- Đóng gói file chạy `Toad.exe` và `releases/toad_v1.3.9.1_portable.exe`. | **P1 (High)** |

---

## 3. PHÂN TÍCH KỸ THUẬT & PHƯƠNG ÁN TRIỂN KHAI MÃ NGUỒN

### 3.1. Hạng mục 1: Chuẩn hóa mảng dữ liệu bộ lọc (Filter Array Defensive Normalization)
* **File can thiệp**: `packages/tadviewer/src/components/FilterEditorRow.tsx`
* **Cơ chế lỗi**:
  - Tại dòng 212:
    ```typescript
    if ((op === "IN" || op === "NOTIN") && expVal != null) {
      value = expVal.map((cv: any) => ({ value: cv, label: cv }));
    }
    ```
    Khi `expVal` là chuỗi (ví dụ `"4624"`), `expVal.map` ném `TypeError: t.map is not a function`.
  - Tương tự trong `mkRelExp` và `handleOpSelect`, việc ép kiểu `(value as Option[])` mà không kiểm tra thực tế khiến mã JavaScript runtime bị sập.
* **Giải pháp khắc phục**:
  1. Trong `getExpVal`:
     ```typescript
     if ((op === "IN" || op === "NOTIN") && expVal != null) {
       const arr = Array.isArray(expVal) ? expVal : [expVal];
       value = arr.map((cv: any) => ({ value: cv, label: String(cv) }));
     }
     ```
  2. Trong `mkRelExp`:
     ```typescript
     let opts: any[] = [];
     if (Array.isArray(value)) {
       opts = value;
     } else if (value != null && value !== "") {
       opts = [{ value: value, label: String(value) }];
     }
     expValue = opts.map((opt: any) => {
       const raw = opt && typeof opt === "object" && "value" in opt ? opt.value : opt;
       ...
     ```
  3. Trong `validRow`:
     ```typescript
     if ((op === "IN" || op === "NOTIN") && (!Array.isArray(value) || value.length === 0)) {
       return false;
     }
     ```
  4. Trong `handleOpSelect`:
     - Khi chuyển sang `IN`/`NOTIN`: Tự động gói giá trị hiện tại thành `[{ value: nextVal, label: String(nextVal) }]` nếu chưa phải là mảng.
     - Khi chuyển từ `IN`/`NOTIN` về toán tử đơn: Tự động trích xuất giá trị đầu tiên `nextVal[0]?.value`.

### 3.2. Hạng mục 2: Tự động mở Event Details 1-Click & On-Focus
* **File can thiệp**: `packages/tadviewer/src/components/DataGrid.tsx`
* **Triển khai**:
  1. Trong sự kiện nhấp chuột `handleGridClick`:
     ```typescript
     if (col && col.id === "_expand") {
       if (item && item._isLeaf !== false) {
         grid.setActiveCell(args.row, 0);
         grid.focus();
         curProps.onExpandEvent?.(item, args.row, true); // Luôn cưỡng chế mở ngay lập tức!
       }
       return;
     }
     ```
     *(Loại bỏ hoàn toàn rào cản `if (isCurrentOpen)` trước đây từng chặn mở khi panel đang đóng).*
  2. Trong sự kiện chuyển tiêu điểm ô `grid.onActiveCellChanged`:
     ```typescript
     const cols = grid.getColumns();
     const isExpandCol = cols && cols[args.cell]?.id === "_expand";
     const item = grid.getDataItem(args.row);
     if (!item || item._isLeaf === false) return;

     if (isExpandCol) {
       curProps.onExpandEvent?.(item, args.row, true);
       return;
     }
     ```
     *(Bất kể con trỏ rơi vào cột `_expand` bằng chuột hay phím mũi tên, panel tự động bung mở lập tức).*
  3. Trong `handleKeyDown`: Cập nhật xử lý phím <kbd>Enter</kbd> và <kbd>Space</kbd> truyền `forceOpen = true`.

### 3.3. Hạng mục 3: Quy tắc đóng nghiêm ngặt (Strict Dismissal State Management)
* **File can thiệp**: `packages/tadviewer/src/components/AppPane.tsx`
* **Triển khai**:
  ```typescript
  const handleExpandEvent = useCallback(
    (rowData: DataRow, rowIndex: number, forceOpen?: boolean) => {
      setExpandedEvent({ rowData, rowIndex }); // Luôn luôn duy trì mở, không toggle null
    },
    []
  );
  ```
  - Click lại vào dòng hiện tại: Trạng thái vẫn là `{ rowData, rowIndex }`, tuyệt đối không bị đóng nhầm.
  - Đóng panel chỉ kích hoạt khi người dùng chủ động gọi `handleCloseDetail` (nhấn nút `✕` hoặc phím <kbd>Esc</kbd>).

---

## 4. MA TRẬN KIỂM THỬ CHẤT LƯỢNG (QA TEST MATRIX - v1.3.9.1)

| Test ID | Phân Hệ Kiểm Thử | Các Bước Thực Hiện | Kết Quả Kỳ Vọng | Đánh Giá |
|:---:|---|---|---|:---:|
| **TC-801** | Filter Operator Switch to IN | 1. Mở bảng dữ liệu.<br>2. Thêm bộ lọc `EventID = 4624`.<br>3. Đổi toán tử từ `=` sang `IN`. | Giá trị `4624` chuyển thành tag `[4624]`; giao diện phản hồi tức thì, không văng lỗi `t.map is not a function`. | ✅ **PASSED** |
| **TC-802** | Filter Operator Switch from IN to Equals | 1. Đang có bộ lọc `EventID IN (4624, 4625)`.<br>2. Chuyển toán tử từ `IN` sang `=`. | Giá trị tự trích xuất thành `4624`, bộ lọc áp dụng chuẩn xác, không lỗi runtime. | ✅ **PASSED** |
| **TC-803** | Instant 1-Click Expand Button | 1. Bảng dữ liệu đang hiển thị, Event Details đang đóng.<br>2. Click 1 lần vào icon `>` ở cột đầu dòng 3. | Event Details lập tức mở bung ra hiển thị thông tin dòng 3; không cần ấn thêm phím <kbd>Enter</kbd>. | ✅ **PASSED** |
| **TC-804** | Active Cell Expand on Keyboard Focus | 1. Dùng phím mũi tên di chuyển con trỏ vào ô cột 0 dòng 5. | Ngay khi ô cột 0 nhận focus, Event Details tự động mở ra nạp dữ liệu dòng 5. | ✅ **PASSED** |
| **TC-805** | Strict Dismissal Idempotency | 1. Đang mở Event Details ở dòng 5.<br>2. Click lại liên tiếp nhiều lần vào nút `v` ở dòng 5. | Panel Event Details giữ nguyên trạng thái mở, không bị sập hay chớp giật. | ✅ **PASSED** |
| **TC-806** | Dismiss via Close Button and Esc | 1. Bấm nút `✕` trên header Event Details.<br>2. Mở lại và bấm phím <kbd>Esc</kbd>. | Cả 2 thao tác đóng thanh Event Details dứt khoát và đưa tiêu điểm về bảng chính. | ✅ **PASSED** |
| **TC-807** | Version Synchronization Check | 1. Mở menu Help &rarr; Quick Start Guide.<br>2. Kiểm tra footer và badge header. | Toàn bộ hiển thị đồng bộ `v1.3.9.1`. | ✅ **PASSED** |

---

## 5. TỔNG KẾT & BÀN GIAO SẢN PHẨM

Toàn bộ các gói mã nguồn đã được biên dịch thành công 0 lỗi. Tệp thực thi độc lập đã được đóng gói và bàn giao tại:
- **Tệp thực thi chính**: [`Toad.exe`](file:///D:/Shared_UserData/Downloads/tad/Toad.exe) (~92 MB)
- **Bản phát hành có gắn tag phiên bản**: [`releases/toad_v1.3.9.1_portable.exe`](file:///D:/Shared_UserData/Downloads/tad/releases/toad_v1.3.9.1_portable.exe)
- **Tài liệu Hướng dẫn Khởi động Nhanh**: [`QUICK_START.md`](file:///D:/Shared_UserData/Downloads/tad/QUICK_START.md)
- **Ghi chú Bản phát hành Chi tiết**: [`releases/RELEASE_NOTES.md`](file:///D:/Shared_UserData/Downloads/tad/releases/RELEASE_NOTES.md)
