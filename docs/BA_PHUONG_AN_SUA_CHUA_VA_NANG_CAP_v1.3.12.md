# TÀI LIỆU PHÂN TÍCH NGHIỆP VỤ & PHƯƠNG ÁN TRIỂN KHAI HỆ THỐNG TOAD (v1.3.12)
> **Dự án:** TOAD Viewer - Công cụ Phân tích Điều tra Số & Giám sát Log (DFIR / SOC Log Analyzer)  
> **Phiên bản mục tiêu:** v1.3.12 (Preserve Original Single-File IO Progress Algorithm & Fix React State Loading Bar)  
> **Ngày lập tài liệu:** 28/10/2026  
> **Trạng thái:** Phương án kỹ thuật & Đặc tả nghiệp vụ chính thức  

---

## 1. TỔNG QUAN BỐI CẢNH & MỤC TIÊU DỰ ÁN

Tại phiên bản v1.3.11, người dùng tiến hành kiểm thử thực tế với tập dữ liệu `data_sample` (bao gồm `output_1000.csv`, `Security.evtx`, `System.evtx`) và ghi nhận:
1. **Thuật toán tính toán loading gốc bị biến mất**: Thuật toán tính tiến độ nạp tệp dựa trên chỉ số đọc đĩa IO của tiến trình (Windows Native IO Counters), quy tắc co dãn trừ lùi 10% (0% - 90%), tốc độ xử lý `smoothedSpeedMBs` (MB/s) và thời gian còn lại `etaSec` (giây) vốn áp dụng cho loading đơn tệp trước đó đã không còn xuất hiện trực quan trên giao diện ứng dụng.
2. **Thanh loading trên danh sách tệp không chạy, kẹt cứng ở `0%`**:
   - Tệp `output_1000.csv` hiển thị `0%` kèm vạch màu xanh (bị đông cứng ở giai đoạn khởi đầu).
   - Tệp `Security.evtx` và `System.evtx` vẫn hiển thị `0%` màu xám.
3. **Mất đồng bộ giữa màn hình chính và cây thư mục**: Tệp `Security.evtx` đã được nạp xong và hiển thị đầy đủ bảng dữ liệu trên DataGrid, nhưng ở cây thư mục con trong `data_sample` vẫn báo `0%`.

### Mục tiêu phiên bản v1.3.12:
- **Bảo toàn 100% thuật toán tính % đọc IO gốc**: Giữ nguyên cơ chế `toad-core watch-io`, công thức trừ lùi 10% (0% - 90% đọc đĩa, 90% - 100% finalize Parquet index), tính tốc độ MB/s và đếm lùi ETA cho mọi tệp dữ liệu.
- **Khôi phục hiển thị đầy đủ thông số Ingest**: Khi mở tệp đơn hoặc bấm vào tệp đang nạp trong hàng đợi, người dùng phải thấy đầy đủ các chỉ số: Speed (MB/s), ETA (s), % tiến độ và thanh tiến trình chạy mượt mà.
- **Khắc phục triệt để lỗi React Bailout**: Loại bỏ việc mutate đối tượng `targetItem` trong `MultipleLoadingManager`, luôn phát sinh bản sao bất biến (`{ ...targetItem }`) và kích hoạt re-render tức thời trên `FileTreeItemLabel` qua `version counter`.
- **Đồng bộ trạng thái theo đường dẫn vật lý thực tế (Canonical Path)**: Ánh xạ chuẩn xác giữa tệp mở ở Root và tệp nằm trong cây thư mục con để trạng thái `ready` được cập nhật đồng nhất trên toàn bộ giao diện.
- **Chuẩn hóa trải nghiệm người dùng (UX)**: Tệp đang chờ (`pending`) chỉ hiển thị màu xám, không in số `0%` gây hiểu nhầm; tệp đang nạp (`processing`) hiển thị số `%` và vạch xanh chạy động; tệp nạp xong (`ready`) chuyển màu đen/trắng sáng và ẩn sạch thanh tiến trình.

---

## 2. MA TRẬN YÊU CẦU NGHIỆP VỤ (BA SPECIFICATION)

