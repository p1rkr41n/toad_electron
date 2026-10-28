# TOAD VIEWER - BÀI HỌC KINH NGHIỆM VÀ QUY TẮC KỸ THUẬT PHÒNG CHỐNG LỖI HỒI QUY
> **Tài liệu:** EXP.md (Engineering Experiences, Post-Mortem Analysis & Best Practices)  
> **Dự án:** TOAD Viewer - Forensic & SOC Log Analyzer  
> **Phiên bản ghi nhận:** v1.3.12 -> v1.3.14  
> **Ngày lập:** 28/10/2026  
> **Phạm vi áp dụng:** Toàn bộ kiến trúc DuckDB Engine, Hàng đợi nạp ngầm, Vòng đời View và Giao diện SlickGrid/React.

---

## 1. TỔNG QUAN VÀ BỐI CẢNH SỰ CỐ THỰC TẾ

Trong quá trình phát triển tính năng nạp đồng thời nhiều tệp lớn (Multiple Ingestion) và hiển thị tiến trình trong Canvas (In-Canvas Processing View) ở các bản v1.3.12 – v1.3.13, hệ thống đã phát sinh hai sự cố nghiêm trọng trên môi trường kiểm thử với tệp dung lượng lớn (`sample_40gb.csv` và `sample_40gb.json`):

1. **Sự cố 1 (Kẹt thẻ nạp 0% trên tệp đã Ready)**:
   - Tệp `sample_40gb.csv` đã hoàn tất chuyển đổi sang Parquet (trên sidebar trạng thái đã là Ready, không còn thanh %), nhưng khi người dùng bấm vào xem thì Canvas trung tâm bị kẹt vô hạn ở thẻ *"Loading sample_40gb.csv... 0% completed"*, trong khi tệp tiếp theo `sample_40gb.json` đang xử lý ngầm ở 47%.
2. **Sự cố 2 (Sập Renderer Process - Fatal Crash)**:
   - Sau khi thực hiện sửa đổi giao diện để bỏ thẻ nạp 0%, ứng dụng bị sập hoàn toàn với hộp thoại lỗi đỏ:
   ```
   [Main Instruction] Renderer Error: Cannot read properties of null (reading 'getLength')
   [Content] TypeError: Cannot read properties of null (reading 'getLength')
       at .../tadviewer/src/components/DataGrid.tsx:209:1
       at .../tadviewer/src/components/DataGrid.tsx:206:1
       at d (.../tadviewer/src/components/DataGrid.tsx:808:1)
   ```

---

## 2. CHU TRÌNH PHÁT SINH LỖI LIÊN HOÀN (THE WHACK-A-MOLE ANTI-PATTERN)

Đây là bài học đắt giá nhất về việc **"Vá vội triệu chứng bề mặt mà không phân tích gốc rễ"**:

```
[GỐC RỄ THỰC SỰ: DuckDB bị khóa đơn luồng bởi file JSON 40GB chạy ngầm]
                            │
                            ▼
           [Truy vấn lấy Schema/Data của file CSV bị dồn ứ]
                            │
                            ▼
       [Triệu chứng 1: Thẻ Loading 0% bị kẹt trên màn hình]
                            │
                            ▼
       ┌────────────────────────────────────────────────────────┐
       │ HÀNH ĐỘNG VÁ SAI LẦM 1:                                │
       │ Chặn không cho set activeLoadingFile nếu file đã Ready │
       └────────────────────────────┬───────────────────────────┘
                                    │
                                    ▼
       [Triệu chứng 2: Card 0% mất đi, nhưng dataView vẫn null, │
        AppPane rơi vào nhánh else -> Hiện thẻ trống 'Ready for  │
        Analysis' dù người dùng ĐÃ chọn file]                   │
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │ HÀNH ĐỘNG VÁ SAI LẦM 2:                                │
       │ Nới lỏng điều kiện AppPane: Ép render DataGrid khi      │
       │ (viewState.dataView !== null || baseSchema !== null)   │
       └────────────────────────────┬───────────────────────────┘
                                    │
                                    ▼
       [HẬU QUẢ TAI HẠI: DataGrid mount khi dataView vẫn NULL   │
        -> Gọi dataView.getLength() -> RENDERER CRASH SẬP APP!] │
```

---

