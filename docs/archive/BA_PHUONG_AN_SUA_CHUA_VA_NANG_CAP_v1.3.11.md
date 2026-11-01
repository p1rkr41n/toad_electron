# TÀI LIỆU PHÂN TÍCH NGHIỆP VỤ & PHƯƠNG ÁN TRIỂN KHAI HỆ THỐNG TOAD (v1.3.11)
> **Dự án:** TOAD Viewer - Công cụ Phân tích Điều tra Số & Giám sát Log (DFIR / SOC Log Analyzer)  
> **Phiên bản mục tiêu:** v1.3.11 (Dynamic Tree Label Reactivity & Non-blocking Ingestion Engine)  
> **Ngày lập tài liệu:** 28/10/2026  
> **Trạng thái:** Đã hoàn tất triển khai mã nguồn & Nghiệm thu QA toàn diện  

---

## 1. TỔNG QUAN BỐI CẢNH & MỤC TIÊU DỰ ÁN

Tại phiên bản v1.3.10, cơ chế nạp ngầm đa tệp định kỳ (Multiple Loading Manager) đã được tích hợp vào hệ thống TOAD. Tuy nhiên, qua quá trình kiểm thử thực tế trên tập mẫu dữ liệu (`data_sample` gồm các tệp `output_1000.csv`, `Security.evtx`, `System.evtx`), người dùng ghi nhận các hiện tượng sau:
1. Toàn bộ các tệp trên thanh sidebar bên trái bị giữ cố định ở nhãn `0%` và không thay đổi theo tiến trình xử lý thực tế.
2. Tệp `Security.evtx` sau khi được người dùng click mở đã nạp thành công và hiển thị đầy đủ các cột dữ liệu trên DataGrid chính, nhưng tên tệp ở thanh sidebar bên trái vẫn hiển thị `0%`.
3. Thuật toán đo lường tiến độ IO và % nạp tệp (vốn hoạt động tốt ở các bản nạp đơn tệp trước) chưa được liên kết hiệu quả vào cơ chế cập nhật giao diện của thanh Sidebar.

**Mục tiêu của phiên bản v1.3.11**:
- Tái cấu trúc cơ chế render của Blueprint Tree: Chuyển đổi nhãn tệp từ JSX Element tĩnh sang Functional Component phản ứng động (`FileTreeItemLabel`).
- Đồng bộ hai chiều giữa màn hình hiển thị DataGrid và hàng đợi nạp ngầm: Ngay khi một tệp hiển thị trên DataGrid hoặc nạp xong vào DuckDB, nhãn tệp lập tức chuyển sang trạng thái `ready` (chữ màu đen/trắng sáng, ẩn số `0%` và thanh tiến trình mini).
- Bất đồng bộ hóa toàn diện tiến trình chuyển đổi định dạng EVTX sang Parquet trong `csvimport.ts`, giải phóng luồng chính của Node.js và phát sự kiện tiến độ trung gian liên tục.
- Đảm bảo hàng đợi nạp ngầm 1s tự động chuyển tuần tự từ tệp này sang tệp tiếp theo mà không làm đơ giao diện hay quá tải tài nguyên hệ thống.

---

## 2. MA TRẬN YÊU CẦU NGHIỆP VỤ (BUSINESS ANALYSIS - BA SPECIFICATION)

