# TÀI LIỆU PHÂN TÍCH NGHIỆP VỤ & PHƯƠNG ÁN TRIỂN KHAI HỆ THỐNG TOAD (v1.3.10)
> **Dự án:** TOAD Viewer - Công cụ Phân tích Điều tra Số & Giám sát Log (DFIR / SOC Log Analyzer)  
> **Phiên bản mục tiêu:** v1.3.10 (Multiple Loading Background Ingestion Engine & User-Priority Preemption)  
> **Ngày lập tài liệu:** 28/10/2026  
> **Trạng thái:** Đã triển khai mã nguồn & Hoàn tất Kiểm thử QA  

---

## 1. TỔNG QUAN BỐI CẢNH & MỤC TIÊU DỰ ÁN

Trong các tình huống thực tế về điều tra số (DFIR) và giám sát an ninh mạng (SOC), chuyên viên thường phải phân tích các thư mục chứa hàng chục đến hàng trăm tệp dữ liệu trích xuất (ví dụ: các tệp `EVTX` chuyển đổi, tệp trích xuất MFT CSV, tệp nhật ký proxy, tường lửa, DNS log):

- **Điểm nghẽn cũ**: Khi mở một thư mục, Toad chỉ hiển thị danh sách tệp. Người dùng phải nhấp chuột thủ công từng tệp một để kích hoạt nạp vào cơ sở dữ liệu DuckDB. Mỗi lần nhấp lại xuất hiện một hộp thoại pop-up modal toàn màn hình (`IngestProgressDialog`) khóa chặt giao diện, ngăn cản người dùng duyệt xem các tệp khác.
- **Yêu cầu nghiệp vụ mới**: Thiết lập cơ chế **Multiple Loading**:
  1. Tự động kiểm tra danh sách tệp định kỳ (chu kỳ khoảng 1 giây).
  2. Tệp chưa nạp được đánh dấu `0%`, hiển thị màu xám và tự động đưa vào hàng đợi nạp ngầm.
  3. Quá trình nạp hiển thị tiến độ `%` và thanh tiến trình mini ngay dưới chân tên tệp trên thanh Sidebar bên trái.
  4. Tệp nạp xong tự động đổi sang màu đen đậm (Light Mode) hoặc màu trắng sáng rõ (Dark Mode), sẵn sàng xem tức thì.
  5. Màn hình chính nếu chưa nạp xong thì hiển thị trạng thái `Loading...` trang nhã cho đến khi hoàn tất và tự động bung bảng dữ liệu (DataGrid).
  6. **Cơ chế cướp quyền ưu tiên (User-Priority Jump Queue)**: Người dùng nhấp vào tệp nào thì tệp đó lập tức được ưu tiên nạp ngay trước.
  7. **Xử lý tệp lỗi**: Nếu tệp bị hỏng hoặc 0 bytes, đổi sang màu đỏ cảnh báo kèm thông báo lỗi chi tiết, không làm đơ ứng dụng.

---

## 2. MA TRẬN YÊU CẦU NGHIỆP VỤ (BUSINESS ANALYSIS - BA SPECIFICATION)

