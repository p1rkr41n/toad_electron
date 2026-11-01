# TAURI v2, RUST & WEBVIEW2 COMPREHENSIVE DOCUMENTATION MANUAL
> **Thư viện tài liệu kỹ thuật hoàn chỉnh**: Tauri v2, Rust Desktop Programming & Windows WebView2  
> **Dành cho dự án**: Toad / Desktop Applications Migration & Dual-Engine Architecture  
> **Phiên bản tài liệu**: Tauri 2.0+ (Mới nhất), Rust 2021 Edition, Microsoft Edge WebView2  

---

## 📚 MỤC LỤC TÀI LIỆU (DOCUMENTATION INDEX)

Tài liệu trong thư mục này được phân thành 6 chuyên đề chuyên sâu, cung cấp từ lý thuyết nền tảng đến code mẫu thực chiến:

| STT | Tập tin tài liệu | Chủ đề / Nội dung chính |
| :---: | :--- | :--- |
| **01** | [`01_TAURI_V2_CORE_ARCHITECTURE.md`](file:///d:/Shared_UserData/Downloads/tad/docs_tauri_v2/01_TAURI_V2_CORE_ARCHITECTURE.md) | **Kiến trúc cốt lõi Tauri v2**: Vòng đời ứng dụng, so sánh với Electron, cấu trúc dự án `src-tauri`, cấu hình `tauri.conf.json`, Build pipeline, Bundling. |
| **02** | [`02_TAURI_V2_IPC_AND_SECURITY_ACL.md`](file:///d:/Shared_UserData/Downloads/tad/docs_tauri_v2/02_TAURI_V2_IPC_AND_SECURITY_ACL.md) | **Hệ thống IPC & Bảo mật ACL**: Command (`#[tauri::command]`), Event (`emit`/`listen`), Cấu hình Capability & Permissions (`capabilities/default.json`), Xử lý triệt để lỗi `Command plugin:event\|listen not allowed by ACL`. |
| **03** | [`03_TAURI_V2_MENUS_AND_WINDOW_MANAGEMENT.md`](file:///d:/Shared_UserData/Downloads/tad/docs_tauri_v2/03_TAURI_V2_MENUS_AND_WINDOW_MANAGEMENT.md) | **Menu Win32 & Quản lý Cửa sổ**: Xây dựng Native Menu ("File Edit View Help") bằng `tauri::menu::MenuBuilder`, phím tắt Accelerators, Context Menu, System Tray, Window Titlebar tùy biến. |
| **04** | [`04_RUST_BACKEND_FOR_TAURI.md`](file:///d:/Shared_UserData/Downloads/tad/docs_tauri_v2/04_RUST_BACKEND_FOR_TAURI.md) | **Lập trình Backend Rust trong Tauri**: Quản lý State (`tauri::State`), Bất đồng bộ với `tokio`, Threading, Mutex/RwLock, Serde JSON serialize/deserialize, Tích hợp DuckDB (`duckdb-rs`) và xử lý lỗi. |
| **05** | [`05_WEBVIEW2_WINDOWS_DEEP_DIVE.md`](file:///d:/Shared_UserData/Downloads/tad/docs_tauri_v2/05_WEBVIEW2_WINDOWS_DEEP_DIVE.md) | **Chuyên sâu Microsoft Edge WebView2 trên Windows**: Kiến trúc Evergreen vs Fixed Version, cơ chế IPC ngầm `chrome.webview.postMessage`, Script Injection, Cô lập dữ liệu `userDataFolder`, Các lỗi render CSS / Font thường gặp và cách khắc phục. |
| **06** | [`06_TAURI_REACT_BRIDGE_PRACTICE.md`](file:///d:/Shared_UserData/Downloads/tad/docs_tauri_v2/06_TAURI_REACT_BRIDGE_PRACTICE.md) | **Cẩm nang Kết nối Frontend React / TypeScript**: Thiết lập `@tauri-apps/api/core`, xây dựng Host Bridge Adapter thay thế `electron.ipcRenderer`, TypeScript typesafe commands, Mock testing. |

---

## ⚡ HƯỚNG DẪN TRA CỨU NHANH THEO SỰ CỐ (TROUBLESHOOTING GUIDE)

* **Gặp lỗi `Command plugin:event|listen not allowed by ACL`?**  
  $\rightarrow$ Xem ngay mục 3 trong [`02_TAURI_V2_IPC_AND_SECURITY_ACL.md`](file:///d:/Shared_UserData/Downloads/tad/docs_tauri_v2/02_TAURI_V2_IPC_AND_SECURITY_ACL.md).
* **Mất thanh Menu trên Windows khi chạy Tauri?**  
  $\rightarrow$ Xem cách khởi tạo `MenuBuilder` trong [`03_TAURI_V2_MENUS_AND_WINDOW_MANAGEMENT.md`](file:///d:/Shared_UserData/Downloads/tad/docs_tauri_v2/03_TAURI_V2_MENUS_AND_WINDOW_MANAGEMENT.md).
* **Lỗi lệch màu Dark Mode hoặc font chữ hiển thị lạ trên WebView2?**  
  $\rightarrow$ Xem mục 4 trong [`05_WEBVIEW2_WINDOWS_DEEP_DIVE.md`](file:///d:/Shared_UserData/Downloads/tad/docs_tauri_v2/05_WEBVIEW2_WINDOWS_DEEP_DIVE.md).
* **Cách gọi DuckDB từ Rust trả về DataGrid React?**  
  $\rightarrow$ Xem mục 5 trong [`04_RUST_BACKEND_FOR_TAURI.md`](file:///d:/Shared_UserData/Downloads/tad/docs_tauri_v2/04_RUST_BACKEND_FOR_TAURI.md).