## 3. GIẢI PHẪU 4 TRỤ CỘT GỐC RỄ KỸ THUẬT (THE 4 ROOT CAUSE PILLARS)

### Trụ cột 1: Ngộ nhận về cơ chế chạy đồng thời của DuckDB Engine (Lock Contention)
- **Bản chất**: Trình điều khiển DuckDB Node.js (`duckdb-async` / N-API) dù cho phép gọi `db.connect()` tạo nhiều instance Connection logic, nhưng **tất cả đều trỏ vào cùng một C++ Database Instance duy nhất**.
- Khi một tác vụ convert nặng chạy ngầm (`COPY (SELECT ...) TO '...parquet'`), DuckDB kích hoạt cơ chế độc quyền, dồn toàn bộ CPU threads và khóa nội bộ Engine.
- Các truy vấn nhẹ của giao diện (`DESCRIBE ...` lấy schema hay `SELECT ... LIMIT 1000` lấy dòng hiển thị) dù chỉ tốn < 20ms nhưng **bị xếp hàng chờ sau tác vụ 40GB (mất 50 - 80 giây)**.
- **Bài học**: Database engine đơn luồng không thể tự điều phối ưu tiên. Ứng dụng tầng trên (Application layer) bắt buộc phải chủ động nhượng quyền (pause/yield) tác vụ ngầm để nhường tài nguyên cho UI.

---

### Trụ cột 2: Khoảng hở vòng đời bất đồng bộ (Lifecycle Desynchronization Gap)
- Trong `actions.ts`:
  - `replaceCurrentView()` chỉ thực hiện nạp `baseSchema` rồi tạo `new ViewState({ baseSchema, dataView: null })` và kết thúc ngay (`Promise<void>` resolve).
  - Việc lấy các dòng dữ liệu thực tế (`dataView`) lại do `PivotRequester.ts` lắng nghe `onStateChange` và gửi truy vấn bất đồng bộ `sendDataRequest()` sau đó.
- **Khoảng hở tử huyệt**: Có một khoảng thời gian mà `viewState !== null`, `baseSchema !== null`, nhưng **`dataView === null`**.
- Khối `finally` của `openDataSourcePath`:
  ```ts
  try {
    manager.pause();
    await replaceCurrentView(...);
  } finally {
    manager.resume(); // <--- GỌI QUÁ SỚM!
  }
  ```
  Vì `replaceCurrentView` kết thúc khi `dataView` còn chưa nạp, `manager.resume()` kích hoạt lại hàng đợi nền quá sớm. Tác vụ 40GB tiếp theo lập tức lao vào cướp DuckDB trước khi `PivotRequester` kịp lấy 1.000 dòng đầu.

---

### Trụ cột 3: Vi phạm bất biến trong Component Tree (Invariant Violation)
- `DataGrid.tsx` và `SlickGrid` được thiết kế dựa trên một **Bất biến (Invariant)**:
  > *"Component DataGrid chỉ được phép render khi đã có dataView hợp lệ chứa các phương thức `.getLength()`, `.getItem()`, `.schema`."*
- Bằng chứng trong mã nguồn:
  ```ts
  const colWidthsMap = getInitialColWidthsMap(getColumnFormatter, dataView!); // Dấu chấm than (!)
  var nRows = dataView.getLength(); // Không kiểm tra null!
  ```
- Khi `AppPane.tsx` nới lỏng điều kiện kiểm tra thành `(dataView !== null || baseSchema !== null)`, nó đã trực tiếp vi phạm bất biến của `DataGrid`, dẫn đến crash `Cannot read properties of null (reading 'getLength')`.

---

### Trụ cột 4: Floating Promises (Thiếu `await`) trong Event Handler
- Tại `DataSourceSidebar.tsx`:
  ```tsx
  const handleNodeClick = async (...) => {
    actions.openDataSourcePath(dsPath, stateRef); // <--- THIẾU AWAIT!
  };
  ```
- Hàm trả về Promise nhưng không được `await`. Khi người dùng click chuột liên tục giữa các file trên sidebar, các luồng `openDataSourcePath` chạy song song chồng chéo, gây Race Condition trên `stateRef`. Truy vấn của file click trước có thể về sau và ghi đè dữ liệu lên file click sau.

---

