# KẾ HOẠCH CHI TIẾT KHẮC PHỤC 2 LỖI TOAD (V2.0.14)
## LỖI NÚT BATCH TEST DUPLICATE ICON & LỖI PIPELINE WEBPACK BUNDLE KHIẾN APP CHƯA CẬP NHẬT STR001

> **Phiên bản mục tiêu:** Toad v2.0.14  
> **Ngày lập kế hoạch:** 31/10/2026  
> **Trạng thái:** Chờ phê duyệt (Chưa sửa code)

---

## I. TỔNG QUAN HIỆN TRẠNG & BẰNG CHỨNG THỰC TẾ

### 1. Lỗi 1: Nút Batch Test bị lặp 2 icon Play (`[ ▶  ▶ Test ]`)
* **Hình ảnh phản ánh:** Ảnh `media_1793421804950_1596800a.png`
* **Vị trí mã nguồn:** `tad-master/packages/tadviewer/src/components/RegexDialog.tsx:2140-2150`
  ```tsx
  <Button
    small
    intent={Intent.NONE}
    style={{ minHeight: "22px", height: "22px", fontSize: "11px", padding: "0 8px", borderRadius: "4px" }}
    icon={<ParseSplitIcon size={12} />}
    loading={isValidating}
    onClick={handleRunBatchTest}
  >
    ▶ Test
  </Button>
  ```
* **Hiện tượng:** Nút sử dụng prop `icon={<ParseSplitIcon size={12} />}` (vốn đã render một vector SVG hình tam giác play), đồng thời trong phần nội dung text lại chèn thêm ký tự Unicode `▶ ` trước từ `"Test"`.
* **Hậu quả:** Giao diện hiển thị 2 hình tam giác liên tiếp: `[ ▶  ▶ Test ]`, gây mất thẩm mỹ và lỗi UI layout.

---

### 2. Lỗi 2: Ứng dụng chưa hiển thị `str001`, badge vẫn là `v2.0.10` và cột hiển thị `str1, str10..`
* **Hình ảnh phản ánh:** Ảnh `media_1793422375798_938fd2b9.png` (danh sách cột `str1, str10, str11, str12, str13, str14`) và ảnh `media_1793415299744_eeb2f522.png` (badge Parse Columns hiển thị `v2.0.10`).
* **Bằng chứng điều tra mã bundle JavaScript (`tad-app/dist/tadapp.bundle.js`):**
  - `tadapp.bundle.js mtime`: `2026-10-31 02:05:25 UTC` (tức 09:05 sáng).
  - Chuỗi `v2.0.13` trong bundle: **`false`**
  - Chuỗi `str001` trong bundle: **`false`**
  - Chuỗi `formatStrColName` trong bundle: **`false`**
  - Các phiên bản tìm thấy trong bundle: **`['v2.0.5', 'v2.0.10']`**
* **Nguyên nhân gốc rễ (Root Cause):**
  - Mã nguồn TypeScript (`tadviewer/src/actions.ts` và `RegexDialog.tsx`) đã lập trình xong logic `str001` và vượt qua 80/80 test QA.
  - Tuy nhiên, trong script đóng gói `dist_package.ps1`:
    ```powershell
    Set-Location "D:\Shared_UserData\Downloads\tad\tad-master\packages\tad-app"
    & npm.cmd run dist
    ```
    Lệnh `npm run dist` thực chất là gọi `electron-builder --publish=never`. Lệnh này **chỉ lấy các file đã có sẵn trong thư mục `tad-app/dist` để nén vào `.exe`**, mà **không tự động gọi Webpack** (`npm run build-prod`).
  - Do `tad-app` chưa được Webpack biên dịch lại từ lúc 09:05 sáng (phiên bản v2.0.10), file `Toad 2.0.13.exe` tạo ra chứa toàn bộ mã JavaScript cũ của bản v2.0.10.
  - Do đó, khi người dùng khởi chạy ứng dụng, giao diện vẫn là v2.0.10, cột vẫn là `str1, str10, str11...` và nút test vẫn bị lỗi icon kép.

---

## II. MA TRẬN ẢNH HƯỞNG & PHẠM VI SỬA ĐỔI

| Thành phần | Đường dẫn file | Nội dung thay đổi | Mức độ rủi ro |
| :--- | :--- | :--- | :--- |
| **Giao diện Button** | `packages/tadviewer/src/components/RegexDialog.tsx` | Đổi `▶ Test` thành `Test` tại dòng 2148 | Rất thấp (Không ảnh hưởng logic) |
| **Badge Version** | `packages/tadviewer/src/components/RegexDialog.tsx` | Đổi `v2.0.13` thành `v2.0.14` tại dòng 1106 | Không có rủi ro |
| **Cấu hình Package** | `packages/tad-app/package.json` | Cập nhật version lên `2.0.14` | Rất thấp |
| **Tài liệu Hướng dẫn** | `packages/tad-app/html/userdocs/quickstart.html` | Thêm mục v2.0.14 trong Release Notes | Không có rủi ro |
| **Pipeline Đóng gói** | `dist_package.ps1` | Thêm bước `npm run build-prod` cho `tad-app` và assert bundle | Rất thấp (Tăng độ tin cậy) |
| **Bộ QA Tự động** | `test_deep_integration_qa.js` | Thêm **Suite S** kiểm thử button UI & bundle integrity | Không có rủi ro |

