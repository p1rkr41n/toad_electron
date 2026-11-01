# CHUYÊN ĐỀ 03: MENU WIN32 & QUẢN LÝ CỬA SỔ TRONG TAURI v2
> **Mục tiêu:** Xây dựng hệ thống Native Menu chuẩn Win32 ("File Edit View Help"), quản lý sự kiện phím tắt (Accelerators), Context Menu và kiểm soát thuộc tính cửa sổ trong Tauri v2.

---

## 1. TẠI SAO MENU BỊ BIẾN MẤT VÀ GIẢI PHÁP TRONG TAURI v2?

### 1.1. Nguyên nhân kỹ thuật
Trong Electron, hàm `Menu.setApplicationMenu(menu)` tự động tạo thanh menu Win32 cổ điển gắn trên đỉnh cửa sổ.  
Ngược lại, trong **Tauri v2**:
* Mặc định cửa sổ Windows **không có menu** trừ khi được khởi tạo tường minh bằng `tauri::menu::MenuBuilder` trong Rust và gán vào cửa sổ thông qua `window.set_menu(menu)` hoặc `app.set_menu(menu)`.
* Nếu chỉ code ở tầng JavaScript mà không đăng ký menu ở tầng Rust, thanh menu trên đỉnh sẽ biến mất hoàn toàn (như hiện tượng đã gặp ở bản build thử nghiệm trước).

---

## 2. XÂY DỰNG NATIVE MENU CHUẨN WIN32 BẰNG RUST

Dưới đây là mã nguồn Rust hoàn chỉnh để tạo thanh menu 4 mục chuẩn: **File**, **Edit**, **View**, **Help** có đầy đủ phím tắt (`Ctrl+O`, `Ctrl+F`, `F11`):

```rust
// src-tauri/src/menu.rs
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Wry,
};

pub fn build_application_menu(app: &AppHandle) -> Result<tauri::menu::Menu<Wry>, tauri::Error> {
    // 1. Menu FILE
    let open_file = MenuItemBuilder::with_id("file_open", "Open Supported Data File...")
        .accelerator("Ctrl+O")
        .build(app)?;
    let open_dir = MenuItemBuilder::with_id("file_open_dir", "Open Directory...")
        .build(app)?;
    let exit_app = MenuItemBuilder::with_id("file_exit", "Exit Toad")
        .accelerator("Alt+F4")
        .build(app)?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&open_file)
        .item(&open_dir)
        .separator()
        .item(&exit_app)
        .build()?;

    // 2. Menu EDIT
    let copy = MenuItemBuilder::with_id("edit_copy", "Copy")
        .accelerator("Ctrl+C")
        .build(app)?;
    let select_all = MenuItemBuilder::with_id("edit_select_all", "Select All")
        .accelerator("Ctrl+A")
        .build(app)?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&copy)
        .item(&select_all)
        .build()?;

    // 3. Menu VIEW
    let toggle_fullscreen = MenuItemBuilder::with_id("view_fullscreen", "Toggle Full Screen")
        .accelerator("F11")
        .build(app)?;
    let zoom_in = MenuItemBuilder::with_id("view_zoom_in", "Zoom In")
        .accelerator("Ctrl+=")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("view_zoom_out", "Zoom Out")
        .accelerator("Ctrl+-")
        .build(app)?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(&toggle_fullscreen)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .build()?;

    // 4. Menu HELP
    let quick_start = MenuItemBuilder::with_id("help_quickstart", "Quick Start Guide...")
        .build(app)?;
    let about = MenuItemBuilder::with_id("help_about", "About Toad...")
        .build(app)?;

    let help_submenu = SubmenuBuilder::new(app, "Help")
        .item(&quick_start)
        .separator()
        .item(&about)
        .build()?;

    // 5. Kết hợp thành thanh Menu Bar hoàn chỉnh
    let menu = MenuBuilder::new(app)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&help_submenu)
        .build()?;

    Ok(menu)
}
```

---

## 3. LẮNG NGHE & ĐIỀU PHỐI SỰ KIỆN MENU SANG FRONTEND

Khi người dùng bấm vào một menu item hoặc nhấn phím tắt tương ứng, Rust backend sẽ bắt sự kiện qua `on_menu_event` và bắn event sang React UI:

```rust
// src-tauri/src/lib.rs
use tauri::Emitter;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Khởi tạo menu và gán cho toàn ứng dụng
            let menu = menu::build_application_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let item_id = event.id().as_ref();
            println!("[Menu Event] User clicked: {}", item_id);

            match item_id {
                "file_exit" => {
                    app.exit(0);
                }
                "view_fullscreen" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let is_fs = window.is_fullscreen().unwrap_or(false);
                        let _ = window.set_fullscreen(!is_fs);
                    }
                }
                // Điều phối các sự kiện khác sang Frontend xử lý
                action => {
                    let _ = app.emit("menu-action", action);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Lỗi khi chạy ứng dụng");
}
```

Phía Frontend (React / TypeScript) chỉ cần lắng nghe sự kiện `menu-action`:
```typescript
import { listen } from '@tauri-apps/api/event';

export function setupMenuListener(onAction: (actionId: string) => void) {
  return listen<string>('menu-action', (event) => {
    const actionId = event.payload;
    if (actionId === 'file_open') {
      triggerOpenFileDialog();
    } else if (actionId === 'help_quickstart') {
      openQuickStartModal();
    }
  });
}
```

---

## 4. QUẢN LÝ CỬA SỔ & THUỘC TÍNH (WINDOW MANAGEMENT)

### 4.1. Lấy con trỏ cửa sổ hiện tại trong Command
```rust
#[tauri::command]
pub async fn update_window_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())?;
    Ok(())
}
```

### 4.2. Cấu hình Cửa sổ trong `tauri.conf.json`
Các thuộc tính quan trọng đối với giao diện phân tích dữ liệu:
* `"decorations": true`: Giữ lại khung viền và 3 nút chuẩn Windows (Thu nhỏ, Phóng to, Đóng).
* `"transparent": false`: Đảm bảo hiệu năng vẽ (GPU render) của SlickGrid đạt 60fps, không bị tốn tài nguyên compositing.
* `"minWidth": 900, "minHeight": 600`: Đảm bảo layout 3 cột (Sidebar, Grid, Filter Pane) không bị vỡ trên màn hình bé.

