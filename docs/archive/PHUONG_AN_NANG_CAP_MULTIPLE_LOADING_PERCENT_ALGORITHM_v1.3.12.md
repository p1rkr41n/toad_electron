# BÁO CÁO PHÂN TÍCH NGUYÊN NHÂN GỐC & PHƯƠNG ÁN NÂNG CẤP THUẬT TOÁN TÍNH % VÀ CƠ CHẾ MULTIPLE LOADING (v1.3.12)

> **Hệ thống:** TOAD Viewer - Forensic & DFIR Log Analyzer  
> **Phiên bản mục tiêu:** v1.3.12  
> **Ngày lập:** 28/10/2026  
> **Trạng thái:** Phương án kỹ thuật chi tiết phục vụ triển khai và QA  
> **Bối cảnh phản hồi từ người dùng:**  
> 1. Trên phiên bản v1.3.11, thuật toán tính toán loading gốc trên mỗi tệp (vốn áp dụng cho loading 1 tệp với tỷ lệ đọc đĩa IO, trừ lùi 10%, tốc độ MB/s và ETA) dường như biến mất khỏi tầm mắt người dùng.  
> 2. Thanh loading trên danh sách tệp (cột bên trái) vẫn không chạy, bị đứng im ở `0%` (tệp `output_1000.csv` có vạch xanh 0%, `Security.evtx` và `System.evtx` vẫn hiện chữ xám 0%).  
> 3. Tệp `Security.evtx` đã mở và hiển thị bảng dữ liệu DataGrid ở màn hình chính nhưng tệp cùng tên trong thư mục `data_sample` vẫn hiển thị `0%`.

---

## 1. PHÂN TÍCH NGUYÊN NHÂN GỐC CHI TIẾT (DEEP ROOT CAUSE ANALYSIS)

Dựa trên việc kiểm tra toàn bộ lịch sử mã nguồn (từ commit `c70aa748` ở bản v1.3.7.4 đến `ee043599` ở bản v1.3.11) và phân tích log thực thi thực tế trong file `toad.log`:

```text
[09:12:14.211] [MultipleLoading] Bat dau xu ly file: output_1000.csv
[09:12:14.359] [MultipleLoading] Hoan tat nạp file output_1000.csv -> Bang: output_1000 (148 ms)
[09:12:14.412] [MultipleLoading] Bat dau xu ly file: Security.evtx
[09:12:14.435] [MultipleLoading] Hoan tat nạp file Security.evtx -> Bang: Security_1 (23 ms - Cache hit!)
[09:12:14.486] [MultipleLoading] Bat dau xu ly file: System.evtx
[09:12:17.381] [MultipleLoading] Hoan tat nạp file System.evtx -> Bang: System (2.9s)
```

Tất cả các tệp đều thực tế đã được DuckDB nạp thành công 100%, nhưng giao diện lại không cập nhật. Bốn nguyên nhân kỹ thuật cốt lõi được xác định như sau:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                    NGUYÊN NHÂN GỐC TẠI PHIÊN BẢN v1.3.11                         │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 1. Triệt tiêu IngestProgressDialog (AppPane.tsx line 172: return null)          │
│    → Load tệp đơn (File > Open, CLI) không còn hiển thị Speed/ETA/-10% dialog.   │
│                                                                                  │
│ 2. Lỗi tham chiếu đối tượng trong React State (Object Mutation Bailout):         │
│    MultipleLoadingManager sửa đổi trực tiếp thuộc tính trên cùng instance:       │
│      targetItem.status = "processing"; targetItem.percent = info.percent;        │
│    FileTreeItemLabel thực hiện: setItem(manager.getItem(key))                    │
│    → React kiểm tra Object.is(oldState, newState) === true → BỎ QUA RE-RENDER!   │
│    → Nhãn tệp bị kẹt vĩnh viễn ở trạng thái ban đầu (0% pending/processing).     │
│                                                                                  │
│ 3. Lệch cấu trúc Key giữa Root Source và Child Folder Node:                      │
│    - Root File:  {"sourceId": "D:\\...\\Security.evtx", "path": ["."]}           │
│    - Child Node: {"sourceId": "D:\\...\\data_sample",   "path": [".", "Sec..."]} │
│    → Dùng JSON.stringify(dsPath) làm key khiến 2 thực thể bị coi là khác nhau;   │
│      bảng DataGrid mở Security.evtx nhưng không đồng bộ sang node con của folder.│
│                                                                                  │
│ 4. Hardcoded "0%" text cho mọi tệp pending & Chu kỳ Watcher 1000ms:              │
│    - In cứng "0%" cho mọi tệp chưa nạp (isPending).                              │
│    - File nhỏ nạp siêu tốc (148ms) xong trước chu kỳ lấy mẫu 1s của watch-io,    │
│      khiến nhãn không kịp nhận tick trung gian và bị lỗi (2) chặn thông báo 100%.│
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. NGUYÊN TẮC GIỮ NGUYÊN THUẬT TOÁN TÍNH % CỦA NGƯỜI DÙNG