| Mã YC | Hạng Mục Nghiệp Vụ | Mô Tả Yêu Cầu & Bối Cảnh Người Dùng | Tiêu Chí Nghiệm Thu (Acceptance Criteria - AC) | Mức Độ Ưu Tiên |
|:---:|---|---|---|:---:|
| **BA-19** | **Động cơ Nạp ngầm Đa tệp Tuần tự (Background Ingestion Queue)** | Chuyên viên mở thư mục chứa nhiều tệp log, hệ thống tự động đưa các tệp vào hàng đợi nạp nền mà không cần nhấp chuột thủ công. | - Toàn bộ tệp trong thư mục tự động được đăng ký vào hàng đợi.<br>- Chu kỳ ~1 giây tự động kích hoạt nạp ngầm từng tệp tuần tự.<br>- Nạp tuần tự không làm nghẽn CPU, I/O đĩa hoặc tràn bộ nhớ RAM. | **P0 (Blocker)** |
| **BA-20** | **Trực quan hóa Trạng thái Tệp trên Sidebar (In-Situ Mini Progress)** | Chuyên viên quan sát danh sách tệp bên trái nhận biết ngay tệp nào đang chờ, đang nạp, đã xong hay bị lỗi. | - Tệp chờ: màu xám mờ (`#94a3b8`), hiển thị `0%`.<br>- Tệp đang nạp: màu xám, hiển thị `%` tăng dần và thanh mini 2px màu xanh chạy dưới chân tên tệp.<br>- Tệp đã xong: chuyển màu đen đậm (`#111827`) trên Light Mode hoặc trắng sáng trên Dark Mode; thanh progress ẩn đi.<br>- Tệp lỗi: màu đỏ cảnh báo (`#ef4444`) kèm huy hiệu `!`. | **P0 (Critical)** |
| **BA-21** | **Cơ chế Cướp Quyền Ưu Tiên (User-Priority Jump Queue)** | Chuyên viên cần soi gấp một tệp nằm ở cuối danh sách mà không muốn chờ nạp hết các tệp trước. | - Nhấp chuột vào tệp đang chờ: tệp được đẩy ngay lên vị trí ưu tiên số 1.<br>- Màn hình chính lập tức chuyển sang trạng thái chờ của tệp đó.<br>- Ngay khi nạp xong 100%: màn hình tự động chuyển sang Bảng dữ liệu DataGrid. | **P0 (Critical)** |
| **BA-22** | **Loại bỏ Pop-up Modal & Thiết kế Màn hình Loading/Empty Chuyên Nghiệp** | Không để pop-up đè màn hình làm phiền người dùng; giao diện chính hiển thị trạng thái chờ thanh lịch. | - Loại bỏ hoàn toàn hộp thoại modal pop-up `IngestProgressDialog`.<br>- Màn hình chính hiển thị card `Loading [tên file]...` với spinner và vạch tiến độ cho đến khi render xong DataGrid.<br>- Khi chưa chọn file: hiển thị card `Ready for Analysis` thân thiện. | **P1 (High)** |

---

## 3. PHÂN TÍCH KỸ THUẬT & KIẾN TRÚC MÃ NGUỒN

### 3.1. Phân hệ Hàng đợi Nạp ngầm: `MultipleLoadingManager.ts`
- **Mô hình Singleton**: Quản lý tập trung toàn bộ trạng thái nạp tệp `files: Map<string, FileIngestItem>`.
- **Chu kỳ kiểm tra định kỳ 1s**: `startPollingLoop()` kích hoạt `setInterval(1000ms)`, kiểm tra:
  - Nếu `activeItem != null`: đang có tệp xử lý ngầm trong DuckDB, tiếp tục theo dõi tiến độ.
  - Nếu `activeItem == null`: tìm tệp `pending` có độ ưu tiên cao nhất (`priority DESC, addedTime ASC`), đặt `status = "processing"`, gọi `targetItem.dsc.getTableName(targetItem.dsPath)`.
- **Lắng nghe IPC Progress**: Nhận sự kiện `toad-ingest-progress` từ DuckDB engine để cập nhật phần trăm thực tế (`percent`, `speedMBs`, `etaSec`) và thông báo cho các component lắng nghe (`notify()`).

### 3.2. Trực quan hóa Danh sách Tệp: `DataSourceSidebar.tsx`
- Tùy biến hàm dựng nhãn cây thư mục `renderFileNodeLabel`:
  - Bao bọc tên tệp trong thẻ `.ds-file-node-wrapper`.
  - Tự động gán lớp CSS tương ứng với trạng thái: `.ds-status-pending`, `.ds-status-processing`, `.ds-status-ready`, `.ds-status-error`.
  - Hiển thị thanh tiến trình mini `.ds-file-progress-track` với vạch màu xanh `.ds-file-progress-fill` chạy từ 0% đến 100%.
- Tự động đăng ký toàn bộ tệp con khi thư mục mở rộng (`handleNodeExpand`).
- Đăng ký lắng nghe `MultipleLoadingManager.getInstance().subscribe(forceUpdate)`.

### 3.3. Tương tác Người dùng & Cướp Quyền Ưu Tiên: `handleNodeClick`
- Khi người dùng nhấp vào tệp:
  - Nếu tệp đã `ready`: Gọi ngay `actions.openDataSourcePath` mở bảng tức thì 0ms.
  - Nếu tệp chưa xong (`pending` / `processing`): Gọi `manager.prioritize(key)`, đồng thời gọi `actions.setActiveLoadingFile` để màn hình chính hiển thị trạng thái `Loading...`.
  - Khi tệp hoàn tất 100%: Tự động kích hoạt `actions.openDataSourcePath` hiển thị DataGrid.

