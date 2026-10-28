# BÁO CÁO PHÂN TÍCH NGUYÊN NHÂN GỐC & PHƯƠNG ÁN NÂNG CẤP THUẬT TOÁN TÍNH % VÀ CƠ CHẾ MULTIPLE LOADING (v1.3.11)

> **Hệ thống:** TOAD Viewer - Forensic & DFIR Log Analyzer  
> **Phiên bản mục tiêu:** v1.3.11  
> **Vấn đề phản ánh từ người dùng:**  
> 1. Trên phiên bản v1.3.10, cơ chế Multiple Loading đã hình thành nhưng các tệp trong danh sách bị kẹt ở `0%`, không cập nhật tiến độ thực tế.  
> 2. Tệp `Security.evtx` đã được nạp và hiển thị bảng dữ liệu trên màn hình chính DataGrid nhưng trên sidebar bên trái vẫn hiển thị `0%`.  
> 3. Thuật toán tính % (đặc biệt là thuật toán tính % đã thiết kế trước đó cho load đơn tệp) chưa được đồng bộ và phản ánh trực quan lên thanh Sidebar.

---

## 1. PHÂN TÍCH NGUYÊN NHÂN GỐC (ROOT CAUSE ANALYSIS)

Sau khi đối soát toàn bộ luồng dữ liệu từ CSDL DuckDB (Main Process) qua IPC tới React UI (Renderer Process), phát hiện **3 nguyên nhân gốc cốt lõi**:

```
[ DuckDB Native Ingest (Main Process) ]
       │
       ├─ (A) EVTX Ingest: child_process.execFileSync khóa cứng Node.js Event Loop!
       │      → Không gửi được IPC "toad-ingest-progress" trong suốt quá trình decode EVTX.
       │
       ├─ (B) File nhỏ (<1MB như output_1000.csv): DuckDB load chỉ mất 5ms!
       │      → Watcher chu kỳ 1000ms chưa kịp lấy mẫu thì tệp đã nạp xong.
       │
       ▼  (IPC: "toad-ingest-progress")
[ electronRenderMain.tsx: MultipleLoadingManager.handleIngestProgress ]
       │  → Cập nhật item.percent và gọi notify()
       ▼
[ DataSourceSidebar.tsx: Blueprint Tree Component ]
       │
       └── (C) KHÓA ĐÓNG BĂNG JSX TĨNH (Static JSX Closure Bug):
              * treeNode.label được khởi tạo 1 lần duy nhất bằng JSX tĩnh lúc mở thư mục:
                label = renderFileNodeLabel(node, "pending", 0)
              * Khi manager.notify() gọi forceUpdate(), React chỉ render lại DataSourceSidebar
                nhưng truyền lại mảng `treeState` cũ chứa các React Element JSX tĩnh!
              * Blueprint Tree không bao giờ gọi lại renderFileNodeLabel.
              => Mọi tệp VĨNH VIỄN HIỂN THỊ "0%" VÀ THANH XANH 4% TRÊN MÀN HÌNH!
```

### 1.1. Nguyên nhân 1 (Trực quan UI): Khóa đóng băng JSX tĩnh trong Blueprint Tree
- Trong `DataSourceSidebar.tsx`:
  - Khi mở rộng một thư mục (`handleNodeExpand`), mã nguồn gọi:
    ```tsx
    treeNode.childNodes = childNodes.map((childNode) => {
      const childPath = extendDSPath(dsPath, childNode.id);
      return dsNodeTreeNode(dsc, childPath, childNode);
    });
    ```
  - Trong `dsNodeTreeNode`:
    ```tsx
    label: isFile ? renderFileNodeLabel(dsNode, status, percent) : dsNode.displayName
    ```
  - Kết quả trả về là một đối tượng JSX tĩnh (React Element) được lưu trực tiếp vào trường `label` của `treeNode`.
  - Khi `MultipleLoadingManager` chuyển trạng thái (`pending` ➔ `processing` ➔ `ready`) hoặc nhận sự kiện tiến độ %, hàm `notify()` kích hoạt `forceUpdate()` của Sidebar.
  - Tuy nhiên, `Blueprint3.Tree` nhận prop `contents={treeState}`. Các nút con trong `treeState` vẫn giữ nguyên tham chiếu đến đối tượng JSX `label` ban đầu (chứa chữ `0%` và class `ds-status-pending`).
  - Do đó, dù bên dưới DuckDB đã nạp xong, giao diện cây thư mục bên trái không bao giờ tự vẽ lại nhãn tệp!