Hệ thống cam kết bảo toàn 100% bản sắc và logic toán học của thuật toán do người dùng thiết kế ban đầu:

### 2.1. Nền tảng đo lường Native Process Disk Read IO (TOAD Core Rust)
- Công cụ: `toad-core watch-io <pid> 1000`
- Đọc biến nhớ kernel không tốn CPU/IO: `GetProcessIoCounters` -> `counters.read_transfer_count`.
- Tính số byte đọc gia tăng:
  $$\Delta\text{ReadFromStart} = \max\left(0, \text{currentTotalRead} - \text{initialReadBytes}\right)$$

### 2.2. Quy tắc trừ lùi 10% (-10% Scaling Rule)
- Tỷ lệ đọc vật lý thực tế:
  $$\text{readRatio} = \min\left(1.0, \max\left(0, \frac{\Delta\text{ReadFromStart}}{\text{srcBytes}}\right)\right)$$
- **Công thức hiển thị %**:
  $$\text{percent} = \min\left(90, \max\left(2, \text{round}\left(\text{readRatio} \times 90\right)\right)\right)$$
- **Phân bổ giai đoạn**:
  - `0% – 90%`: Dành trọn vẹn cho quá trình đọc và streaming dữ liệu thô từ đĩa vào DuckDB.
  - `90% – 100%`: Dành cho giai đoạn finalize cấu trúc Parquet columnar index, tạo bảng VIEW và kích hoạt DataGrid. Không bao giờ để thanh tiến trình nhảy vọt lên 100% khi tệp chưa thực sự sẵn sàng.

### 2.3. Tốc độ làm mịn (Exponential Moving Average) & Thời gian ước tính (ETA)
- Làm mịn tốc độ tức thời:
  $$\text{smoothedSpeedMBs} = \text{smoothedSpeedMBs} \times 0.7 + \text{instantSpeed} \times 0.3$$
- Thời gian dự kiến hoàn thành:
  $$\text{remainingBytes} = \max\left(0, \text{srcBytes} - \Delta\text{ReadFromStart}\right)$$
  $$\text{etaSec} = \text{round}\left(\frac{\text{remainingBytes}}{1024 \times 1024 \times \text{smoothedSpeedMBs}}\right)$$
- Trạng thái trực quan:
  - Khi $\text{percent} < 90\%$: `Reading input: X MB / Y MB`
  - Khi $\text{percent} \ge 90\%$: `Finalizing Parquet index & loading dataset...`

---

## 3. PHƯƠNG ÁN TRIỂN KHAI NÂNG CẤP KỸ THUẬT (CHI TIẾT MÃ NGUỒN)

### 3.1. Phục hồi và hoàn thiện hiển thị tiến trình (In-Situ Loading & Dialog Sync)
1. **Khôi phục `IngestProgressDialog` trong `AppPane.tsx`**:
   - Khi người dùng mở tệp đơn từ menu/dòng lệnh: Hiển thị hộp thoại đo lường quen thuộc với đầy đủ Speed (MB/s), ETA (s), % tiến độ và Status text theo đúng thuật toán gốc.
2. **Nâng cấp `center-loading-pane` của màn hình chính**:
   - Khi người dùng click vào tệp trong danh sách Multiple Loading: Hiển thị Card Loading hiện đại ở giữa màn hình chính với đầy đủ:
     - Tên tệp đang nạp.
     - Thanh ProgressBar mượt mà.
     - Số `% completed` theo thời gian thực.
     - Tốc độ đọc: `Speed: X.X MB/s`.
     - Thời gian còn lại: `ETA: Xs`.
     - Tình trạng: `Reading input: X MB / Y MB`.

### 3.2. Khắc phục triệt để lỗi React Bailout (Immutable State Updates)
Trong `MultipleLoadingManager.ts`:
- **Tuyệt đối không mutate đối tượng in-place**:
  Mỗi khi thay đổi trạng thái hoặc nhận giá trị % mới, luôn sinh ra một đối tượng mới hoàn toàn (clone):
  ```ts
  const current = this.files.get(key);
  if (current) {
    const updated: FileIngestItem = {
      ...current,
      status: nextStatus,
      percent: nextPercent,
      speedMBs: info.speedMBs ?? current.speedMBs,
      etaSec: info.etaSec ?? current.etaSec,
      version: (current.version || 0) + 1,
    };
    this.files.set(key, updated);
    this.notify();
  }
  ```
