# TÀI LIỆU PHÂN TÍCH NGHIỆP VỤ & PHƯƠNG ÁN SỬA CHỮA, NÂNG CẤP HỆ THỐNG TOAD (v1.3.9)
> **Dự án:** TOAD Viewer - Công cụ Phân tích Điều tra Số & Giám sát Log (DFIR / SOC Log Analyzer)  
> **Phiên bản mục tiêu:** v1.3.9 (Feature Polish & Production Release)  
> **Ngày lập tài liệu:** 28/10/2026  
> **Trạng thái:** Đã triển khai mã nguồn & Hoàn tất Kiểm thử QA  

---

## 1. TỔNG QUAN BỐI CẢNH & MỤC TIÊU DỰ ÁN

Sau các đợt kiểm thử thực địa trên tập dữ liệu lớn và tệp log điều tra bảo mật (Windows Security EVTX, Sysmon, CSV lớn), nhóm phát hiện và ghi nhận 4 vấn đề kỹ thuật/trải nghiệm người dùng (UX) cần được chuẩn hóa và xử lý triệt để trong bản phát hành chính thức **v1.3.9**:

1. **Lỗi điều hướng phím mũi tên đóng mất chi tiết sự kiện (Event Detail ArrowDown Collapse Bug)**: Khi đang mở xem chi tiết một sự kiện (nút chevron `v` màu xanh), nhấn phím mũi tên Xuống (<kbd>&darr;</kbd>) khiến cả dòng cũ lẫn dòng mới bị đóng lại (`>`), mất thanh Event Detail Sidebar.
2. **Lỗi hiển thị trùng lặp 2 menu gợi ý bộ lọc (Dual Filter Suggestion Conflict)**: Khi người dùng click vào ô lọc giá trị, xuất hiện đồng thời cả menu gợi ý gốc của trình duyệt Chromium (ở trên) và menu React tùy biến (ở dưới).
3. **Tài liệu hướng dẫn Quick Start bị lệch phiên bản (Documentation Version Drift)**: Giao diện `quickstart.html` trong menu Help và `QUICK_START.md` cần đồng bộ hóa toàn diện lên phiên bản **1.3.9**.
4. **Yêu cầu nâng cấp phân trang linh hoạt (Dynamic Page Size Architecture)**:
   - Mặc định là **1.000 dòng/trang**.
   - **Tuyệt đối không giới hạn mức trần tối đa (No Max Limit / "Tự sửa tự chịu")**: Người dùng trên máy trạm cao cấp có thể tự do đặt 20.000, 50.000 hoặc tùy ý trong `config.ini` hoặc chọn trên Footer.

---

## 2. MA TRẬN YÊU CẦU NGHIỆP VỤ (BUSINESS ANALYSIS - BA SPECIFICATION)

