# BÁO CÁO KIỂM THỬ QA & BIÊN BẢN BÀN GIAO TOAD v1.2.1

- **Sản phẩm**: TOAD - Fast Tabular & Log Data Viewer
- **Phiên bản**: `v1.2.1`
- **Tác giả / Author**: `HelloKittyXamKinLung`
- **Ngày hoàn thiện**: 17/10/2026
- **Trạng thái QA**: **100% PASS (15/15 Tiêu chí kiểm thử đạt chuẩn)**

---

## 1. Vị trí các tệp bàn giao (Release Binaries v1.2.1)

| Tên tệp | Vị trí | Dung lượng | Mô tả |
| :--- | :--- | :--- | :--- |
| **`Toad.exe`** | [`Toad.exe`](file:///d:/Shared_UserData/Downloads/tad/Toad.exe) | **92.04 MB** | Bản chạy trực tiếp chính thức mới nhất |
| **`toad_v1.2.1_portable.exe`** | [`toad_v1.2.1_portable.exe`](file:///d:/Shared_UserData/Downloads/tad/releases/toad_v1.2.1_portable.exe) | **92.04 MB** | Bản phát hành độc lập v1.2.1 lưu trữ |
| **`Toad.exe` (Releases)** | [`Toad.exe`](file:///d:/Shared_UserData/Downloads/tad/releases/Toad.exe) | **92.04 MB** | Bản sao lưu release chính |

---

## 2. Chi tiết các cải tiến trọng tâm trong Toad v1.2.1

### 2.1. Tự động kiểm tra $X_{max}$ để chống trùng lặp cột `strX` khi áp dụng Regex nhiều lần
- **Vấn đề ở bản cũ**: Mỗi lần bấm Apply Regex, hệ thống luôn sinh ra các cột `str0`, `str1`... Nếu người dùng áp dụng Regex lần thứ hai trên cột khác (hoặc mẫu pattern khác), các cột `str0`, `str1` cũ sẽ bị ghi đè hoặc xung đột tên.
- **Giải pháp trong v1.2.1**:
  - Hệ thống tự động quét tất cả các cột hiện có trong bảng khớp mẫu `/^str(\d+)$/i`.
  - Tìm ra giá trị lớn nhất $X_{max}$:
    - Nếu bảng chưa có cột `str`: $X_{max} = -1 \to$ Bắt đầu từ `str0`.
    - Nếu bảng đã có `str0, str1`: $X_{max} = 1 \to$ Bắt đầu từ `str2`.
    - Nếu bảng đã có `str0..str4`: $X_{max} = 4 \to$ Bắt đầu từ `str5`.
  - **Live Preview thông minh**: Ngay trên hộp thoại Regex, giao diện sẽ hiển thị trực quan các tên trường sẽ được sinh ra (ví dụ: `str2`, `str3`), kèm thông báo chú thích màu cam: *(Tự động tiếp tục từ strX để tránh trùng lặp với các cột regex trước)*.

### 2.2. Bổ sung đầy đủ vào danh sách Quản lý Cột (`Columns`) như một cột dữ liệu chính thức
- Sau khi Regex được áp dụng qua DuckDB Engine:
  - DuckDB `VIEW` mới được tạo với `SELECT *, regexp_extract(...) AS strX`.
  - `newBaseSchema` cập nhật đồng bộ toàn bộ metadata kiểu dữ liệu của các cột `strX`.
  - Các cột mới được tự động thêm vào:
    1. **Bảng hiển thị chính (DataGrid)** ở cuối bảng.
    2. **Thanh Sidebar quản lý cột (Columns)**: Xuất hiện đầy đủ trong danh sách cột với checkbox Show được bật sẵn.
    3. Hỗ trợ đầy đủ mọi tính năng của Toad như một cột dữ liệu bản xứ: **Ẩn/Hiện (Show/Hide)**, **Pivot**, **Sắp xếp (Sort)**, **Gom nhóm (Aggregations)**, **Lọc (Filter)**, và **Định dạng (Format)**.
    4. Người dùng có thể tiếp tục mở hộp thoại Regex (`Alt + R`) và chọn chính các cột `strX` vừa sinh ra để bóc tách tiếp các tầng dữ liệu con.

---

## 3. Kết quả kiểm thử QA chi tiết (Automated Test Suite)

Bộ kiểm thử tại [`test_qa_v121_regex.js`](file:///C:/Users/huydq/.gemini/antigravity-ide/brain/be954341-c330-4fa4-a1a0-725b4de9dd24/scratch/test_qa_v121_regex.js) đã chạy và nghiệm thu thành công:

```text
================================================================
        TOAD v1.2.1 - QA MULTI-ROUND REGEX & COLUMNS TEST       
================================================================

--- TEST 1: startIdx Calculation Across Different Schemas ---
[PASS] No strX columns -> startIdx = 0
[PASS] str0, str1 present -> startIdx = 2
[PASS] str0..str3 present -> startIdx = 4
[PASS] str9 is max -> startIdx = 10
[PASS] Case-insensitive detection: Str5 is max -> startIdx = 6

--- TEST 2: Multi-Round Regex Extraction on DuckDB ---
[PASS] Round 1 startIdx is 0
Columns after Round 1: [ 'id', 'raw_event', 'str0', 'str1' ]
[PASS] Round 1 generated str0 and str1
Round 2 detected max str index, starting at: str2
[PASS] Round 2 startIdx is 2 (str2) without colliding with str0, str1
Columns after Round 2: [ 'id', 'raw_event', 'str0', 'str1', 'str2', 'str3', 'str4' ]
[PASS] All 7 columns present: id, raw_event, str0, str1, str2, str3, str4
[PASS] All str0..str4 exist simultaneously
Sample extracted row 1: {
  id: 1,
  str0: '93.180.71.3',
  str1: '17/May/2015:08:05:32 +0000',
  str2: 'GET',
  str3: '/downloads/product_1',
  str4: '304'
}
[PASS] str0 = IP
[PASS] str1 = Time
[PASS] str2 = Method
[PASS] str3 = URL
[PASS] str4 = Status Code

================================================================
        RESULT: 15/15 V1.2.1 TESTS PASSED!         
================================================================
```