## 4. DANH MỤC CÁC ĐIỂM RỦI RO TIỀM ẨN TRÊN TOÀN BỘ CODEBASE (AUDIT CATALOG)

Qua rà soát toàn bộ mã nguồn, các điểm rủi ro sau đây cần đặc biệt lưu ý và phòng ngừa:

| Mã Rủi Ro | Vị Trí Tệp Tin | Đoạn Mã Tiềm Ẩn Nguy Cơ | Phân Tích Nguy Cơ Crash | Giải Pháp Phòng Ngừa Bắt Buộc |
|:---:|---|---|---|---|
| **RSK-01** | `actions.ts:909-911` | `const oldQueryView = qvu as QueryView;`<br>`const oldHistData = oldQueryView.histoMap[colId];` | Khi ViewState mới khởi tạo, `queryView` là `null`. Tương tác Brush Histogram lúc này sẽ crash `null.histoMap`. | Kiểm tra `if (!oldQueryView \|\| !oldQueryView.histoMap) return;` |
| **RSK-02** | `GridPane.tsx:116` & `GridPane.tsx:145` | `...viewState?.baseSchema.columnMetadata[column]` | Dùng Optional Chaining nửa vời: Nếu `viewState` undefined thì `(undefined).columnMetadata` crash ngay. | Sửa thành `viewState?.baseSchema?.columnMetadata?.[column]` |
| **RSK-03** | `PivotRequester.ts:449-455` | `dreq.then((dataView) => { ... vs.set("dataView", syncedDataView) })` | Không kiểm tra `viewState` hiện tại có còn đúng là view lúc gửi `dreq` hay không. Dẫn đến nạp nhầm data file cũ vào file mới. | Kiểm tra `if (vs.dsPath !== requestDsPath) return;` |
| **RSK-04** | `FilterEditorRow.tsx:644` | `const columnChoices = schema.columns;` | Interface cho phép `schema?: Schema`, nhưng code gọi thẳng `.columns` không guard. | Thêm `if (!schema \|\| !schema.columns) return null;` |
| **RSK-05** | `csvimport.ts:596` & `1062` | `const dbConn = await db.connect();`<br>*(không có `close()`)* | Mỗi lần import mở một native connection mới mà không đóng, gây rò rỉ connection pool. | Luôn bọc trong `try ... finally { dbConn.close(); }` hoặc dùng pool. |
| **RSK-06** | `packages/tad-app/package.json` | `"version": "1.3.12.1"` *(4 chữ số)* | `electron-updater` chỉ hỗ trợ SemVer 3 phần (`MAJOR.MINOR.PATCH`). Định dạng 4 chữ số làm sập app khi khởi động. | Tuyệt đối tuân thủ chuẩn SemVer 3 phần (ví dụ `1.3.14`). |

---

## 5. BỘ QUY TẮC KỸ THUẬT BẮT BUỘC (MANDATORY ENGINEERING RULES)

Để ngăn chặn 100% các lỗi tương tự trong tương lai, mọi thành viên và Agent khi phát triển trên dự án TOAD bắt buộc phải tuân thủ nghiêm ngặt 5 quy tắc sau:

### Quy tắc 1: Không bao giờ "Vá triệu chứng" bằng cách nới lỏng Guard của Component con
- **Nghiêm cấm**: Thấy component con không hiển thị -> nới lỏng điều kiện của component cha cho phép giá trị `null/undefined` lọt vào.
- **Chuẩn mực**: Nếu component con yêu cầu `dataView`, component cha **chỉ được mount khi `dataView` đã sẵn sàng 100%**. Nếu chưa có, hiển thị trạng thái chuyển tiếp (Loading Spinner / Skeleton).

### Quy tắc 2: Nguyên tắc Mở View Nguyên Tử (Atomic View Transition)
- Quá trình mở một tệp (`openDataSourcePath`) chỉ được coi là hoàn tất khi **cả Schema VÀ 1.000 dòng đầu tiên đã nằm trong bộ nhớ**.
- **Bắt buộc sử dụng cơ chế chờ**:
  ```ts
  try {
    manager.pause(); // Khóa hàng đợi nền
    await replaceCurrentView(path, stateRef); // Nạp Schema
    await waitForDataView(stateRef, 8000);   // Chờ 1.000 dòng đầu nạp xong (< 20ms)
  } finally {
    setActiveLoadingFile(null, stateRef);
    manager.resume(); // Chỉ mở lại hàng đợi nền khi người dùng ĐÃ thấy bảng!
  }
  ```

