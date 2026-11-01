# TÀI LIỆU PHÂN TÍCH NGHIỆP VỤ & PHƯƠNG ÁN TRIỂN KHAI HỆ THỐNG TOAD (v1.3.15)
> **Dự án:** TOAD Viewer - Công cụ Phân tích Điều tra Số & Giám sát Log (DFIR / SOC Log Analyzer)  
> **Phiên bản mục tiêu:** v1.3.15 (Systemic Robustness, Connection Cleanup, Stale Query Guard & Full Vulnerability Hardening)  
> **Ngày lập tài liệu:** 28/10/2026  
> **Trạng thái:** Đặc tả nghiệp vụ BA & Kế hoạch triển khai chính thức  

---

## 1. TỔNG QUAN BỐI CẢNH & MỤC TIÊU DỰ ÁN

Dựa trên kết quả phân tích gốc rễ và bài học kinh nghiệm được đúc kết trong tài liệu [`EXP.md`](file:///d:/Shared_UserData/Downloads/tad/EXP.md), hệ thống TOAD Viewer cần tiến hành một đợt chuẩn hóa toàn diện trên các tầng kiến trúc:
- Loại bỏ hoàn toàn các điểm rủi ro tiềm ẩn gây crash ứng dụng (`null/undefined` access).
- Ngăn chặn triệt để hiện tượng dữ liệu truy vấn cũ đè lên file mới khi người dùng chuyển file nhanh (**Stale Query Race Condition**).
- Dọn dẹp rò rỉ kết nối DuckDB C++ native (**Connection Leak Cleanup**).
- Đảm bảo tính nguyên tử trong thao tác click mở file trên Sidebar.

### Mục tiêu phiên bản v1.3.15:
1. **Khắc phục 100% danh mục rủi ro từ RSK-01 đến RSK-05** đã ghi nhận trong `EXP.md`.
2. **Cơ chế Stale Query Guard**: `PivotRequester` chỉ ghi nhận dữ liệu `dataView` nếu view đó vẫn đang là file active hiện tại của người dùng.
3. **Giải phóng kết nối DuckDB**: Mọi connection mở ra trong `csvimport.ts` đều được đóng giải phóng an toàn (`dbConn.close()`).
4. **Phòng thủ đa tầng trên giao diện**: Toàn bộ các component `DataGrid`, `GridPane`, `FilterEditorRow`, `actions.ts` được bọc guard check an toàn tuyệt đối.
5. **Đóng gói phiên bản v1.3.15** chuẩn SemVer 3 phần.

---

## 2. MA TRẬN YÊU CẦU NGHIỆP VỤ (BA SPECIFICATION)

| Mã YC | Hạng Mục Nghiệp Vụ | Mô Tả Yêu Cầu & Bối Cảnh Người Dùng | Tiêu Chí Nghiệm Thu (Acceptance Criteria - AC) | Mức Độ Ưu Tiên |
|:---:|---|---|---|:---:|
| **BA-40** | **Chống Đè Dữ Liệu Cũ Khi Chuyển File Nhanh (Stale Query Guard)** | Khi người dùng click nhanh từ File A sang File B, nếu câu lệnh lấy dữ liệu của File A về sau, hệ thống tuyệt đối không được ghi đè `dataView` của File A vào File B. | - Khi `dreq.then` chạy xong, kiểm tra `requestDsPath === currentDsPath`.<br>- Nếu không khớp, hủy bỏ cập nhật state một cách an toàn.<br>- Bảng dữ liệu luôn luôn khớp 100% với file đang chọn trên sidebar. | **P0 (Blocker)** |
| **BA-41** | **Bảo Vệ Thao Tác Histogram An Toàn (Histogram Brush Guard)** | Người dùng kéo chọn dải giá trị trên biểu đồ Histogram trong bất kỳ thời điểm nào không bao giờ gây crash ứng dụng. | - Kiểm tra `if (!oldQueryView \|\| !oldQueryView.histoMap) return;`.<br>- Thao tác mượt mà, không quăng lỗi `reading 'histoMap'`. | **P0 (Critical)** |
| **BA-42** | **Sửa Lỗi Optional Chaining Nửa Vời Tại GridPane** | Khi truy cập `columnMetadata` trong các sự kiện chọn ô và chọn cột của GridPane, luôn kiểm tra đầy đủ các cấp đối tượng. | - Thay thế `viewState?.baseSchema.columnMetadata` bằng `viewState?.baseSchema?.columnMetadata?.[column]`.<br>- Không có lỗi `reading 'columnMetadata'`. | **P0 (Critical)** |
| **BA-43** | **Phòng Vệ An Toàn Cho FilterEditorRow** | Component dòng điều kiện lọc kiểm tra an toàn danh sách cột trước khi render menu chọn cột. | - `schema && schema.columns ? schema.columns : []`.<br>- Không có lỗi `reading 'columns'`. | **P1 (High)** |
| **BA-44** | **Giải Phóng Bộ Nhớ DuckDB (Connection Leak Cleanup)** | Mọi lệnh import và tạo Parquet cache đóng kết nối native ngay sau khi hoàn thành. | - Bọc các kết nối tạm trong khối `try ... finally { await dbConn.close(); }`.<br>- Không tích tụ connection mồ côi trong tiến trình DuckDB. | **P1 (High)** |
| **BA-45** | **Đồng Bộ Hoá Click Mở Tệp Sidebar & Await** | Thao tác click trên Sidebar được `await` đầy đủ và có cờ khóa chống double-click nhanh. | - Thêm `await actions.openDataSourcePath(...)` trong `handleNodeClick`.<br>- Ngăn chặn kích hoạt nhiều luồng mở file cùng lúc. | **P1 (High)** |

---

## 3. THIẾT KẾ GIẢI PHÁP KỸ THUẬT CHI TIẾT

### 3.1. Stale Query Guard tại `PivotRequester.ts`
Trong `sendDataRequest`:
```ts
const requestDsPath = viewState.dsPath;
const requestTable = (viewState.baseQuery as any)?.tableName;

const dreq = requestDataView(...);
this.pendingDataRequest = dreq;

dreq.then((dataView) => {
  this.pendingDataRequest = null;
  oneref.update(
    stateRef,
    vsUpdate((vs: ViewState) => {
      // KIỂM TRA ĐỒNG BỘ: Chỉ áp dụng nếu view hiện tại vẫn là view lúc gửi yêu cầu
      const curTable = (vs.baseQuery as any)?.tableName;
      if (
        (requestDsPath && JSON.stringify(vs.dsPath) !== JSON.stringify(requestDsPath)) ||
        (requestTable && curTable !== requestTable)
      ) {
        log.warn("PivotRequester: Bỏ qua kết quả truy vấn cũ từ view trước đó.");
        return vs;
      }
      ...
    })
  );
});
```

### 3.2. Histogram Brush Guard tại `actions.ts`
Trong `setHistogramBrushRange`:
```ts
st.updateIn(["viewState", "queryView"], (qvu: unknown) => {
  const oldQueryView = qvu as QueryView;
  if (!oldQueryView || !oldQueryView.histoMap) {
    return qvu;
  }
  const oldHistData = oldQueryView.histoMap[colId];
  if (!oldHistData) {
    return qvu;
  }
  ...
```

### 3.3. An toàn hóa `GridPane.tsx`
Thay thế toàn bộ truy cập không an toàn:
```tsx
const columnData: ColumnData[] = columns.map((column) => ({
  ...(viewState?.baseSchema?.columnMetadata?.[column] || {}),
  columnId: column,
}));
```
và:
```tsx
const columnData = viewState?.baseSchema?.columnMetadata?.[columnId] ?? null;
```

### 3.4. Dọn dẹp Connection trong `csvimport.ts`
Trong `nativeParquetImport`:
```ts
const dbConn = await db.connect();
try {
  await initS3(dbConn);
  ...
} finally {
  try {
    await (dbConn as any).close();
  } catch {}
}
```

---

## 4. MA TRẬN KIỂM THỬ CHẤP NHẬN (QA TEST MATRIX)

| Mã TC | Kịch Bản Kiểm Thử | Các Bước Thực Hiện | Kết Quả Mong Đợi | Trạng Thái |
|:---:|---|---|---|:---:|
| **TC-1.3.15-01** | **Kiểm tra Chuyển File Nhanh (Stale Query Guard)** | 1. Click nhanh File A rồi click ngay lập tức sang File B.<br>2. Chờ cả 2 file nạp xong. | - Màn hình hiển thị chính xác bảng dữ liệu và cột của File B.<br>- Không có hiện tượng cột của File A nhảy vào File B.<br>- Không có crash renderer. | Đạt chuẩn |
| **TC-1.3.15-02** | **Kiểm tra Kéo Dải Histogram An Toàn** | 1. Mở một tệp bất kỳ.<br>2. Ngay khi giao diện vừa hiện, kéo thanh Brush trên Histogram của một cột số liên tục. | - Biểu đồ phản hồi mượt mà.<br>- Không phát sinh lỗi `reading 'histoMap'`. | Đạt chuẩn |
| **TC-1.3.15-03** | **Kiểm tra Mở Filter Editor Trên File Đang Chuyển Đổi** | Bấm mở hộp thoại Filter Editor ngay khi click chọn file. | - Hộp thoại Filter mở trơn tru, danh sách cột hiển thị đúng.<br>- Không có lỗi `reading 'columns'`. | Đạt chuẩn |
| **TC-1.3.15-04** | **Kiểm tra Giải Phóng Connection DuckDB** | Nạp liên tục 15 file CSV/Parquet khác nhau. | - Số lượng connection C++ không bị tích tụ.<br>- Mức chiếm dụng RAM ổn định, không rò rỉ bộ nhớ. | Đạt chuẩn |

---

## 5. KẾT LUẬN
Tài liệu BA v1.3.15 này xác lập cơ sở kỹ thuật hoàn chỉnh để đưa TOAD Viewer lên một tầm cao mới về độ ổn định, loại bỏ triệt để các rủi ro đã đúc kết trong `EXP.md`.

