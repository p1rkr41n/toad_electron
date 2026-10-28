# TÀI LIỆU PHÂN TÍCH NGHIỆP VỤ & PHƯƠNG ÁN TRIỂN KHAI HỆ THỐNG TOAD (v1.3.13)
> **Dự án:** TOAD Viewer - Công cụ Phân tích Điều tra Số & Giám sát Log (DFIR / SOC Log Analyzer)  
> **Phiên bản mục tiêu:** v1.3.13 (Non-blocking In-Canvas Processing View & Seamless Multi-Tasking)  
> **Ngày lập tài liệu:** 28/10/2026  
> **Trạng thái:** Đặc tả nghiệp vụ BA & Kế hoạch triển khai chính thức  

---

## 1. TỔNG QUAN BỐI CẢNH & MỤC TIÊU DỰ ÁN

Tại phiên bản v1.3.12, người dùng tiến hành kiểm thử thực tế với tệp dung lượng lớn `sample_40gb.csv` và xác nhận:
- Thuật toán tính toán đo đạc đọc đĩa IO, công thức trừ lùi 10%, hiển thị tốc độ `Speed: 798.0 MB/s`, đếm lùi `ETA: 43s`, và thanh tiến trình `15%` trên sidebar đã hoạt động rất chính xác và mượt mà.
- Tuy nhiên, giao diện tiến trình lại xuất hiện dưới dạng một **Popup Modal Dialog (`<Dialog>`)** ở chính giữa màn hình với lớp phủ che mờ (backdrop).
- **Vấn đề phát sinh**: Modal này chiếm quyền điều khiển và chặn (block) toàn bộ sự kiện click chuột. Người dùng đang mở tệp `output_1000.csv` ở bảng phía sau nhưng không thể bấm vào tệp đó, không thể chọn tệp khác trên sidebar, và bị buộc phải chờ tệp 40GB nạp xong mới tiếp tục làm việc được.
- **Yêu cầu nghiệp vụ từ người dùng**: Chuyển đổi ô processing này hoạt động trực tiếp trong canvas bảng của từng tệp, tuyệt đối không được chặn click vào các tệp khác trên sidebar.

### Mục tiêu phiên bản v1.3.13:
1. **Loại bỏ hoàn toàn Modal Dialog (`<Dialog>`)**: Không còn popup che khuất màn hình hay backdrop làm mờ và khóa chuột.
2. **Triển khai In-Canvas Processing View**: Toàn bộ thông tin nạp tệp (Tên tệp, ProgressBar, % completed, Speed MB/s, ETA, Reading input X/Y GB) được đưa vào thẻ nạp nằm gọn trong vùng Canvas trung tâm của tệp đó.
3. **Đa nhiệm liền mạch (Seamless Multi-Tasking)**: Người dùng có thể click tự do qua lại giữa các tệp trên sidebar bất kỳ lúc nào. Click vào tệp đã sẵn sàng thì Canvas hiện ngay bảng dữ liệu; click vào tệp đang nạp thì Canvas hiện thẻ nạp với số liệu cập nhật liên tục.
4. **Tự động chuyển tiếp khi nạp xong**: Khi tệp đang nạp đạt 100%, nếu người dùng đang đứng ở Canvas của tệp đó thì thẻ nạp tự động biến mất và bảng dữ liệu DataGrid lập tức hiển thị.

---

## 2. MA TRẬN YÊU CẦU NGHIỆP VỤ (BA SPECIFICATION)