### Quy tắc 3: Mô hình Ưu tiên Tuyệt đối cho Giao diện (UI-First Concurrency Model)
- Giao diện người dùng (UI) có quyền ưu tiên số 1 (Priority P0). Tác vụ chạy nền (Background Ingestion) có quyền ưu tiên P1.
- Bất cứ khi nào người dùng click chọn file, chuyển tab, sắp xếp, lọc cột:
  - Hàng đợi ngầm phải lập tức tạm dừng (`pause`).
  - DuckDB phục vụ xong yêu cầu của UI (< 20ms).
  - Hàng đợi ngầm mới được phép chạy tiếp (`resume`).

### Quy tắc 4: Lập trình phòng thủ toàn diện (Defensive Null-Safety)
- **Nghiêm cấm sử dụng Non-null Assertion (`!`)** trên các thuộc tính bất đồng bộ (`dataView!`, `schema!`, `queryView!`).
- Mọi hàm tiện ích tính toán độ rộng cột, render cell, lấy formatter phải có guard check ngay dòng đầu:
  ```ts
  if (!dataView || typeof dataView.getLength !== "function" || !dataView.schema) {
    return DEFAULT_FALLBACK;
  }
  ```

### Quy tắc 5: Nghiêm ngặt tuân thủ SemVer 3 phần
- Phiên bản ứng dụng trong `package.json` bắt buộc có định dạng `X.Y.Z` (ví dụ `1.3.14`).
- Không đặt phiên bản 4 phần (`1.3.12.1`) vì sẽ phá vỡ thư viện `builder-util-runtime` của Electron.

### Quy tắc 6: Xử lý phần mở rộng tệp an toàn đa dấu chấm (Safe Compound Extension Extraction)
- **Nghiêm cấm dùng `indexOf('.')` từ đầu chuỗi tên file** để bóc tách đuôi file. Thao tác này sẽ cắt sai toàn bộ các file có từ 2 dấu chấm trở lên (ví dụ: `a.b.c.csv` thành `.b.c.csv`, `data.2024.10.csv` thành `.2024.10.csv`) khiến module quét thư mục loại bỏ nhầm file hợp lệ của người dùng.
- **Tiêu chuẩn xử lý chuẩn:**
  1. Duyệt kiểm tra các đuôi ghép đặc biệt có đăng ký (`.csv.gz`, `.tsv.gz`).
  2. Mặc định luôn dùng `path.extname(filePath)` để lấy extension chuẩn tại dấu chấm cuối cùng (`lastIndexOf('.')`).

---

## 6. CHECKLIST TỰ KIỂM TRA TRƯỚC KHI ĐÓNG GÓI (PRE-RELEASE QA CHECKLIST)

Trước khi phát hành bất kỳ bản build nào, phải đối chiếu đầy đủ checklist:

- [ ] **Kiểm tra SemVer**: `package.json` phiên bản đúng định dạng `X.Y.Z`.
- [ ] **Kiểm tra Null-Safety**: Không có cảnh báo `TS2304` hoặc gọi hàm trên biến có khả năng `null/undefined`.
- [ ] **Kiểm thử Đồng quy Đa tệp**:
  - [ ] Nạp đồng thời 1 file lớn (>5GB) và 1 file nhỏ.
  - [ ] Trong khi file lớn đang nạp ngầm, click xem file nhỏ -> Bảng hiện ngay dưới 50ms, không kẹt 0%.
  - [ ] Chuyển đổi click liên tục qua lại giữa các file -> Không có lỗi đỏ Renderer, không vỡ cột.
- [ ] **Kiểm tra Khởi động sạch**: File `.exe` sau khi đóng gói khởi chạy độc lập trên máy ảo / thư mục sạch không phát sinh lỗi DLL thiếu hoặc lỗi main process.

---
*Tài liệu này là cẩm nang kỹ thuật chuẩn của dự án TOAD Viewer, được lưu giữ vĩnh viễn trong kho mã nguồn để định hướng mọi hoạt động refactor và nâng cấp hệ thống.*

