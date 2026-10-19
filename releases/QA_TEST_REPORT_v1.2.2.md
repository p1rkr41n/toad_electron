# BÁO CÁO KIỂM THỬ QA & BIÊN BẢN BÀN GIAO TOAD v1.2.2

- **Sản phẩm**: TOAD - Fast Tabular & Log Data Viewer
- **Phiên bản**: `v1.2.2`
- **Tác giả / Author**: `HelloKittyXamKinLung`
- **Thời gian hoàn thiện**: 17/10/2026 - 14:54:50
- **Trạng thái QA**: **100% PASS (13/13 Tiêu chí kiểm thử đạt chuẩn)**

---

## 1. Vị trí các tệp bàn giao (Release Binaries v1.2.2)

| Tên tệp | Vị trí | Dung lượng | Mô tả |
| :--- | :--- | :--- | :--- |
| **`Toad.exe`** | [`Toad.exe`](file:///d:/Shared_UserData/Downloads/tad/Toad.exe) | **92.05 MB** | File chạy trực tiếp chính thức (vừa build xong) |
| **`toad_v1.2.2_portable.exe`** | [`toad_v1.2.2_portable.exe`](file:///d:/Shared_UserData/Downloads/tad/releases/toad_v1.2.2_portable.exe) | **92.05 MB** | Bản Portable lưu trữ chính thức v1.2.2 |
| **`Toad.exe` (Releases)** | [`Toad.exe`](file:///d:/Shared_UserData/Downloads/tad/releases/Toad.exe) | **92.05 MB** | Bản sao lưu release chính |

---

## 2. Chi tiết 2 tính năng nâng cấp mới trong phiên bản 1.2.2

### 2.1. Đồng bộ danh sách cột trên bảng phụ (Columns Sidebar) theo bảng chính
- **Thứ tự tự nhiên theo bảng chính (Table Order)**:
  - Bảng phụ `Columns` giờ đây tự động hiển thị các cột theo đúng thứ tự đang xuất hiện trên bảng chính (`displayColumns`).
  - Khi một hoặc nhiều cột mới được sinh ra từ bảng chính (ví dụ: `str8`, `str9`, ... sau khi chạy Regex hoặc trích xuất):
    - Cột mới sẽ **ngay lập tức xuất hiện ở cuối danh sách** của bảng phụ này, đúng theo vị trí cột ở bảng chính.
    - Không còn bị xáo trộn vị trí nhảy lung tung lên đầu theo thứ tự chữ cái ABC.
  - Các cột bị ẩn (nếu có) được liệt kê gọn gàng tiếp theo ở phía sau để người dùng có thể tích chọn hiển thị bất kỳ lúc nào.
  - Người dùng có thể nhấp vào tiêu đề **Column** để chuyển đổi qua lại giữa:
    - `Theo bảng chính (Table Order)`: Đồng bộ 100% thứ tự cột bảng chính.
    - `Theo A-Z`: Sắp xếp bảng chữ cái.

### 2.2. Nhấp đúp chuột (Double click) để đổi tên cột trực tiếp tại bảng phụ
- **Cách sử dụng**:
  - Tại bảng phụ `Columns`, di chuột vào tên cột bất kỳ (có hiển thị tooltip gợi ý *"Nhấp đúp chuột để đổi tên cột"*).
  - **Nhấp đúp chuột (Double click)** vào tên cột: ô lập tức chuyển sang ô nhập liệu (`input text`) nổi bật với viền xanh và tự động bôi đen chữ.
  - Nhập tên mới mong muốn (ví dụ: đổi `str8` thành `Client_IP`, đổi `str9` thành `HTTP_Method`).
  - Nhấn **`Enter`** hoặc **click chuột ra ngoài (`onBlur`)**: Tên cột mới được lưu ngay lập tức!
  - Nhấn **`Escape`**: Hủy chỉnh sửa, giữ nguyên tên cũ.
- **Đồng bộ toàn diện trên toàn bộ giao diện**:
  - Tiêu đề cột trên **bảng chính (SlickGrid header)** đổi sang tên mới ngay lập tức.
  - Tên hiển thị trên **bảng phụ (Columns Sidebar)** đổi sang tên mới.
  - Các dropdown khác như **Pivot, Sắp xếp (Sort), Gom nhóm (Aggregations), Lọc (Filter), Định dạng (Format)** đều hiển thị đồng bộ theo tên mới.
  - Tên đổi được duy trì bền vững kể cả khi DuckDB nạp lại dữ liệu hoặc cuộn xem các trang tiếp theo.

---

## 3. Kết quả kiểm thử tự động (13/13 Tests Passed)

```text
================================================================
       TOAD v1.2.2 - QA COLUMN SYNC & RENAME TEST SUITE         
================================================================

--- TEST 1: Schema.withDisplayName Inline Modification ---
[PASS] Initial displayName of str0 is "str0"
[PASS] Updated displayName of str0 is "Client IP Address"
[PASS] str1 displayName remains untouched
[PASS] Columns count unchanged (3 columns)

--- TEST 2: Column Synchronization with Main Table Display Order ---
Synced Column IDs order: [
  'Timestamp',
  'Tot Bwd Pkts',
  'str8',
  'Subflow Bwd Byts',
  'HiddenCol'
]
[PASS] First column matches main table order (Timestamp)
[PASS] Second column matches main table order (Tot Bwd Pkts)
[PASS] Newly generated column str8 matches main table order (3rd position)
[PASS] Hidden/Other columns placed neatly after displayed columns
[PASS] Hidden column still included in column selector
[PASS] All 5 columns accounted for without omission or duplicate

--- TEST 3: Multi-column Renaming Integrity ---
[PASS] str0 has "Client IP Address"
[PASS] str1 has "Request Timestamp"
[PASS] raw_event has "Raw Nginx Log"

================================================================
        RESULT: 13/13 V1.2.2 TESTS PASSED!         
================================================================
```
