# Phương Án Triển Khai: NSIS Portable Splash Screen (`Toad is jumping...`)

## Mục tiêu
Loại bỏ khoảng "im lặng tuyệt đối" (`SetSilent silent`) khi người dùng double-click [`Toad.exe`](file:///d:/Shared_UserData/Downloads/_Software_Installers/toad/Toad.exe) bản portable. Khi khởi chạy, ảnh splash Win32 kèm dòng chữ **`Toad is jumping...`** sẽ hiển thị ngay lập tức (< 0.1s) trong lúc NSIS giải nén ~350 MB ra thư mục tạm, trước khi bàn giao sang cửa sổ Electron chính.

---

## Thay đổi đề xuất

### 1. Tài nguyên ảnh Splash
#### [NEW] [splash.bmp](file:///d:/Shared_UserData/Downloads/_Software_Installers/toad/tad-master/packages/toad-app/buildRes/splash.bmp)
* Tạo từ logo gốc [`icon.png`](file:///d:/Shared_UserData/Downloads/_Software_Installers/toad/tad-master/packages/toad-app/buildRes/icon.png).
* **Định dạng bắt buộc:** Windows **BMP 24-bit** (không dùng PNG/JPG, không alpha channel) để plugin `BgImage` của NSIS vẽ trực tiếp.
* **Thiết kế:** Kích thước gọn `480x280` (hoặc `500x300`), nền tối/sáng đồng bộ thương hiệu TOAD, logo ở trung tâm/trên và dòng text:
  > `Toad is jumping...`

---

### 2. Cấu hình đóng gói `electron-builder`
#### [MODIFY] [package.json](file:///d:/Shared_UserData/Downloads/_Software_Installers/toad/tad-master/packages/toad-app/package.json#L265-L267)
Thêm `"splashImage": "buildRes/splash.bmp"` vào block `"build.portable"`:

```diff
     "portable": {
-      "artifactName": "Toad ${version}.${ext}"
+      "artifactName": "Toad ${version}.${ext}",
+      "splashImage": "buildRes/splash.bmp"
     },
```

* **Cơ chế hoạt động:**
  * [`NsisTarget.js`](file:///d:/Shared_UserData/Downloads/_Software_Installers/toad/tad-master/node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js#L237-L239) truyền `SPLASH_IMAGE` vào [`portable.nsi`](file:///d:/Shared_UserData/Downloads/_Software_Installers/toad/tad-master/node_modules/app-builder-lib/templates/nsis/portable.nsi#L11-L25).
  * NSIS bỏ `SetSilent silent`, vẽ ngay `splash.bmp` qua `BgImage::SetBg` / `BgImage::Redraw` trong `.onGUIInit` **trước khi bắt đầu giải nén**, và tự động đóng (`BgImage::Destroy`) ngay trước `ExecWait` để mở `Toad.exe` unpacked.
  * Không làm thay đổi nội dung `app.asar` hay cấu hình Electron Fuses.

---

## Kế hoạch kiểm chứng (Verification Plan)

### Đóng gói
Chạy script build chuẩn của dự án:
```powershell
.\dist_package.ps1
```
Xác nhận `npm run dist` đóng gói thành công `Toad-<version>-x64-portable.exe` / `Toad.exe` mà không phát sinh lỗi NSIS.

### Kiểm tra thực tế (Manual Verification)
1. Double-click `Toad.exe` vừa build.
2. Xác nhận ảnh splash chứa chữ **`Toad is jumping...`** xuất hiện gần như tức thì (< 0.1s).
3. Xác nhận khi giải nén xong, ảnh splash tự biến mất và cửa sổ Electron chính của TOAD mở lên bình thường.

---

## Lưu ý phạm vi
* Phương án này chỉ xử lý giai đoạn chờ giải nén NSIS cho bản single-file `.exe` portable (không áp dụng cho bản `.zip` giải nén sẵn).
* Khoảng trắng ngắn giữa lúc splash NSIS tắt và lúc React mount xong có thể tiếp tục xử lý ở pha sau bằng loading shell trong [`index.html`](file:///d:/Shared_UserData/Downloads/_Software_Installers/toad/tad-master/packages/toad-app/html/index.html).

