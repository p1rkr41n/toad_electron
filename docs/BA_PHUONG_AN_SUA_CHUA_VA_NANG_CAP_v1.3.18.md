# TÀI LIỆU ĐẶC TẢ YÊU CẦU NGHIỆP VỤ & PHƯƠNG ÁN KỸ THUẬT (BA)
## PHIÊN BẢN v1.3.18: GIẢI QUYẾT TRIỆT ĐỂ NGHẼN TRUY VẤN KHI NẠP TỆP LỚN (CPU THREAD ISOLATION & INSTANT UI RESPONSIVENESS)

---

### 1. TỔNG QUAN & BỐI CẢNH DỰ ÁN
Trong phiên bản **Toad v1.3.17**, hệ thống đã triển khai thành công thuật toán nạp hàng đợi song song:
- **Shortest Job First (SJF)**: Các tệp nhỏ được ưu tiên nạp trước.
- **Data Size Budget & Concurrency Limit**: Kiểm soát nạp tối đa 4 tệp cùng lúc với tổng dung lượng $\le 1\text{ GB}$, và chế độ **Exclusive Big File Mode** cho tệp $> 1\text{ GB}$.

**Hiện tượng thực tế phát sinh (ghi nhận từ môi trường thực tế lúc 20:43 - 20:46)**:
Khi người dùng mở một thư mục chứa hỗn hợp nhiều file nhỏ (`output_1000.csv`, `test_all.jsonl`, `System.evtx`, các file `Windows.EventLogs...`) và 2 file cực lớn (`sample_40gb.csv`, `sample_40gb.json` mỗi file 40GB):
1. Các file nhỏ nạp hoàn tất cực nhanh chỉ trong vòng 3 - 7 giây đầu tiên (từ `20:43:37` đến `20:43:44`) và chuyển sang màu đen đậm (trạng thái `ready 100%`).
2. Tiếp theo, hàng đợi bắt đầu nạp tệp khổng lồ `sample_40gb.csv` (tiến trình 34%).
3. Trong lúc `sample_40gb.csv` đang chạy, người dùng click vào file `test_all.jsonl` (hoặc các file đã sẵn sàng) để xem dữ liệu trên bảng DataGrid.
4. **Kết quả**: Giao diện hoàn toàn **không phản hồi (click không ăn)**, màn hình chính vẫn giữ nguyên file cũ, không có biểu tượng loading nào xuất hiện cho đến tận khi file 40GB nạp xong (mất hơn 1 phút 40 giây).

---

### 2. PHÂN TÍCH NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE ANALYSIS)

