# BÁO CÁO KIỂM THỬ QA & BIÊN BẢN BÀN GIAO TOAD v1.2.3

- **Sản phẩm**: TOAD - Fast Tabular & Log Data Viewer
- **Phiên bản**: `v1.2.3`
- **Tác giả / Author**: `HelloKittyXamKinLung`
- **Thời gian hoàn thiện**: 17/10/2026 - 15:04:05
- **Trạng thái QA**: **100% PASS (7/7 Tiêu chí kiểm thử đạt chuẩn)**

---

## 1. Vị trí các tệp bàn giao (Release Binaries v1.2.3)

| Tên tệp | Vị trí | Dung lượng | Mô tả |
| :--- | :--- | :--- | :--- |
| **`Toad.exe`** | [`Toad.exe`](file:///d:/Shared_UserData/Downloads/tad/Toad.exe) | **92.05 MB** | Bản chạy trực tiếp chính thức mới nhất |
| **`toad_v1.2.3_portable.exe`** | [`toad_v1.2.3_portable.exe`](file:///d:/Shared_UserData/Downloads/tad/releases/toad_v1.2.3_portable.exe) | **92.05 MB** | Bản Portable lưu trữ chính thức v1.2.3 |
| **`Toad.exe` (Releases)** | [`Toad.exe`](file:///d:/Shared_UserData/Downloads/tad/releases/Toad.exe) | **92.05 MB** | Bản sao lưu release chính |

---

## 2. Chi tiết tính năng nâng cấp trong phiên bản 1.2.3

### Tìm kiếm & Gợi ý tên cột thông minh trong bộ lọc (Filter Column Autocomplete)
- **Vấn đề trước đây**: Ô chọn cột trong phần Filter là thẻ `<select>` mặc định của trình duyệt, người dùng chỉ có thể bấm 1 ký tự đầu rồi phải cuộn lướt tìm kiếm thủ công trong danh sách hàng chục/hàng trăm cột, rất mất thời gian.
- **Tính năng mới trong v1.2.3**:
  1. **Gõ vài ký tự là gợi ý ngay**: 
     - Người dùng chỉ cần nhấp vào ô cột trong Filter và gõ bất kỳ cụm từ nào (ví dụ: gõ `pkt`, `byts`, `ip`, `time`, `flag`, `str`...).
     - Dropdown lập tức hiển thị các cột khớp với từ khóa tìm kiếm (hỗ trợ tìm kiếm chuỗi con `matchFrom: 'any'` và không phân biệt chữ hoa/chữ thường `ignoreCase: true`).
  2. **Hiển thị kèm kiểu dữ liệu trực quan**:
     - Danh sách gợi ý hiển thị rõ ràng: Tên hiển thị cột bên trái và Kiểu dữ liệu (`VARCHAR`, `INTEGER`, `TIMESTAMP`...) bên phải, giúp người dùng nhận biết ngay kiểu dữ liệu để chọn toán tử lọc phù hợp.
  3. **Thao tác nhanh bằng bàn phím**:
     - Người dùng có thể dùng phím mũi tên **Lên / Xuống (Up / Down)** để di chuyển qua các gợi ý và nhấn **`Enter`** để chọn ngay lập tức mà không cần dùng chuột.

---

## 3. Kết quả kiểm thử tự động (7/7 Tests Passed)

```text
================================================================
    TOAD v1.2.3 - QA SEARCHABLE FILTER COLUMN AUTOCOMPLETE     
================================================================

--- TEST 1: Fuzzy & Substring Search by "pkt" ---
Search "pkt" results: [
  'Subflow Bwd Pkts',
  'Subflow Fwd Pkts',
  'Tot Bwd Pkts',
  'Tot Fwd Pkts',
  'TotLen Bwd Pkts',
  'TotLen Fwd Pkts'
]
[PASS] Found exactly 6 columns containing "pkt"
[PASS] All matched columns contain "pkt"

--- TEST 2: Substring Search by "byts" ---
Search "byts" results: [ 'Subflow Bwd Byts', 'Subflow Fwd Byts' ]
[PASS] Found exactly 2 columns containing "byts"
[PASS] Contains both Subflow Byts columns

--- TEST 3: Regex Generated Columns Search by "str" ---
Search "str" results: [ 'str8' ]
[PASS] Found str8 column

--- TEST 4: Case-Insensitive Search by "time" and "flag" ---
Search "time" results: [ 'Timestamp' ]
[PASS] Matches "Timestamp" case-insensitively
Search "FLAG" results: [ 'SYN Flag Cnt', 'URG Flag Cnt' ]
[PASS] Matches both SYN Flag Cnt and URG Flag Cnt

================================================================
        RESULT: 7/7 V1.2.3 TESTS PASSED!         
================================================================
```