| Mã YC | Hạng Mục Nghiệp Vụ | Mô Tả Yêu Cầu Người Dùng & Bối Cảnh | Tiêu Chí Nghiệm Thu (Acceptance Criteria - AC) | Mức Độ Ưu Tiên |
|:---:|---|---|---|:---:|
| **BA-01** | **Điều hướng liên tục giữa các Event Detail** | Chuyên viên DFIR đang soi chi tiết 1 sự kiện nghi vấn, muốn nhấn phím mũi tên <kbd>&darr;</kbd> hoặc <kbd>&uarr;</kbd> để lướt liên tục xem chi tiết các dòng tiếp theo mà không bị đóng panel. | - Khi Event Detail đang mở ở dòng $N$, bấm <kbd>&darr;</kbd> sẽ chuyển tiêu điểm sang dòng $N+1$ và **tự động mở chi tiết dòng $N+1$**.<br>- Dòng $N+1$ hiển thị icon `v` nền xanh bo tròn active.<br>- Bảng dữ liệu tự cuộn để dòng mới nằm trong tầm nhìn.<br>- Không được xảy ra tình trạng cả 2 dòng cùng đóng về icon `>`. | **P0 (Blocker)** |
| **BA-02** | **Đồng nhất 1 menu gợi ý bộ lọc duy nhất** | Chuyên viên lọc tìm kiếm theo giá trị (ví dụ cột `param1`, `EventID`, `User`, `Image`) cần một danh sách gợi ý gọn gàng, hiển thị đúng vị trí, đồng bộ theme sáng/tối. | - Khi click vào ô nhập giá trị bộ lọc, **chỉ xuất hiện duy nhất 1 menu gợi ý của React** ngay phía dưới ô input.<br>- Loại bỏ hoàn toàn popup trắng gốc của trình duyệt Chromium phía trên.<br>- Danh sách gợi ý hỗ trợ đầy đủ Dark Mode, click chuột chọn ăn ngay, hỗ trợ phím mũi tên/Enter. | **P0 (Critical)** |
| **BA-03** | **Cập nhật đồng bộ tài liệu Quick Start Guide** | Đảm bảo người dùng mới và chuyên viên nắm bắt đầy đủ các tính năng tối ưu hóa mới nhất của Toad. | - `quickstart.html` cập nhật badge phiên bản và nội dung tính năng lên phiên bản v1.3.9.<br>- `QUICK_START.md` đồng bộ hóa toàn bộ kiến trúc Ingestion Jitterless, `max_memory = auto`, EVTX Rust SIMD Engine, cấu hình `config.ini` và phân trang linh hoạt.<br>- Cập nhật toàn bộ tài liệu release notes. | **P1 (High)** |
| **BA-04** | **Linh hoạt số lượng bản ghi trên một trang (Page Size - Không giới hạn Max)** | Người dùng có thể tùy biến số lượng bản ghi hiển thị (mặc định 1.000 dòng, tùy chọn 500, 1000, 2500, 5000, 10000 dòng/trang hoặc cấu hình tự do) mà **không bị hệ thống giới hạn chặn trần**. | - Tệp `config.ini` cho phép cấu hình `page_size` mặc định (`page_size = 1000`). Không áp đặt giới hạn max (chỉ kiểm tra `page_size >= 1`).<br>- Trên thanh Footer có menu dropdown chọn nhanh: `[ 500 | 1,000 | 2,500 | 5,000 | 10,000 | Tùy biến ]`.<br>- Khi đổi cỡ trang, bảng dữ liệu tự tính lại số trang (`totalPages`), điều chỉnh bộ đệm trượt 5 trang và nạp lại dữ liệu mượt mà. | **P1 (High)** |

---

## 3. PHÂN TÍCH KỸ THUẬT & PHƯƠNG ÁN TRIỂN KHAI (TECHNICAL REMEDIATION)

### 3.1. Hạng mục 1: Khắc phục lỗi đóng chi tiết sự kiện khi bấm phím mũi tên
* **Files can thiệp**:
  - `packages/tadviewer/src/components/AppPane.tsx`: Bổ sung tham số `forceOpen?: boolean` vào `handleExpandEvent`. Khi `forceOpen` là `true`, luôn gán `expandedEvent` sang dòng mới mà không toggle đóng `null`.
  - `packages/tadviewer/src/components/GridPane.tsx`: Cập nhật signature `onExpandEvent`.
  - `packages/tadviewer/src/components/DataGrid.tsx`:
    - Truyền `forceOpen: true` trong `grid.onActiveCellChanged`.
    - Xóa bỏ lời gọi thừa `props.onExpandEvent?.(targetItem, targetRow)` trong `handleKeyDown`.
    - Phân định rõ click nút toggle vs click chọn dòng.

### 3.2. Hạng mục 2: Loại bỏ thanh gợi ý trùng lặp trong bộ lọc Filter
* **File can thiệp**: `packages/tadviewer/src/components/FilterEditorRow.tsx`
* **Triển khai**:
  - Xóa bỏ hoàn toàn khai báo `datalistId`, `datalistElement` và thẻ `<datalist>` khỏi DOM.
  - Xóa bỏ thuộc tính `list={datalistId}` trong cả `SingleValueSuggestInput` và `MultiTagPillInput`.
  - Giữ lại duy nhất dropdown tùy biến `.filter-suggest-menu` của React.

### 3.3. Hạng mục 3: Động cơ phân trang linh hoạt (Dynamic Page Size Engine)
* **Files can thiệp**:
  - `packages/tadviewer/src/ViewState.ts`: Khai báo `_defaultPageSize = 1000`, `getDefaultPageSize()`, `setDefaultPageSize(size)`.
  - `packages/tadviewer/src/actions.ts`: Bổ sung action `setPageSize(size, stateRef)`. Cập nhật `initViewState` và `replaceCurrentView` dùng `getDefaultPageSize()`.
  - `packages/tadviewer/src/PivotRequester.ts`: Nhận diện sự thay đổi `pageSize`, cập nhật `this.pageSize = pSize` và tái kích hoạt `sendDataRequest`.
  - `packages/tadviewer/src/components/Footer.tsx`: Thêm dropdown chọn `pageSize` trực tiếp trên Footer UI (`.footer-pagesize-select`).
  - `packages/tadviewer/less/footer.less`: Thêm styling tương thích cả giao diện sáng lẫn Dracula dark mode.
  - `packages/tad-app/app/portableAppData.ts`: Bổ sung `page_size: number` (mặc định 1000) vào `DEFAULT_CONFIG.general` và template `config.ini`. Kiểm tra hợp lệ: `if (isNaN(page_size) || page_size < 1) page_size = 1000;` (**Tuyệt đối không giới hạn trần max**).
  - `packages/toad-core-rust/src/config_manager.rs`: Bổ sung `pub page_size: u64` (mặc định 1000, không chặn trần max). Đã biên dịch release và cập nhật `bin/toad-core.exe`.
  - `packages/tad-app/app/main.ts` & `packages/tad-app/src/electronRenderMain.tsx`: Đăng ký IPC handler `getToadConfig` và tự động áp dụng `actions.setDefaultPageSize` khi khởi chạy.

