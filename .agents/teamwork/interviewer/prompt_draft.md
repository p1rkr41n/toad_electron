10 chuyên gia thiết kế và lập trình viên chuyên nghiệp phối hợp với nhau, dựa theo phương án đã duyệt trong `phuong_an_chi_tiet_file_table_search_va_project_rename_v2.4.3.md` để tái cấu trúc lại hệ thống quản lý project của Tad.

Working directory: d:\Shared_UserData\Downloads\tad
Integrity mode: development

Reference plan: C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\phuong_an_chi_tiet_file_table_search_va_project_rename_v2.4.3.md

## Requirements

### R1. Loại bỏ các tính năng Open File... và Open Directory... khỏi Menu
Loại bỏ hoàn toàn các mục `Open File...` và `Open Directory...` khỏi menu `File` trong `tad-master/packages/tad-app/app/appMenu.ts` vì đã lỗi thời so với mô hình Multi-Project Workspace. Thay thế bằng các hành động tích hợp Project Workspace (`Add Files to Active Project...` với `CmdOrCtrl+O`, `Add Folder to Active Project...` với `CmdOrCtrl+Shift+O`).

### R2. Đổi tên Project trực tiếp bằng Double-Click
Cho phép người dùng đổi tên Project trực tiếp bằng thao tác Double-Click vào tiêu đề project trên sidebar (`ProjectNodeLabel`), chuyển sang ô nhập liệu in-place để chỉnh sửa, và nhấn Enter hoặc click ra ngoài (blur) để lưu tên mới vào Ledger mà vẫn giữ nguyên `projectId`.

### R3. Tái cấu trúc bộ lọc tìm kiếm (Search Filter)
- Lọc strictly 100% theo tên file (loại bỏ hoàn toàn logic `projMatches`, không bao giờ khớp theo tên project).
- Lọc in-memory tức thì (0ms latency) trên toàn bộ các project trong workspace.
- Tự động bung mở (expand) các project có file khớp và ẩn các project không có kết quả khi đang nhập từ khóa tìm kiếm; khi xóa từ khóa thì khôi phục lại trạng thái mở/đóng ban đầu.

### R4. Chuyển đổi danh sách file trong project thành Dạng Bảng (Interactive Table Layout)
- Hiển thị danh sách tệp của từng project dưới dạng bảng dữ liệu 4 cột:
  1. Tên file: Kèm biểu tượng định dạng (icon) và status tooltip đầy đủ.
  2. Đường dẫn tương đối thư mục cha (hàm `getRelativeParentDir`): Tính từ folder root đối với thao tác mở thư mục, hoặc 1 cấp thư mục cha trực tiếp đối với tệp mở lẻ.
  3. Kích thước file: Định dạng B/KB/MB/GB.
  4. Trạng thái file: Giữ nguyên logic trạng thái 🟢 VALID / 🔴 MODIFIED / ◌ PENDING / ! ERROR.
- Tương tác trên đầu bảng (Table Header):
  - Nhấp vào ô đầu bảng mở ô nhập filter cho cột đó (Column Filter).
  - Nút mũi tên bên phải ô (`▲` / `▼` / `⇅`) cho phép sắp xếp (Sort) tăng dần / giảm dần theo cột tương ứng.
- Nhấp vào một dòng file mở xem nội dung tệp bình thường trong view chính.
- Tối ưu giao diện data-dense (chiều cao dòng 24-26px, text ellipsis) và hỗ trợ cả Light Mode và Dark Mode trong `tad-master/packages/tadviewer/less/sidebar.less`.

### R5. Kiểm thử Tự động & Đóng gói Bản phát hành v2.4.3
- Bổ sung SUITE JJ vào `tests/deep_integration_qa.js` kiểm thử toàn diện mọi tính năng mới (JJ.1 đến JJ.7).
- Chạy toàn bộ test suite đảm bảo 100% bài kiểm thử PASS.
- Thực hiện build và đóng gói release portable v2.4.3 (`releases/Toad-2.4.3-x64-portable.exe` và `releases/Toad-2.4.3-x64-portable.zip`) tuân thủ nghiêm ngặt quy chuẩn Packaging & Versioning của workspace.

## Verification Resources
- Test suite chính: `tests/deep_integration_qa.js` (chạy bằng `& "D:\Shared_UserData\Downloads\tad\node-v18.20.4-win-x64\node.exe" tests\deep_integration_qa.js`).
- Công cụ đóng gói: `package_release.ps1`, `tools/bump_version.js`.
- Kế hoạch chi tiết đã duyệt: `C:\Users\huydq\.gemini\antigravity\brain\489b863f-84dc-4fd6-bbfb-142488ba4d23\phuong_an_chi_tiet_file_table_search_va_project_rename_v2.4.3.md`.

## Acceptance Criteria

### Menu Cleanup
- [ ] Không còn các mục `Open File...` và `Open Directory...` kiểu cũ trong menu `File`.
- [ ] Menu `File` có các mục `Add Files to Active Project...` (`CmdOrCtrl+O`) và `Add Folder to Active Project...` (`CmdOrCtrl+Shift+O`).

### Project Inline Rename
- [ ] Double-click vào tiêu đề project trên sidebar kích hoạt ô nhập liệu inline.
- [ ] Nhấn phím Enter hoặc blur lưu tên project mới thành công.
- [ ] Phím Escape hủy thao tác chỉnh sửa mà không đổi tên project.

### Search Filter
- [ ] Gõ từ khóa tìm kiếm trùng tên project không làm hiển thị tất cả các file trong project đó.
- [ ] Tìm kiếm chỉ khớp với tên file, phản hồi tức thì in-memory trên toàn bộ project.
- [ ] Project có file khớp tự động được expand; project không có kết quả khớp bị ẩn đi trong quá trình tìm kiếm.

### Table Layout & Interactions
- [ ] Danh sách file hiển thị chuẩn bảng 4 cột: Tên file, Thư mục cha, Kích thước, Trạng thái.
- [ ] Cột Thư mục cha hiển thị đúng đường dẫn tương đối theo hàm `getRelativeParentDir`.
- [ ] Nhấp vào header cột hiển thị ô nhập filter cho cột đó và lọc chính xác.
- [ ] Nút sắp xếp trên header (`▲` / `▼` / `⇅`) sắp xếp đúng thứ tự cho từng cột (Tên file, Thư mục, Kích thước số học, Trạng thái).
- [ ] Nhấp vào hàng file mở tệp trong giao diện xem chính bình thường.
- [ ] Giao diện bảng tương thích đầy đủ với cả Dark theme và Light theme.

### Verification & Release
- [ ] SUITE JJ trong `tests/deep_integration_qa.js` chạy đạt 100% PASS (200+/200+ assertions).
- [ ] Bản build portable v2.4.3 được đóng gói thành công thành `releases/Toad-2.4.3-x64-portable.exe` và `releases/Toad-2.4.3-x64-portable.zip`.