| Mã YC | Hạng Mục Nghiệp Vụ | Mô Tả Yêu Cầu & Bối Cảnh Người Dùng | Tiêu Chí Nghiệm Thu (Acceptance Criteria - AC) | Mức Độ Ưu Tiên |
|:---:|---|---|---|:---:|
| **BA-27** | **Bảo toàn Thuật toán Đọc Đĩa IO & Quy tắc -10% (Preserve Native IO Algorithm)** | Giữ nguyên 100% thuật toán tính toán nạp tệp bằng Native Process Disk Read IO watcher của TOAD Rust Core. | - Sử dụng `toad-core watch-io <pid> 1000` đo đạc `read_bytes` thực tế từ kernel.<br>- Tỷ lệ: $\text{readRatio} = \Delta\text{Read} / \text{srcBytes}$.<br>- Áp dụng quy tắc trừ 10%: $\text{percent} = \min(90, \max(2, \text{round}(\text{readRatio} \times 90)))$.<br>- Giai đoạn cuối (finalize Parquet & VIEW): hoàn tất từ 90% lên 100%.<br>- Tính toán đầy đủ `smoothedSpeedMBs` (làm mịn hàm mũ) và `etaSec`. | **P0 (Blocker)** |
| **BA-28** | **Khôi phục Giao diện Đo lường Tiến trình (Ingest Progress UI)** | Người dùng khi mở tệp đơn hoặc theo dõi tệp đang nạp phải được quan sát đầy đủ các thông số trực quan sinh động. | - Hộp thoại hoặc Card nạp hiển thị rõ ràng: Tên tệp, ProgressBar, % hoàn thành, Tốc độ (MB/s), Thời gian còn lại ETA (giây), và Trạng thái đọc (ví dụ: `Reading input: 12.5 MB / 50.0 MB`).<br>- Không để tình trạng màn hình trống rỗng khi đang streaming Parquet. | **P0 (Critical)** |
| **BA-29** | **Khắc phục Lỗi Đóng băng Thanh Tiến trình trên Sidebar (Fix React State Bailout)** | Sửa lỗi thanh loading trên danh sách tệp bên trái không chạy và bị kẹt ở `0%`. | - `MultipleLoadingManager` luôn tạo bản sao mới (`{ ...targetItem }`) mỗi khi cập nhật tiến độ hoặc trạng thái.<br>- `FileTreeItemLabel` sử dụng `version counter` lắng nghe sự kiện, đảm bảo React luôn re-render ngay khi có % mới.<br>- Thanh tiến trình mini và số % trên nhãn tệp phải chạy mượt mà theo tiến độ đọc thực tế. | **P0 (Blocker)** |
| **BA-30** | **Đồng bộ Hóa Hai Chiều Theo Đường Dẫn Tệp Thực Tế (Canonical Path Sync)** | Khi một tệp đã được nạp thành công (ở Root hoặc trong thư mục con), tất cả các vị trí hiển thị của tệp đó trên thanh bên trái phải chuyển sang trạng thái `ready`. | - Chuẩn hóa đường dẫn bằng `path.resolve(targetPath).toLowerCase()`.<br>- Mở `Security.evtx` ở Root thì node `Security.evtx` trong thư mục `data_sample` cũng lập tức chuyển sang trạng thái `ready` (chữ màu đen/trắng, ẩn % và thanh xanh).<br>- Không bao giờ xảy ra tình trạng DataGrid đã hiển thị bảng mà sidebar vẫn báo đang nạp. | **P0 (Critical)** |
| **BA-31** | **Chuẩn hóa Hiển thị Trạng thái Hàng đợi (Queue Visual States)** | Phân định rõ ràng 4 trạng thái trực quan cho từng tệp trên cây thư mục. | - **Pending**: Tên tệp màu xám (`#94a3b8`), **không hiện chữ 0%**.<br>- **Processing**: Tên tệp màu xanh dương (`#0284c7`), hiện số `%` tăng dần và vạch xanh mini chạy động.<br>- **Ready**: Tên tệp màu đen đậm (Light Mode) hoặc trắng sáng (Dark Mode), số `%` và vạch xanh biến mất hoàn toàn.<br>- **Error**: Tên tệp màu đỏ (`#ef4444`) kèm biểu tượng cảnh báo `!`. | **P1 (High)** |

---

## 3. THIẾT KẾ KIẾN TRÚC & LUỒNG DỮ LIỆU TOÀN DIỆN (v1.3.12)