### 3.4. Hạng mục 4: Đồng bộ tài liệu và phiên bản v1.3.9
* Đã cập nhật `packages/tad-app/package.json` lên phiên bản `"1.3.9"`.
* Đã cập nhật `quickstart.html` (badge header v1.3.9, changelog v1.3.9, footer v1.3.9).
* Đã cập nhật `QUICK_START.md` (v1.3.9, mô tả phân trang linh hoạt, Master-Detail triage, single filter dropdown).
* Đã bổ sung Release Notes chi tiết trong `releases/RELEASE_NOTES.md`.

---

## 4. MA TRẬN KIỂM THỬ CHẤT LƯỢNG (QA TEST MATRIX - v1.3.9)

| Test ID | Hạng Mục Kiểm Thử | Các Bước Thực Hiện | Kết Quả Kỳ Vọng | Đánh Giá |
|:---:|---|---|---|:---:|
| **TC-701** | Event Detail ArrowDown Continuous Navigation | 1. Mở file log lớn.<br>2. Click mở xem chi tiết tại dòng 1 (icon `v` xanh).<br>3. Nhấn phím mũi tên Xuống (<kbd>&darr;</kbd>) 5 lần liên tiếp. | Tiêu điểm di chuyển lần lượt qua các dòng 2, 3, 4, 5, 6. Sidebar chi tiết hiển thị đúng nội dung của từng dòng tương ứng. Icon hiển thị đúng nút màu xanh `v`, panel không bị đóng. | ✅ **PASSED** |
| **TC-702** | Event Detail ArrowUp Continuous Navigation | 1. Đang ở dòng 6 có chi tiết đang mở.<br>2. Nhấn phím mũi tên Lên (<kbd>&uarr;</kbd>) 3 lần liên tiếp. | Tiêu điểm và panel chi tiết chuyển mượt mà ngược về dòng 5, 4, 3 mà không bị sập trạng thái. | ✅ **PASSED** |
| **TC-703** | Single Filter Suggestion Menu | 1. Mở bộ lọc Filter.<br>2. Chọn toán tử `=` hoặc `IN`.<br>3. Gõ ký tự vào ô giá trị. | Chỉ xuất hiện duy nhất 1 menu gợi ý của React bung ở phía dưới. Không xuất hiện popup gốc của trình duyệt ở phía trên. | ✅ **PASSED** |
| **TC-704** | Page Size Default Baseline | 1. Khởi động Toad mà không sửa `config.ini`.<br>2. Mở một tệp dữ liệu lớn. | Bảng hiển thị mặc định 1.000 dòng/trang. Dropdown trên Footer hiển thị `1,000 / page`. | ✅ **PASSED** |
| **TC-705** | Page Size On-the-fly Footer Switching | 1. Đang ở trang 1 cỡ 1.000 dòng.<br>2. Chọn chuyển sang `2,500 / page` trên dropdown Footer. | Bảng dữ liệu lập tức cập nhật hiển thị `Showing 1 - 2,500 of N Rows`. Tốc độ phản hồi < 100ms, bộ đệm trượt 5 trang cập nhật chuẩn xác. | ✅ **PASSED** |
| **TC-706** | Uncapped Page Size ("User Discretion") | 1. Sửa `config.ini` đặt `page_size = 50000`.<br>2. Khởi chạy Toad và mở file log lớn. | Hệ thống nạp 50.000 dòng/trang thành công, không bị ép về giới hạn trần giả định. | ✅ **PASSED** |
| **TC-707** | Quick Start & Release Notes Sync | 1. Mở menu **Help &rarr; Quick Start Guide**.<br>2. Kiểm tra tài liệu markdown và release notes. | Toàn bộ tài liệu hiển thị đồng bộ nhãn `v1.3.9`, đầy đủ các tính năng mới nhất. | ✅ **PASSED** |