---

## III. CHI TIẾT KỸ THUẬT CÁC BƯỚC TRIỂN KHAI

### 1. Bước 1: Sửa lỗi hiển thị nút Batch Test (RegexDialog.tsx)
- **Hiện tại:**
  ```tsx
  <Button
    small
    intent={Intent.NONE}
    style={{ minHeight: "22px", height: "22px", fontSize: "11px", padding: "0 8px", borderRadius: "4px" }}
    icon={<ParseSplitIcon size={12} />}
    loading={isValidating}
    onClick={handleRunBatchTest}
  >
    ▶ Test
  </Button>
  ```
- **Sửa thành:**
  ```tsx
  <Button
    small
    intent={Intent.NONE}
    style={{ minHeight: "22px", height: "22px", fontSize: "11px", padding: "0 8px", borderRadius: "4px" }}
    icon={<ParseSplitIcon size={12} />}
    loading={isValidating}
    onClick={handleRunBatchTest}
  >
    Test
  </Button>
  ```
- **Kết quả:** Nút hiển thị gọn gàng: `[ ▶ Test ]` với đúng 1 icon SVG duy nhất, căn chỉnh lề hoàn hảo.

---

### 2. Bước 2: Nâng cấp phiên bản v2.0.14
- Cập nhật badge trong modal `RegexDialog.tsx` thành `v2.0.14`.
- Cập nhật `packages/tad-app/package.json` lên `2.0.14`.
- Bổ sung ghi chú phát hành v2.0.14 vào `quickstart.html`.

---

### 3. Bước 3: Sửa đổi và chuẩn hóa Pipeline đóng gói (`dist_package.ps1`)
Cập nhật script `dist_package.ps1` để tự động hóa toàn diện quá trình biên dịch và xác thực bundle:
- **Bước 1**: Biên dịch `tadviewer` (`npm run build`).
- **Bước 2**: Biên dịch Webpack Production cho `tad-app` (`npm run build-prod`) để tái tạo `tadapp.bundle.js` và `main.bundle.js`.
- **Bước 3**: Tự động xác thực tính toàn vẹn: Kiểm tra `tadapp.bundle.js` bắt buộc phải chứa chuỗi `v2.0.14` và `str001` trước khi cho phép đóng gói.
- **Bước 4**: Chạy `electron-builder` (`npm run dist`).
- **Bước 5**: Đồng bộ hóa file thực thi `Toad 2.0.14.exe` và `Toad.exe` ra thư mục gốc và thư mục `releases/`.

---

### 4. Bước 4: Kiểm thử chuyên sâu QA (Test Suite S)
Bổ sung **Suite S** vào `test_deep_integration_qa.js`:
- **Test S.1**: Xác thực mã nguồn `RegexDialog.tsx` không còn chuỗi `▶ Test` (chỉ còn `Test` kèm `ParseSplitIcon`).
- **Test S.2**: Xác thực `tadapp.bundle.js` chứa chuỗi `v2.0.14` và `str001`.
- **Test S.3**: Xác thực đồng bộ version `2.0.14` giữa `package.json`, `quickstart.html`, và `RegexDialog.tsx`.
- **Test S.4**: Chạy lại toàn bộ bộ test hiện có để đảm bảo tỷ lệ pass đạt **100% (84/84 tests)**.

---

## IV. TIÊU CHÍ NGHIỆM THU (ACCEPTANCE CRITERIA)

1. **Giao diện nút Test:** Nút hiển thị chính xác `[ ▶ Test ]` (1 icon tam giác SVG + text `"Test"`), không còn bị nhân đôi icon.
2. **Huy hiệu Version:** Header modal hiển thị rõ ràng huy hiệu xanh: **`v2.0.14`**.
3. **Danh sách Cột tự động:** Khi người dùng mở file dữ liệu và trích xuất cột:
   - Các cột tự động sinh mang tiền tố: `str001`, `str002`, `str003`, ..., `str010`.
   - Thứ tự sắp xếp bảo đảm đúng thứ tự toán học và chữ cái (`str001` < `str002` < ... < `str009` < `str010`).
   - Cột `str10` **không bao giờ** nằm cạnh `str1`.
4. **Tính toàn vẹn của File thực thi:** File `Toad.exe` và `Toad 2.0.14.exe` được đóng gói với mtime hiện tại và nạp đúng bundle v2.0.14.