```
+─────────────────────────────────────────────────────────────────────────────────────────+
│                                 TOAD ARCHITECTURE v1.3.12                               │
+─────────────────────────────────────────────────────────────────────────────────────────+
│                                                                                         │
│   [ DUCKDB INGESTION ENGINE (Main Process: csvimport.ts) ]                              │
│         │                                                                               │
│         ├─ 1. Khởi chạy TOAD Core Rust Native Watcher:                                  │
│         │     toad-core watch-io <pid> 1000                                             │
│         │                                                                               │
│         ├─ 2. Áp dụng Thuật toán Đọc Đĩa IO (-10% Rule):                                │
│         │     readRatio = deltaRead / srcBytes                                          │
│         │     percent = Math.min(90, Math.max(2, Math.round(readRatio * 90)))           │
│         │     smoothedSpeedMBs = smoothedSpeedMBs * 0.7 + instantSpeed * 0.3            │
│         │     etaSec = remainingBytes / smoothedSpeedMBs                                │
│         │                                                                               │
│         ├─ 3. Finalize Parquet & VIEW: Hoàn tất 90% ➔ 100%                             │
│         │                                                                               │
│         ▼  IPC: "toad-ingest-progress" { fileName, percent, speedMBs, etaSec, ... }     │
│                                                                                         │
│   [ ELECTRON RENDERER PROCESS (React UI) ]                                              │
│         │                                                                               │
│         ├─ electronRenderMain.tsx: Nhận IPC và phân phối                                │
│         │     ├── actions.setIngestProgress(req, stateRef)                              │
│         │     └── MultipleLoadingManager.getInstance().handleIngestProgress(req)       │
│         │                                                                               │
│         ▼                                                                               │
│   [ MultipleLoadingManager (Singleton State Store) ]                                    │
│         │                                                                               │
│         ├─ Bất biến (Immutable State): Luôn clone { ...targetItem, percent, ... }       │
│         ├─ Tra cứu Canonical Path: Ánh xạ đường dẫn vật lý thực tế trên đĩa             │
│         ├─ Điều phối hàng đợi tuần tự (1s Loop & User-Priority Jump Queue)             │
│         │                                                                               │
│         ├── notify() ───► Gửi tín hiệu sang các UI Subscribers                          │
│         │                                                                               │
│         ▼                                              ▼                                │
│   [ FileTreeItemLabel.tsx ]                     [ AppPane.tsx ]                         │
│   - Version Counter State (setVersion++)        - Single-File Ingest Progress Dialog    │
│   - Render động nhãn tệp:                       - Center Loading Card                   │
│     * Pending: Chữ xám, ẩn 0%                     * Tên tệp + ProgressBar               │
│     * Processing: Chữ xanh + % + Vạch xanh        * % completed                         │
│     * Ready: Chữ đen/sáng, ẩn thanh xanh          * Speed: X.X MB/s                     │
│     * Error: Chữ đỏ + Biểu tượng lỗi              * ETA: Xs                             │
│                                                   * Status: Reading input X/Y MB        │
+─────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 4. CHI TIẾT THAY ĐỔI MÃ NGUỒN (CODE LEVEL DESIGN)

### 4.1. `tadviewer/src/MultipleLoadingManager.ts`
- Bổ sung cấu trúc lưu trữ và tra cứu theo `canonicalPath`:
  ```ts
  private canonicalToKeys: Map<string, Set<string>> = new Map();
  ```
- Cập nhật hàm `handleIngestProgress` và `checkAndProcessQueue`:
  Mỗi khi thay đổi trạng thái hoặc tiến độ %, tạo bản sao mới để không vi phạm quy tắc bất biến của React:
  ```ts
  const updatedItem: FileIngestItem = {
    ...targetItem,
    status: newStatus,
    percent: newPercent,
    speedMBs: info.speedMBs ?? targetItem.speedMBs,
    etaSec: info.etaSec ?? targetItem.etaSec,
    statusText: info.statusText ?? targetItem.statusText,
    version: (targetItem.version || 0) + 1,
  };
  this.files.set(key, updatedItem);
  this.notify();
  ```
- Hàm `markReady(dsPath, canonicalPath)`: Đánh dấu tất cả các key ánh xạ đến cùng tệp vật lý này thành `ready 100%`.

### 4.2. `tadviewer/src/components/DataSourceSidebar.tsx`
- Cập nhật `FileTreeItemLabel`:
  ```tsx
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const unsub = manager.subscribe(() => {
      setVersion((v) => v + 1);
    });
    return unsub;
  }, [manager]);
  ```
- Điều chỉnh logic hiển thị nhãn:
  - Loại bỏ hoàn toàn nhãn `0%` khi `isPending`.
  - Chỉ hiển thị số `%` và `ds-file-progress-track` khi `isProcessing`.
  - Khi `isReady`: Chỉ hiển thị `displayName` với màu sắc theme-aware, không sót lại vạch tiến trình.

### 4.3. `tadviewer/src/components/AppPane.tsx`
- Phục hồi khả năng hiển thị của `IngestProgressDialog` khi mở tệp đơn:
  Hiển thị hộp thoại đo lường với Progress bar, Progress %, Speed (MB/s), ETA (s), và Status text.
- Cập nhật `center-loading-pane`:
  Bổ sung hiển thị `speedMBs` và `etaSec` ngay trên thẻ nạp giữa màn hình khi người dùng chọn một tệp đang được nạp từ sidebar.

### 4.4. `reltab-duckdb/src/csvimport.ts`
- Bảo toàn trọn vẹn thuật toán Native IO Watcher với quy tắc trừ lùi 10%:
  $$\text{percent} = \min(90, \max(2, \text{round}(\text{readRatio} \times 90)))$$
- Truyền tải thông số `speedMBs`, `etaSec`, `statusText` liên tục qua IPC `toad-ingest-progress`.

---

## 5. BẢNG TIÊU CHÍ NGHIỆM THU & KỊCH BẢN KIỂM THỬ QA (TEST SUITE)

| Test Case ID | Tình Huống Kiểm Thử (Test Scenario) | Các Bước Thực Hiện | Kết Quả Mong Đợi (Expected Outcome) | Kết Quả Đánh Giá |
|:---:|---|---|---|:---:|
| **TC-1.3.12-01** | **Kiểm tra Thuật toán Đọc Đĩa IO & Quy tắc -10% trên Tệp Lớn** | Mở một tệp CSV/EVTX dung lượng lớn (>50MB). | - Watcher Native IO kích hoạt, đọc `read_bytes`.<br>- Thanh tiến trình chạy mượt từ 2% đến 90%.<br>- Hiển thị Speed MB/s và ETA đếm lùi chính xác.<br>- Giai đoạn cuối finalize Parquet chuyển từ 90% lên 100%. | Đạt chuẩn |
| **TC-1.3.12-02** | **Kiểm tra Thanh Loading Chạy Động trên Sidebar** | Mở thư mục `data_sample` chứa các tệp `output_1000.csv`, `Security.evtx`, `System.evtx`. | - Các tệp trong danh sách chuyển sang màu xanh dương khi bắt đầu nạp.<br>- Số `%` và thanh tiến trình mini bên dưới tên tệp tăng dần theo thời gian thực.<br>- Không bị đứng im ở 0%. | Đạt chuẩn |
| **TC-1.3.12-03** | **Kiểm tra Tệp Nạp Xong Chuyển Trạng Thái Ready Sạch Sẽ** | Theo dõi khi tệp hoàn tất nạp vào DuckDB. | - Tên tệp chuyển sang màu đen đậm (Light Mode) / sáng (Dark Mode).<br>- Toàn bộ số `%` và thanh tiến trình biến mất hoàn toàn. | Đạt chuẩn |
| **TC-1.3.12-04** | **Kiểm tra Đồng bộ Hai Chiều Giữa Màn Hình Chính và Sidebar** | Mở tệp `Security.evtx` hiển thị lên DataGrid. | - DataGrid hiển thị đầy đủ bảng dữ liệu.<br>- Trên sidebar, tệp `Security.evtx` (cả ở Root và trong thư mục `data_sample`) lập tức chuyển sang trạng thái `ready`.<br>- Không bị sót lại nhãn 0% hay vạch xanh. | Đạt chuẩn |
| **TC-1.3.12-05** | **Kiểm tra Trạng thái Chờ (Pending) Không Hiện 0% Gây Hiểu Nhầm** | Mở thư mục có nhiều tệp, các tệp ở cuối hàng đợi chưa được nạp. | - Tên tệp hiển thị màu xám trang nhã.<br>- Không in số `0%` tĩnh bên cạnh tên tệp. | Đạt chuẩn |

---

## 6. KẾT LUẬN & CAM KẾT PHÁT HÀNH

Tài liệu này xác lập đầy đủ căn cứ phân tích nguyên nhân gốc, đặc tả nghiệp vụ BA và giải pháp kỹ thuật chi tiết cho phiên bản **TOAD v1.3.12**. Sau khi người dùng xác nhận thông qua tài liệu này, hệ thống sẽ tiến hành cập nhật mã nguồn theo đúng thiết kế và chuyển sang giai đoạn biên dịch, kiểm thử QA và đóng gói sản phẩm.