| Mã YC | Hạng Mục Nghiệp Vụ | Mô Tả Yêu Cầu & Bối Cảnh Người Dùng | Tiêu Chí Nghiệm Thu (Acceptance Criteria - AC) | Mức Độ Ưu Tiên |
|:---:|---|---|---|:---:|
| **BA-23** | **Nhãn Cây Thư mục Phản ứng Động (Dynamic Tree Item Label Reactivity)** | Người dùng mở thư mục chứa nhiều tệp, các nhãn tệp phải phản ánh tức thời và liên tục mọi thay đổi trạng thái và % tiến độ từ hàng đợi nạp ngầm. | - Loại bỏ hoàn toàn hiện tượng kẹt nhãn `0%` do static JSX closure.<br>- Mỗi tệp tự quản lý việc re-render nhãn khi có cập nhật từ `MultipleLoadingManager` mà không cần vẽ lại toàn bộ cây.<br>- Tệp đang chờ: màu xám, hiển thị `0%`.<br>- Tệp đang nạp: hiển thị `%` tăng dần và thanh tiến trình mini màu xanh chạy mượt.<br>- Tệp đã nạp xong: chuyển màu đen đậm (Light Mode) / trắng sáng (Dark Mode), số `%` và thanh tiến trình mini ẩn đi hoàn toàn. | **P0 (Blocker)** |
| **BA-24** | **Đồng bộ Trạng thái Tệp Đang Mở trên DataGrid (Active View State Sync)** | Khi người dùng click mở một tệp hoặc tệp được hiển thị trên bảng DataGrid chính, thanh Sidebar phải nhận biết tệp đó đã `ready`. | - Tệp đang mở trên DataGrid lập tức chuyển sang trạng thái `ready 100%` trên sidebar.<br>- Không bao giờ xảy ra tình trạng bảng đã mở mà sidebar vẫn báo `0%`.<br>- Gọi phương thức `markReady` giải phóng tệp khỏi hàng đợi và kích hoạt tệp tiếp theo. | **P0 (Critical)** |
| **BA-25** | **Bất đồng bộ hóa Tiến trình Chuyển đổi EVTX (Non-blocking EVTX Pipeline)** | Chuyển đổi tệp EVTX có thể mất từ vài giây đến hàng chục giây đối với các tệp nhật ký sự kiện lớn, không được phép làm đơ giao diện ứng dụng. | - Thay thế `execFileSync` bằng `execFile`/`spawn` bất đồng bộ trả lời qua Promise.<br>- Luồng chính Node.js duy trì khả năng tương tác 100% trong lúc nạp.<br>- Phát tiến độ mượt mà từ giai đoạn giải mã EVTX (5% - 45%) đến streaming Parquet (45% - 90%) và hoàn tất (100%). | **P0 (Critical)** |
| **BA-26** | **Chuyển tiếp Tiến độ Tệp Siêu Tốc & Cache Hit (Sub-second Ingest Transition)** | Các tệp nhỏ (<1MB) nạp trong 5-10ms hoặc các tệp đã có Parquet Cache sẵn phải hiển thị trạng thái `ready` trơn tru mà không bị sót nhãn. | - Tệp nhỏ nạp xong lập tức chuyển sang trạng thái `ready` đen đậm.<br>- Hàng đợi 1s tự động chuyển ngay sang tệp tiếp theo sau độ trễ nhỏ (50ms). | **P1 (High)** |

---

## 3. THIẾT KẾ KỸ THUẬT & KIẾN TRÚC MÃ NGUỒN

```
+-----------------------------------------------------------------------------------+
|                            TOAD ARCHITECTURE v1.3.11                             |
+-----------------------------------------------------------------------------------+
|  Renderer Process (React UI)                                                      |
|  ┌─────────────────────────────────┐   ┌────────────────────────────────────────┐  |
|  |     DataSourceSidebar           |   |       DataGrid Main Workspace          |  |
|  |  ┌───────────────────────────┐  |   |  ┌──────────────────────────────────┐  |  |
|  |  | FileTreeItemLabel (React) |  |   |  | viewState.dsPath: Security.evtx  |  |  |
|  |  | - Subscribes to Manager   |  |   |  └──────────────────────────────────┘  |  |
|  |  | - Checks isActiveView     |  |   └───────────────────▲────────────────────┘  |
|  |  | - Renders Live % & CSS    |  |                       │                       |
|  |  └─────────────▲─────────────┘  |                       │ actions.replaceCurrent|
|  └────────────────┼────────────────┘                       │ View / markReady      |
|                   │ subscribe() / notify()                 │                       |
|  ┌────────────────┴────────────────────────────────────────┴────────────────────┐  |
|  |                      MultipleLoadingManager (Singleton)                      |  |
|  |  - files: Map<key, FileIngestItem>                                           |  |
|  |  - markReady(dsPath): chuyển status="ready", percent=100, kích hoạt queue    |  |
|  |  - handleIngestProgress: khớp fileName chuẩn hóa, thông báo UI               |  |
|  └────────────────▲─────────────────────────────────────────────────────────────┘  |
+───────────────────┼───────────────────────────────────────────────────────────────+
                    │ IPC: "toad-ingest-progress"
+───────────────────┼───────────────────────────────────────────────────────────────+
|  Main Process (Electron & DuckDB Engine)                                          |
|  ┌────────────────┴─────────────────────────────────────────────────────────────┐  |
|  |  reltab-duckdb / csvimport.ts                                                 |  |
|  |  - Async EVTX Ingestion (child_process.execFile Promise)                      |  |
|  |  - Multi-stage Progress: Decode (5-45%) -> Parquet (45-90%) -> View (100%)    |  |
|  |  - Native IO Watcher (Toad Core Rust) cho CSV/Log streaming                   |  |
|  |  - Atomic Parquet rename & DuckDB View Hand-off                               |  |
|  └──────────────────────────────────────────────────────────────────────────────┘  |
+-----------------------------------------------------------------------------------+
```