### 1.2. Nguyên nhân 2: Lệch pha giữa mở tệp trên DataGrid và Quản lý Hàng đợi (Sync Gap)
- Khi người dùng click vào `Security.evtx`, hệ thống kích hoạt `actions.openDataSourcePath(...)` để mở tệp lên DataGrid chính.
- Bảng dữ liệu được hiển thị trên DataGrid tức thì. Tuy nhiên, luồng mở tệp chính của ứng dụng chưa gửi tín hiệu `markReady` ngược lại cho `MultipleLoadingManager`.
- Đồng thời, trạng thái của tệp đang mở trong `appState.viewState.dsPath` chưa được `DataSourceSidebar` liên kết để tự động hiển thị trạng thái `ready` (chữ màu đen/trắng sáng, ẩn `0%`).

### 1.3. Nguyên nhân 3: Thuật toán tính % trong Ingestion Engine (`csvimport.ts`)
- **Tệp EVTX bị block đồng bộ**:
  Đoạn mã:
  ```ts
  child_process.execFileSync(toadCore, ["evtx-dump", filePath, tempJsonl], ...);
  ```
  Sử dụng `execFileSync` chặn hoàn toàn luồng chính của Node.js trong suốt thời gian giải mã EVTX (có thể từ 1-5 giây). Do luồng chính bị nghẽn, các bộ đếm thời gian (`setInterval`), IO Watcher và IPC Renderer đều bị đóng băng, không thể phát đi các mốc tiến độ trung gian.
- **Tệp nhỏ hoàn tất siêu tốc**:
  Với các tệp CSV/Log nhỏ (dưới 10.000 dòng, kích thước < 1MB), DuckDB hoàn tất chuyển đổi chỉ trong 5-10ms. Vòng lặp lấy mẫu 1000ms của `watch-io` không kịp phát sinh mẫu trước khi tác vụ kết thúc, dẫn đến việc thiếu sự chuyển tiếp mượt mà từ `0%` lên `100% (ready)`.
- **Tệp Cache Hit**:
  Khi tệp đã có Parquet Cache sẵn, DuckDB trả về bảng ngay tức thì mà không phát sự kiện tiến độ, khiến nhãn tệp không được kích hoạt chuyển sang trạng thái sẵn sàng.

---

## 2. PHƯƠNG ÁN NÂNG CẤP TOÀN DIỆN (SOLUTION ARCHITECTURE)

### 2.1. Giải pháp 1: Component hóa nhãn tệp động (`FileTreeItemLabel`)
Thay thế hoàn toàn việc gán JSX tĩnh bằng một React Functional Component độc lập và tự phản ứng:
```tsx
export const FileTreeItemLabel: React.FC<{
  dsNode: DataSourceNode;
  dsPath: DataSourcePath;
  isActive: boolean;
}> = ({ dsNode, dsPath, isActive }) => {
  const key = useMemo(() => JSON.stringify(dsPath), [dsPath]);
  const manager = MultipleLoadingManager.getInstance();
  const [item, setItem] = useState(() => manager.getItem(key));

  useEffect(() => {
    const unsub = manager.subscribe(() => {
      setItem(manager.getItem(key));
    });
    return unsub;
  }, [key]);

  // Xác định trạng thái thực tế
  const isReady = isActive || (item && item.status === "ready");
  const isProcessing = !isReady && item && item.status === "processing";
  const isError = item && item.status === "error";
  const percent = item ? item.percent : 0;

  return (
    <div className="ds-file-node-wrapper">
      <div className="ds-file-node-header">
        <span className={`ds-file-node-title ${
          isReady ? "ds-status-ready" : isProcessing ? "ds-status-processing" : isError ? "ds-status-error" : "ds-status-pending"
        }`}>
          {dsNode.displayName}
        </span>
        {isProcessing && <span className="ds-file-node-percent">{Math.round(percent)}%</span>}
        {!isReady && !isProcessing && !isError && <span className="ds-file-node-percent ds-pending-percent">0%</span>}
        {isError && <span className="ds-file-node-error-badge" title={item?.error}>!</span>}
      </div>
      {isProcessing && (
        <div className="ds-file-progress-track">
          <div className="ds-file-progress-fill" style={{ width: `${Math.max(5, Math.min(100, percent))}%` }} />
        </div>
      )}
    </div>
  );
};
```
**Lợi ích đột phá:**
- Nhãn tệp tự đăng ký lắng nghe `MultipleLoadingManager`.
- Khi % thay đổi hoặc trạng thái chuyển sang `ready`, **CHỈ CÓ NHÃN CỦA TỆP ĐÓ TỰ RE-RENDER** ở mức độ O(1), không phải render lại toàn bộ cây thư mục.
- Ngay khi tệp được mở hoặc nạp xong, `0%` và thanh mini xanh tự động biến mất, chữ chuyển màu đen đậm (Light Mode) hoặc sáng rõ (Dark Mode).