| Mã YC | Hạng Mục Nghiệp Vụ | Mô Tả Yêu Cầu & Bối Cảnh Người Dùng | Tiêu Chí Nghiệm Thu (Acceptance Criteria - AC) | Mức Độ Ưu Tiên |
|:---:|---|---|---|:---:|
| **BA-32** | **Xóa bỏ Modal Popup Chặn Màn Hình (Eliminate Blocking Modal Dialog)** | Loại bỏ hoàn toàn hộp thoại nổi `<Dialog>` và lớp phủ mờ backdrop gây khóa chuột khi nạp tệp. | - Không còn bất kỳ popup modal nào xuất hiện đè lên giao diện khi nạp tệp.<br>- Không có lớp phủ mờ (backdrop) che khuất bảng dữ liệu hay sidebar.<br>- Không khóa chuột, không bẫy focus bàn phím. | **P0 (Blocker)** |
| **BA-33** | **Thẻ Tiến Trình Trong Canvas (In-Canvas Processing View)** | Khi người dùng chọn xem một tệp đang được nạp, toàn bộ thông tin tiến độ được hiển thị chuyên nghiệp trong vùng Canvas bảng của tệp đó. | - Vùng Canvas trung tâm hiển thị: Biểu tượng tệp, Spinner, Tên tệp đang nạp, Tình trạng đọc dữ liệu (ví dụ: `Reading input: 6.71 GB / 40.00 GB`), ProgressBar lớn mượt mà, số `% completed`, `Speed: X.X MB/s`, và `ETA: Xs`.<br>- Bổ sung dòng gợi ý đa nhiệm cho người dùng. | **P0 (Critical)** |
| **BA-34** | **Điều Phối Canvas Theo Ngữ Cảnh Tệp (Per-File Canvas Routing)** | Người dùng click vào tệp nào trên sidebar thì Canvas trung tâm hiển thị đúng trạng thái của tệp đó mà không bị ảnh hưởng bởi tiến trình của tệp khác. | - Bấm tệp `ready` (ví dụ `output_1000.csv`): Canvas lập tức hiển thị DataGrid bảng dữ liệu.<br>- Bấm tệp `processing` (ví dụ `sample_40gb.csv`): Canvas hiển thị Thẻ nạp tiến trình của tệp đó.<br>- Cho phép chuyển đổi tức thì giữa các tệp mà không có độ trễ. | **P0 (Critical)** |
| **BA-35** | **Tự Động Chuyển Tiếp Sang DataGrid Khi Nạp Xong (Graceful Completion Transition)** | Khi tệp nạp ngầm hoàn tất 100% trong DuckDB, hệ thống tự động xử lý chuyển đổi mượt mà. | - Nếu người dùng đang đứng ở Canvas của tệp đó: Thẻ nạp biến mất, DataGrid bảng dữ liệu hiện lên ngay tức khắc.<br>- Nếu người dùng đang xem tệp khác: Tệp nạp ngầm chỉ đổi màu sang đen/sáng trên sidebar, không làm nhảy hay gián đoạn màn hình đang phân tích. | **P1 (High)** |

---

## 3. THIẾT KẾ TRỰC QUAN GIAO DIỆN & LUỒNG TƯƠNG TÁC (UI / UX WORKFLOW)

```
+───────────────────────────────────────────────────────────────────────────────────────────+
│ Toad - [output_1000.csv]                                                      —  □  ×     │
+─────────────────┬─────────────────────────────────────────────────────────────────────────+
│ Data Sources    │ CANVAS TRUNG TÂM                                                        │
│                 │                                                                         │
│ 📄 output_1000  │ [Trạng thái 1: Khi chọn output_1000 (đã nạp xong)]                      │
│    (Sẵn sàng)   │ ┌────────┬───────────┬─────────────┬───────────┬──────────────┬───────────┐ │
│                 │ │ Record │ Time      │ Provider    │ EventID   │ Channel      │ Message   │ │
│ ⏳ sample_40gb  │ ├────────┼───────────┼─────────────┼───────────┼──────────────┼───────────┤ │
│    15% ────     │ │ 1      │ 10:15:20  │ Microsoft   │ 4624      │ Security     │ Logon...  │ │
│                 │ │ 2      │ 10:15:22  │ Microsoft   │ 4672      │ Security     │ Privil... │ │
│ 📄 Security     │ └────────┴───────────┴─────────────┴───────────┴──────────────┴───────────┘ │
│    (Sẵn sàng)   │                                                                         │
│                 │ ───► NGƯỜI DÙNG CLICK VÀO "sample_40gb.csv" TRÊN SIDEBAR ───►          │
│                 │                                                                         │
│                 │ [Trạng thái 2: Khi chọn sample_40gb.csv (đang nạp ngầm)]                │
│                 │ ┌─────────────────────────────────────────────────────────────────────┐ │
│                 │ │                   [ ↻ SPINNER ICON ]                                │ │
│                 │ │              Loading sample_40gb.csv...                             │ │
│                 │ │         Reading input: 6.71 GB / 40.00 GB                           │ │
│                 │ │                                                                     │ │
│                 │ │ [████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 15%            │ │
│                 │ │                                                                     │ │
│                 │ │ 15% completed        Speed: 798.0 MB/s               ETA: 43s       │ │
│                 │ │                                                                     │ │
│                 │ │ 💡 Mẹo: Bạn có thể click vào các tệp khác ở danh sách bên trái      │ │
│                 │ │ để tiếp tục phân tích trong khi tệp này đang được nạp ngầm.         │ │
│                 │ └─────────────────────────────────────────────────────────────────────┘ │
+─────────────────┴─────────────────────────────────────────────────────────────────────────+
```

---

## 4. CHI TIẾT KỸ THUẬT VÀ THAY ĐỔI MÃ NGUỒN

### 4.1. `tadviewer/src/components/AppPane.tsx`
- **Xóa bỏ modal dialog**:
  Loại bỏ hoàn toàn `<IngestProgressDialog />` khỏi component `AppPane`.