---

## 4. MA TRẬN KIỂM THỬ CHẤT LƯỢNG (QA TEST MATRIX - v1.3.11)

| Test ID | Phân Hệ Kiểm Thử | Các Bước Thực Hiện | Kết Quả Kỳ Vọng | Đánh Giá |
|:---:|---|---|---|:---:|
| **TC-1001** | Dynamic Label Reactivity | 1. Mở thư mục `data_sample`.<br>2. Quan sát nhãn của các tệp `output_1000.csv`, `Security.evtx`, `System.evtx`. | Tệp chưa nạp hiển thị chữ xám `0%`. Không có hiện tượng kẹt JSX tĩnh. | ✅ **PASSED** |
| **TC-1002** | Active View Ready Transition | 1. Click vào tệp `Security.evtx`.<br>2. Bảng dữ liệu mở trên DataGrid. | Tên tệp `Security.evtx` trên sidebar chuyển ngay sang màu đen đậm (Light Mode), số `0%` và thanh mini biến mất hoàn toàn. | ✅ **PASSED** |
| **TC-1003** | Multiple Loading Sequential Drain | 1. Mở thư mục có nhiều tệp CSV/EVTX.<br>2. Quan sát hàng đợi tự động chạy tuần tự mỗi ~1s. | Tệp 1 nạp xong chuyển màu đen, tệp 2 lập tức bắt đầu nạp hiển thị thanh tiến độ %, cứ thế tuần tự đến hết thư mục. | ✅ **PASSED** |
| **TC-1004** | Async EVTX Conversion Progress | 1. Nạp một tệp EVTX kích thước lớn (>10MB).<br>2. Quan sát giao diện ứng dụng. | Giao diện hoàn toàn không bị đơ giật. Thanh tiến độ hiển thị % tăng dần từ giai đoạn giải mã đến khi hoàn tất. | ✅ **PASSED** |
| **TC-1005** | Cache Hit Instant Ready | 1. Tải lại một tệp đã có Parquet Cache sẵn trong thư mục tạm. | Tệp lập tức chuyển sang `ready` màu đen 0ms không trễ. | ✅ **PASSED** |
| **TC-1006** | Version Synchronization Check | 1. Mở menu Help &rarr; Quick Start Guide.<br>2. Kiểm tra footer và badge phiên bản. | Toàn bộ hiển thị đồng bộ `v1.3.11`. | ✅ **PASSED** |

---

## 5. KẾ HOẠCH BÀN GIAO SẢN PHẨM v1.3.11

- Tệp thực thi chính: [`Toad.exe`](file:///D:/Shared_UserData/Downloads/tad/Toad.exe)
- Bản phát hành portable gắn thẻ phiên bản: [`releases/toad_v1.3.11_portable.exe`](file:///D:/Shared_UserData/Downloads/tad/releases/toad_v1.3.11_portable.exe)
- Cập nhật tài liệu: [`docs/PHUONG_AN_NANG_CAP_MULTIPLE_LOADING_PERCENT_ALGORITHM_v1.3.11.md`](file:///D:/Shared_UserData/Downloads/tad/docs/PHUONG_AN_NANG_CAP_MULTIPLE_LOADING_PERCENT_ALGORITHM_v1.3.11.md), [`QUICK_START.md`](file:///D:/Shared_UserData/Downloads/tad/QUICK_START.md), [`releases/RELEASE_NOTES.md`](file:///D:/Shared_UserData/Downloads/tad/releases/RELEASE_NOTES.md).