### 3.4. Màn hình Chờ Tải & Suppress Modal Dialog: `AppPane.tsx`
- Thay thế pop-up modal toàn màn hình `IngestProgressDialog` bằng logic render không xâm lấn:
  - Nếu `activeLoading.isLoading`: Render thẻ `.center-loading-pane` chuyên nghiệp với spinner xoay tròn, tên tệp và vạch tiến độ.
  - Nếu `activeLoading.error`: Render thẻ `.center-error-pane` nêu rõ nguyên nhân.
  - Nếu chưa chọn tệp: Render thẻ `.center-empty-pane` hướng dẫn trực quan.

---

## 4. MA TRẬN KIỂM THỬ CHẤT LƯỢNG (QA TEST MATRIX - v1.3.10)

| Test ID | Phân Hệ Kiểm Thử | Các Bước Thực Hiện | Kết Quả Kỳ Vọng | Đánh Giá |
|:---:|---|---|---|:---:|
| **TC-901** | Multi-File Enqueue on Directory Open | 1. Mở một thư mục chứa 5 tệp CSV/EVTX.<br>2. Quan sát cây tệp trên Data Sources sidebar. | Toàn bộ 5 tệp xuất hiện trong danh sách. Các tệp chưa xử lý hiển thị chữ màu xám kèm nhãn `0%`. | ✅ **PASSED** |
| **TC-902** | 1-Second Periodic Ingestion Trigger | 1. Đợi chu kỳ 1s kích hoạt.<br>2. Quan sát tệp đầu tiên trong hàng đợi. | Tệp đầu tiên chuyển sang trạng thái nạp ngầm, thanh mini xanh dương bắt đầu chạy tăng dần từ 0% lên 100%. | ✅ **PASSED** |
| **TC-903** | Completion State Transition | 1. Theo dõi tệp hoàn tất nạp 100%. | Tên tệp chuyển sang màu đen đậm (Light Mode) hoặc trắng sáng (Dark Mode). Vạch tiến độ và số % tự động ẩn đi. | ✅ **PASSED** |
| **TC-904** | User-Priority Preemption (Jump Queue) | 1. Hệ thống đang nạp tệp 1.<br>2. Người dùng nhấp chọn tệp 4 đang ở `0%`. | Tệp 4 được cướp quyền ưu tiên lên đầu. Màn hình chính hiện card `Loading [Tên tệp 4]...` và tự động bung bảng khi xong. | ✅ **PASSED** |
| **TC-905** | Corrupted File Error Handling | 1. Thư mục có 1 tệp hỏng định dạng.<br>2. Hàng đợi nạp tới tệp đó hoặc người dùng nhấp vào. | Tên tệp đổi sang màu đỏ cảnh báo kèm icon `!`. Màn hình chính hiển thị thẻ báo lỗi chi tiết, ứng dụng không bị crash. | ✅ **PASSED** |
| **TC-906** | Non-Intrusive In-Situ Progress | 1. Tiến hành nạp thư mục nhiều tệp. | Không có bất kỳ hộp thoại pop-up modal nào che khuất màn hình; mọi tương tác duyệt tệp diễn ra tự nhiên. | ✅ **PASSED** |
| **TC-907** | Version Synchronization Check | 1. Mở menu Help &rarr; Quick Start Guide.<br>2. Kiểm tra footer và badge phiên bản. | Toàn bộ hiển thị đồng bộ `v1.3.10`. | ✅ **PASSED** |

---

## 5. TỔNG KẾT & BÀN GIAO SẢN PHẨM v1.3.10

Tệp thực thi độc lập đã được đóng gói và bàn giao tại:
- **Tệp thực thi chính**: [`Toad.exe`](file:///D:/Shared_UserData/Downloads/tad/Toad.exe) (~92 MB)
- **Bản phát hành có gắn tag phiên bản**: [`releases/toad_v1.3.10_portable.exe`](file:///D:/Shared_UserData/Downloads/tad/releases/toad_v1.3.10_portable.exe)
- **Tài liệu Hướng dẫn Khởi động Nhanh**: [`QUICK_START.md`](file:///D:/Shared_UserData/Downloads/tad/QUICK_START.md)
- **Ghi chú Bản phát hành Chi tiết**: [`releases/RELEASE_NOTES.md`](file:///D:/Shared_UserData/Downloads/tad/releases/RELEASE_NOTES.md)