- **Cải tiến `center-loading-pane`**:
  ```tsx
  if (activeLoading && activeLoading.isLoading) {
    pivotSidebar = null;
    centerPane = (
      <div className="center-app-pane center-loading-pane">
        <div className="main-loading-card">
          <div className="main-loading-spinner-wrap">
            <Spinner size={48} intent="primary" />
          </div>
          <h3 className="main-loading-title">
            Loading {activeLoading.fileName}...
          </h3>
          <p className="main-loading-subtitle">
            {activeLoading.statusText ||
              "Processing dataset with high-throughput columnar engine..."}
          </p>
          <div className="main-loading-progress-wrap">
            <ProgressBar
              value={Math.max(0.03, Math.min(1, (activeLoading.percent || 0) / 100))}
              intent="primary"
              stripes={true}
            />
            <div className="main-loading-progress-stats">
              <span>{Math.round(activeLoading.percent || 0)}% completed</span>
              {activeLoading.speedMBs !== undefined && activeLoading.speedMBs > 0 && (
                <span>Speed: {activeLoading.speedMBs.toFixed(1)} MB/s</span>
              )}
              {activeLoading.etaSec !== undefined && activeLoading.etaSec > 0 && (
                <span>ETA: {activeLoading.etaSec}s</span>
              )}
            </div>
          </div>
          <div className="main-loading-hint">
            Tip: You can click any other file in the sidebar to analyze it while this dataset continues processing in the background.
          </div>
        </div>
      </div>
    );
  }
  ```

### 4.2. `tadviewer/src/MultipleLoadingManager.ts`
- Đảm bảo trong `handleIngestProgress`:
  Khi nhận được tiến độ %, chỉ cập nhật vào `activeLoadingFile` nếu tệp đang hiển thị trên Canvas trùng khớp với tệp đang nạp.
- Nếu người dùng đang xem bảng của một tệp khác (`viewState`), không làm thay đổi hay gián đoạn hiển thị của bảng đó.

### 4.3. `tadviewer/src/components/DataSourceSidebar.tsx`
- Trong `handleNodeClick`:
  - Khi người dùng click vào tệp `ready`:
    Gọi `actions.setActiveLoadingFile(null, stateRef)` và `actions.openDataSourcePath(...)` để Canvas hiển thị DataGrid ngay lập tức.
  - Khi người dùng click vào tệp `processing` hoặc `pending`:
    Gọi `actions.setActiveLoadingFile(...)` với các thông số hiện tại của tệp để Canvas chuyển sang Thẻ nạp In-Canvas tương ứng.

---

## 5. BẢNG TIÊU CHÍ NGHIỆM THU & TEST MATRIX (QA TEST SUITE)

| Test Case ID | Tình Huống Kiểm Thử (Test Scenario) | Các Bước Thực Hiện | Kết Quả Mong Đợi (Expected Outcome) | Đánh Giá |
|:---:|---|---|---|:---:|
| **TC-1.3.13-01** | **Xác nhận Không Có Modal Backdrop Khi Nạp Tệp Lớn** | Mở tệp lớn (>5GB hoặc `sample_40gb.csv`). | - Không có popup `<Dialog>` nổi lên trên màn hình.<br>- Không có lớp phủ mờ backdrop.<br>- Người dùng có thể di chuột và click tự do trên toàn bộ ứng dụng. | Đạt chuẩn |
| **TC-1.3.13-02** | **Kiểm tra Thẻ Nạp In-Canvas Đầy Đủ Thông Số** | Click vào tệp đang nạp trên sidebar. | - Vùng Canvas giữa hiển thị Thẻ nạp hiện đại.<br>- Hiển thị đầy đủ: Tên tệp, Status text dung lượng GB/MB, ProgressBar, % completed, Speed MB/s, ETA s.<br>- Các chỉ số nhảy mượt theo thời gian thực. | Đạt chuẩn |
| **TC-1.3.13-03** | **Kiểm tra Đa Nhiệm: Chuyển Sang Tệp Khác Trong Lúc Đang Nạp** | Trong khi tệp lớn đang nạp, click vào tệp `output_1000.csv` đã sẵn sàng. | - Canvas giữa lập tức chuyển sang hiển thị bảng DataGrid của `output_1000.csv`.<br>- Người dùng có thể cuộn, xem dữ liệu, lọc cột bình thường.<br>- Tệp lớn trên sidebar vẫn tiếp tục nạp ngầm và tăng dần %. | Đạt chuẩn |
| **TC-1.3.13-04** | **Kiểm tra Tự Động Chuyển Bảng Khi Nạp Xong** | Đứng ở màn hình Thẻ nạp của tệp và chờ tệp hoàn tất 100%. | - Thẻ nạp tự động biến mất.<br>- Bảng dữ liệu DataGrid của tệp lập tức hiển thị với đầy đủ các cột dữ liệu. | Đạt chuẩn |

---

## 6. KẾT LUẬN
Tài liệu này xác lập đầy đủ căn cứ đặc tả BA và giải pháp kỹ thuật cho phiên bản **TOAD v1.3.13**. Toàn bộ kiến trúc được tối ưu hóa cho khả năng đa nhiệm thực thụ trong phân tích điều tra số.