Dựa trên nhật ký hệ thống [`toad.log`](file:///d:/Shared_UserData/Downloads/tad/releases/toadAppData_pgvjp/logs/toad.log):

```log
[20:43:40] [MultipleLoading] Hoan tat nạp file test_all.jsonl thanh cong -> Bang: test_all
[20:43:44] [MultipleLoading] Bat dau xu ly worker song song: sample_40gb.csv (40,960.00 MB)
[20:43:53] *** replaceCurrentView: dsPath (Người dùng click vào test_all.jsonl)
... (treo đơ suốt 95 giây, người dùng click liên tiếp hơn 20 lần)
[20:45:28] [MultipleLoading] Hoan tat nạp file sample_40gb.csv thanh cong -> Bang: sample_40gb
[20:45:28] PivotRequester: Bo qua QueryView cu vi nguoi dung da chuyen view. (x 25 lần)
[20:45:29] [MultipleLoading] Bat dau xu ly worker song song: sample_40gb.json (40,960.00 MB)
```

#### Nguyên nhân 1: DuckDB bị độc quyền tài nguyên bởi câu lệnh Write/COPY 40GB (CPU & Execution Starvation)
- Trong `config.ini`, tham số `threads = 0` (mặc định của DuckDB nghĩa là sử dụng **toàn bộ số lõi CPU của máy tính**).
- Khi lệnh nạp ngầm `COPY (SELECT * FROM read_csv('sample_40gb.csv')) TO Parquet` khởi chạy, DuckDB chiếm dụng 100% tất cả các luồng CPU và tối đa băng thông I/O đĩa.
- Mặc dù bảng `test_all` đã tạo xong, khi người dùng click vào để xem, hàm `replaceCurrentView` gọi `aggtree.getBaseSchema` $\to$ gửi câu lệnh `SELECT * FROM test_all LIMIT 1000` xuống DuckDB.
- Toàn bộ luồng CPU của DuckDB đang bị khóa chặt vào tác vụ 40GB, khiến câu lệnh `SELECT` bị **xếp hàng chờ (blocked queue)** trong DuckDB suốt 95 giây.

#### Nguyên nhân 2: Điểm mù giao diện khi click file đã Ready (UI Silent Blind Spot)
- Trong `DataSourceSidebar.tsx`, sự kiện `handleNodeClick` xử lý:
  ```tsx
  if (item && item.status === "ready") {
    manager.clearPendingActiveOpen();
    actions.setActiveLoadingFile(null, stateRef); // <--- XÓA BỎ MỌI TRẠNG THÁI LOADING
    await actions.openDataSourcePath(dsPath, stateRef);
  }
  ```
- Đồng thời trong `actions.openDataSourcePath`:
  ```ts
  const isFileAlreadyReady = item && item.status === "ready";
  if (!isAlreadyLoading && !isFileAlreadyReady) {
    setActiveLoadingFile({ ... }, stateRef); // <--- BỎ QUA KHÔNG BẬT LOADING NẾU FILE ĐÃ READY
  }
  ```
- Kết quả: Khi click vào file đã ready, hệ thống xóa trắng trạng thái loading. Trong khi DuckDB đang nghẽn 95 giây để lấy dữ liệu, giao diện **hoàn toàn đứng im, không xoay vòng, không thông báo**, khiến người dùng lầm tưởng phần mềm bị liệt cảm ứng/click không ăn.

#### Nguyên nhân 3: Hiệu ứng tuyết lở do Click dồn ứ (Click-Flood Cascade)
- Người dùng tưởng click không ăn nên click liên tục 20-30 lần vào các node khác nhau.
- Ở giây `20:45:28`, khi file 40GB đầu tiên vừa xong, toàn bộ 25 lệnh click trước đó đồng loạt bung ra, `PivotRequester` nhận hàng chục sự kiện thay đổi view liên tục và phải hủy bỏ dọn dẹp view (`Bo qua QueryView cu`).
- Đúng 0.3 giây sau (`20:45:29`), hàng đợi lại nạp tiếp file 40GB thứ hai (`sample_40gb.json`), tiếp tục phong tỏa DuckDB thêm 1.5 phút nữa.

---

### 3. THIẾT KẾ GIẢI PHÁP KỸ THUẬT CHO PHIÊN BẢN v1.3.18

Nhằm giải quyết triệt để 3 nguyên nhân trên, Toad v1.3.18 triển khai 4 trụ cột kiến trúc:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TOAD v1.3.18 ARCHITECTURE                          │
├──────────────────────────────────────┬──────────────────────────────────────┤
│    INTERACTIVE UI ENGINE (FOREGROUND)│    BACKGROUND INGESTION QUEUE        │
│                                      │                                      │
│  - Dedicated UI Cores: Reserved 2    │  - Worker Cores: Max (Total - 2)     │
│    cores (always available)          │  - SJF Queue & 1GB Budget            │
│  - Instant Click Response (< 50ms)   │  - Yields CPU/IO during UI clicks    │
│  - Smooth "Opening table..." overlay │  - Throttled when user switches view │
└──────────────────────────────────────┴──────────────────────────────────────┘
                                  │
                                  ▼
               ┌──────────────────────────────────────┐
               │         DuckDB C++ Core Engine       │
               │  - Foreground Connection Pool        │
               │  - Background Ingestion Connection   │
               │  - Multi-Core Workload Isolation     │
               └──────────────────────────────────────┘
```

#### Trụ cột 1: Phân tách luồng CPU độc lập (CPU Thread Isolation)
- **Nguyên lý**: Tuyệt đối không cho phép tác vụ nạp ngầm (Background Ingestion) chiếm dụng 100% số lõi CPU của máy tính. Luôn luôn bảo lưu tối thiểu 1 đến 2 lõi CPU (hoặc 25% CPU) cho các truy vấn giao diện (Interactive UI Queries).
- **Cơ chế**:
  - Đối với kết nối nạp ngầm (`csvimport.ts`):
    $$\text{bg\_threads} = \max\left(1, \text{os.cpus().length} - 2\right)$$
    Ví dụ:
    - Máy 4 cores $\to$ Background dùng 2 cores, UI giữ 2 cores.
    - Máy 8 cores $\to$ Background dùng 6 cores, UI giữ 2 cores.
    - Máy 16 cores $\to$ Background dùng 14 cores, UI giữ 2 cores.
    - Máy 2 cores $\to$ Background dùng 1 core, UI giữ 1 core.
  - Nhờ vậy, câu lệnh `SELECT * FROM test_all LIMIT 1000` của DataGrid luôn có 2 cores độc lập để chạy và trả kết quả trong vòng **< 50ms**, ngay cả khi file 40GB đang chuyển đổi ở các core còn lại!

#### Trụ cột 2: Phản hồi giao diện tức thì khi Click (Instant Visual Feedback)
- Khi người dùng click vào bất kỳ tệp nào trong danh sách:
  1. Lập tức đánh dấu `treeNode.isSelected = true` và hiển thị hiệu ứng chọn dòng.
  2. Bật ngay màn hình chờ chuyển tiếp nhẹ:
     - Với tệp đã `ready`: Hiển thị thông điệp *"Đang mở bảng dữ liệu..."* kèm spinner nhỏ hoặc thanh trạng thái mờ (không làm che khuất hoàn toàn nếu dữ liệu load nhanh).
     - Với tệp đang `pending`/`processing`: Hiển thị thông điệp nạp ưu tiên *"Đang ưu tiên nạp tệp..."*.
  3. Tuyệt đối không để xảy ra trạng thái "im lặng" (silent state).

#### Trụ cột 3: Bộ lọc chống nghẽn do Click liên tục (Click-Flood Debounce & Request Trailing)
- Áp dụng cơ chế **Debounce (150ms)** hoặc **Request Superseding (Hủy yêu cầu cũ)**:
  - Khi người dùng click nhiều lần liên tiếp, hệ thống chỉ kích hoạt mở tệp tại click cuối cùng.
  - Các yêu cầu mở tệp trung gian bị hủy bỏ ngay từ tầng giao diện trước khi gửi câu lệnh SQL xuống DuckDB, tránh làm nghẽn hàng đợi truy vấn.

#### Trụ cột 4: Cơ chế nhường quyền tạm thời khi chuyển View (Preemption on View Switch)
- Khi `openDataSourcePath` được kích hoạt bởi người dùng, `MultipleLoadingManager.pause()` sẽ tạm dừng khởi chạy các worker mới.
- Sau khi DataGrid đã render xong 1.000 dòng đầu tiên (hoặc sau timeout an toàn), hàng đợi ngầm mới tiếp tục (`manager.resume()`).

---

### 4. BỔ SUNG CẤU HÌNH TRONG `config.ini`

Bổ sung tham số cấu hình luồng nạp ngầm vào `config.ini`:

```ini
[general]
viewer = toad
language = vi
page_size = 1000
max_concurrent_files = 4
max_concurrent_gb = 1

[duckdb]
max_memory = auto
threads = 0
# Số luồng CPU dành riêng cho nạp file ngầm ('auto' = tự động giữ lại 2 cores cho giao diện)
background_threads = auto
add_raw_event = false

[parquet]
compression = snappy
row_group_size = 100000

[system]
temp_cleanup = true
binary_guard = true
```

* Quy tắc phân tích cấu hình `background_threads`:
  - `auto`: Tự động tính toán $\max(1, \text{cpu\_cores} - 2)$.
  - Số nguyên $\ge 1$: Sử dụng đúng số luồng người dùng chỉ định.
  - Chuỗi lỗi hoặc $\le 0$: Tự động hồi phục về `auto`.

---

### 5. CHI TIẾT CÁC TỆP CẦN ĐIỀU CHỈNH

| STT | Tệp tin | Vị trí / Mục tiêu thay đổi |
| :---: | :--- | :--- |
| **1** | `packages/tad-app/app/portableAppData.ts` | Bổ sung `background_threads` vào `ToadConfig.duckdb`, cập nhật hàm parse/validation và template mặc định. |
| **2** | `packages/reltab-duckdb/src/csvimport.ts` | Trong hàm `applyDuckDbConfig`, tách riêng cấu hình luồng cho background ingestion: áp dụng `SET threads = bg_threads` cho kết nối streaming Parquet. |
| **3** | `packages/tadviewer/src/components/DataSourceSidebar.tsx` | Sửa `handleNodeClick`: Khi click vào tệp đã `ready`, lập tức bật trạng thái loading mở view (*"Đang mở dữ liệu..."*), áp dụng debounce click 150ms. |
| **4** | `packages/tadviewer/src/actions.ts` | Trong `openDataSourcePath`: Luôn hiển thị loading indicator cho đến khi DataGrid render xong dòng đầu tiên (`waitForDataView`). |
| **5** | `packages/tad-app/package.json` | Nâng phiên bản ứng dụng lên **`1.3.18`**. |

---

### 6. MA TRẬN KIỂM THỬ NGHIỆM THU (QA TEST MATRIX)

| Mã kiểm thử | Tình huống kiểm thử | Dữ liệu đầu vào | Kết quả kỳ vọng |
| :--- | :--- | :--- | :--- |
| **TC-1.3.18-01** | Kiểm tra cấu hình `background_threads` | `background_threads = auto` | Hệ thống xác định đúng số CPU cores của máy và áp dụng `SET threads = Total - 2`. |
| **TC-1.3.18-02** | Xem file đã nạp trong khi file 40GB đang chạy | Đang chạy `sample_40gb.csv` (34%), click vào `test_all.jsonl` (đã ready) | Bảng DataGrid hiển thị dữ liệu `test_all.jsonl` tức thì trong vòng **< 300ms**, không bị nghẽn 95 giây. |
| **TC-1.3.18-03** | Phản hồi giao diện khi click file | Click vào bất kỳ file nào trên sidebar | Giao diện lập tức hiển thị trạng thái đang xử lý/mở view, không bao giờ bị im lặng. |
| **TC-1.3.18-04** | Click liên tục nhiều file (Click Flood) | Click liên tục 10 lần vào 5 file khác nhau | Chỉ thực thi tệp cuối cùng được click, các request trước đó được hủy gọn gàng, không nghẽn DuckDB. |
| **TC-1.3.18-05** | Fallback cấu hình không hợp lệ | `background_threads = -99` hoặc `"xyz"` | Tự động hồi phục về `auto` an toàn. |

---

### 7. KẾ HOẠCH TRIỂN KHAI TIẾP THEO
1. Cập nhật mã nguồn theo 4 tệp đã nêu trong Bảng mục 5.
2. Build lại toàn bộ các gói: `reltab-duckdb`, `tadviewer`, `tad-app`.
3. Chạy bộ kiểm thử tự động QA (Test Script v1.3.18).
4. Đóng gói binary **Toad 1.3.18.exe** và phân phối vào thư mục `releases/`.
5. Bàn giao và đối chiếu kiểm thử thực tế.