- **Tại `FileTreeItemLabel.tsx`**:
  Quản lý trực tiếp `version` và bản sao `item` mới:
  ```tsx
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const unsub = manager.subscribe(() => {
      setVersion((v) => v + 1);
    });
    return unsub;
  }, [manager]);
  ```
  Nhờ `setVersion((v) => v + 1)`, mỗi lần `notify()` phát ra, React chắc chắn sẽ re-render component và hiển thị % mới nhất ngay trong frame tiếp theo.

### 3.3. Đồng bộ hóa theo đường dẫn vật lý thực tế trên đĩa (Canonical Path Mapping)
- Cung cấp hàm chuẩn hóa đường dẫn đĩa vật lý:
  $$\text{canonicalPath} = \text{path.resolve}(\text{targetPath}).\text{toLowerCase}()$$
- `MultipleLoadingManager` lưu trữ thêm bảng tra cứu `canonicalPathMap: Map<string, string[]>` (từ đường dẫn file thực tế sang danh sách các `key` tương ứng).
- Khi tệp `D:\...\data_sample\Security.evtx` được nạp sẵn sàng (dù được gọi từ nút Root hay từ nút con của folder `data_sample`), tất cả các nút đại diện cho cùng tệp vật lý này đều được chuyển sang trạng thái `ready 100%` đồng thời.

### 3.4. Chuẩn hóa hiển thị nhãn tệp cây thư mục (Sidebar UX)
1. **Tệp đang chờ (`pending`)**:
   - Chữ màu xám (`#94a3b8`).
   - **Không in số `0%` tĩnh** gây hiểu nhầm rằng tiến trình bị đơ.
2. **Tệp đang nạp (`processing`)**:
   - Chữ màu xanh chủ đạo (`#0284c7`).
   - Hiển thị số `%` chạy động liên tục theo thuật toán IO gốc: `2%`, `15%`, `48%`, `85%`,...
   - Thanh tiến trình mini bên dưới nhãn tệp có animation mượt mà:
     `style={{ width: `${Math.max(5, Math.min(100, percent))}%` }}`
3. **Tệp đã nạp xong (`ready`)**:
   - Chữ màu đen đậm (`#0f172a` trong Light Mode) hoặc trắng sáng (`#f8fafc` trong Dark Mode).
   - Số `%` và thanh tiến trình mini lập tức ẩn đi hoàn toàn.
4. **Tệp gặp lỗi (`error`)**:
   - Chữ màu đỏ cảnh báo (`#ef4444`) cùng biểu tượng dấu chấm than `!`.

---

## 4. KẾ HOẠCH TRIỂN KHAI VÀ KIỂM THỬ (QA / ACCEPTANCE PLAN)

| STT | Bước Thực Hiện | File Chỉnh Sửa / Tác Động | Kết Quả Mong Đợi |
|:---:|---|---|---|
| 1 | Cập nhật `MultipleLoadingManager.ts` | `MultipleLoadingManager.ts` | Clone đối tượng bất biến khi cập nhật state; bổ sung `canonicalPath` mapping; truyền đủ `speedMBs`, `etaSec`. |
| 2 | Cập nhật `DataSourceSidebar.tsx` | `DataSourceSidebar.tsx` | `FileTreeItemLabel` phản ứng lập tức với `version counter`; ẩn `0%` ở trạng thái pending; đồng bộ canonical path. |
| 3 | Cập nhật `AppPane.tsx` | `AppPane.tsx` | Hiển thị đầy đủ Speed, ETA, statusText trên cả Single File Ingest Dialog lẫn Main Loading Card. |
| 4 | Cập nhật `csvimport.ts` | `csvimport.ts` | Giữ nguyên 100% công thức -10% scaling, stream JSONL/Parquet bất đồng bộ mượt mà. |
| 5 | Biên dịch và Đóng gói | `tadviewer`, `reltab-duckdb`, `tad-app` | Tạo bản build sạch Toad.exe v1.3.12. |
| 6 | QA Test Suite | Mở `data_sample` (CSV, EVTX) | Xác nhận thanh loading chạy mượt từ 0% đến 100%, số % nhảy liên tục, Speed và ETA hiển thị chuẩn xác, không còn tình trạng kẹt 0%. |