### 2.2. Giải pháp 2: Cơ chế `markReady` và Đồng bộ Hai Chiều với AppState
1. Thêm phương thức `markReady(dsPath: DataSourcePath)` vào `MultipleLoadingManager`:
   - Đặt ngay `status = "ready"`, `percent = 100`.
   - Nếu tệp này đang là `activeItem`, giải phóng `activeItem = null` và lập tức kích hoạt tệp tiếp theo trong hàng đợi.
   - Phát thông báo `notify()` tới tất cả UI label.
2. Tích hợp vào `actions.openDataSourcePath` và `actions.replaceCurrentView`:
   - Bất cứ khi nào một tệp được nạp thành công vào DataGrid, lập tức gọi `markReady(dsPath)`.
3. Kiểm tra tệp đang xem hiện tại:
   - Nếu `appState.viewState?.dsPath` khớp với tệp thì tệp đó luôn được coi là `ready` và có độ ưu tiên hiển thị cao nhất.

### 2.3. Giải pháp 3: Nâng cấp Bất đồng bộ Hóa cho Ingestion Engine (`csvimport.ts`)
1. **Chuyển `evtx-dump` sang Bất đồng bộ (Async Child Process)**:
   - Thay `child_process.execFileSync` bằng Promise bọc quanh `child_process.spawn`/`execFile`.
   - Luồng chính Node.js không bao giờ bị nghẽn (0ms blocking).
   - Trong quá trình decode EVTX, phát sự kiện tiến độ từ 5% đến 45% dựa trên dung lượng JSONL tạm sinh ra hoặc bộ đếm thời gian.
   - Giai đoạn DuckDB streaming từ JSONL sang Parquet phát tiếp từ 45% đến 90%.
   - Giai đoạn Indexing và hoàn tất phát từ 90% đến 100%.
2. **Xử lý tệp nhỏ (<1MB) và Cache Hit**:
   - Khi phát hiện tệp nhỏ hoặc Cache Hit, phát ngay thông báo tiến độ ban đầu và hoàn tất nguyên tử, đảm bảo `MultipleLoadingManager` luôn nhận được sự kiện chuyển trạng thái sang `ready`.

---

## 3. KẾ HOẠCH TRIỂN KHAI VÀ NGHIỆM THU (PHASED EXECUTION)

| Bước | Nội Dung Thực Hiện | Tệp Tác Động |
|:---:|---|---|
| **1** | Cập nhật tài liệu Phân tích Nghiệp vụ (BA Specification v1.3.11) | `docs/BA_PHUONG_AN_SUA_CHUA_VA_NANG_CAP_v1.3.11.md` |
| **2** | Cập nhật `MultipleLoadingManager.ts` (Thêm `markReady`, tăng cường khớp tên tệp, auto-drain queue) | `packages/tadviewer/src/MultipleLoadingManager.ts` |
| **3** | Chuyển đổi nhãn cây thư mục sang React Component động `FileTreeItemLabel` | `packages/tadviewer/src/components/DataSourceSidebar.tsx` |
| **4** | Tích hợp đồng bộ trạng thái khi mở tệp trên DataGrid | `packages/tadviewer/src/actions.ts` |
| **5** | Bất đồng bộ hóa EVTX Ingestion & Phát tiến độ mượt mà | `packages/reltab-duckdb/src/csvimport.ts` |
| **6** | Build TypeScript packages (`reltab-duckdb`, `tadviewer`, `tad-app`) | Toàn bộ workspace |
| **7** | Đóng gói bản phát hành `Toad.exe` v1.3.11 và QA kiểm thử toàn diện | `Toad.exe`, `releases/toad_v1.3.11_portable.exe` |

