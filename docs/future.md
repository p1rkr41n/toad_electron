# ĐỊNH HƯỚNG TỐI ƯU HIỆU NĂNG & NÂNG CẤP KIẾN TRÚC TOAD TRONG TƯƠNG LAI (FUTURE ROADMAP)

> **Dự án:** TOAD Viewer - Công cụ Phân tích Điều tra Số & Giám sát Log (DFIR / SOC Log Analyzer)  
> **Tài liệu:** future.md  
> **Mục tiêu trọng tâm:** Tối ưu hóa thời gian khởi động ứng dụng (Startup Latency Reduction) từ 3 - 5s xuống dưới 0.8 - 1.0s và hoàn thiện kiến trúc mô-đun hóa.  
> **Trạng thái:** Đề xuất kỹ thuật tương lai (Backlog / Chưa áp dụng mã nguồn).

---

## 1. TỔNG QUAN BỐI CẢNH

Trong quá trình phát triển từ các phiên bản v1.3.7 đến v1.3.9.1, Toad đã được tích hợp thêm nhiều phân hệ mạnh mẽ:
- Động cơ lõi Rust SIMD độc lập (`toad-core.exe`) phục vụ giải mã log EVTX tốc độ cao.
- Bộ máy cơ sở dữ liệu nhúng DuckDB 1.0.0 với khả năng xử lý song song và tối ưu bộ đệm RAM (`max_memory = auto`).
- Hệ thống quản lý cấu hình di động và dọn dẹp tự động qua `config.ini` và `toadAppData`.
- Các tính năng UI mới: Master-Detail Continuous Triage, Cố định cột nút mở rộng (`_expand`), thanh phân trang linh hoạt không giới hạn trần.

Tuy nhiên, việc tích hợp nhiều thành phần khiến thời gian khởi động lần đầu của file thực thi di động (`Toad.exe`) dao động từ **3 đến 5 giây**. Dưới đây là 3 hướng tối ưu kỹ thuật khả thi đã được nghiên cứu và đề xuất để triển khai trong tương lai.

---

## 2. CHI TIẾT 3 ĐỀ XUẤT TỐI ƯU KHẢ THI TRONG TƯƠNG LAI

### 📌 Đề xuất 1: Phân phối thêm bản "Fast Portable" (Folder / ZIP)
* **Mô tả**: Đóng gói ứng dụng dưới dạng một thư mục giải nén sẵn (chứa `Toad.exe` gốc cùng toàn bộ các thư viện `.dll`, runtime Electron và thư mục `resources/app.asar`), nén lại thành file `Toad_vX.X_fast_portable.zip`.
* **Hiện trạng hiện tại**:
  - Bản phân phối hiện nay ([`Toad.exe`](file:///D:/Shared_UserData/Downloads/tad/Toad.exe)) là dạng **Single-file Self-Extracting Executable** do `electron-builder` nén 7z một tệp.
  - Mỗi lần người dùng click đúp, Windows phải tự động bung giải nén toàn bộ ~250MB vào thư mục tạm `C:\Users\<user>\AppData\Local\Temp\<random_hash>\` rồi mới thực thi. Bước này chiếm tới **60% - 75%** tổng thời gian chờ khởi động.
* **Phương án triển khai**:
  - Tận dụng thư mục [`packages/tad-app/release/win-unpacked`](file:///D:/Shared_UserData/Downloads/tad/tad-master/packages/tad-app/release/win-unpacked) vốn đã được sinh ra trong quá trình build.
  - Viết script tự động nén thư mục này thành `releases/toad_vX.X_fast_portable.zip`.
  - Người dùng chỉ cần giải nén 1 lần duy nhất vào một thư mục bất kỳ trên ổ đĩa hoặc USB, sau đó click chạy trực tiếp file `Toad.exe` bên trong.
* **Hiệu quả dự kiến**: Ứng dụng khởi động ngay lập tức trong **~1.0 giây**, loại bỏ hoàn toàn độ trễ tự bung nén vào thư mục Temp của Windows.

---

### 📌 Đề xuất 2: Chuyển `init-portable` sang Bất đồng bộ (Async Non-Blocking)
* **Mô tả**: Không để tác vụ khởi tạo môi trường di động và gọi Rust Core chặn (block) luồng chính (Main Process) của Electron trong quá trình khởi động.
* **Hiện trạng hiện tại**:
  - Tại [`packages/tad-app/app/portableAppData.ts:L644`](file:///D:/Shared_UserData/Downloads/tad/tad-master/packages/tad-app/app/portableAppData.ts#L644), hàm `initPortableEnvironment()` đang dùng lệnh đồng bộ chặn luồng:
    ```typescript
    const output = child_process.execFileSync(toadCore, ["init-portable", exeDir], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 15000,
    });
    ```
  - Tại [`packages/tad-app/app/main.ts:L504`](file:///D:/Shared_UserData/Downloads/tad/tad-master/packages/tad-app/app/main.ts#L504), lệnh này chạy đồng bộ ngay trước khi tạo cửa sổ, khiến Electron Main Process bị đóng băng khoảng 200 - 400ms.
* **Phương án triển khai**:
  - **Tách 2 giai đoạn khởi tạo**:
    1. *Giai đoạn 1 (Thiết yếu - Sync siêu nhẹ)*: Xác định nhanh đường dẫn thư mục di động và gọi ngay `app.setPath("userData", ...)` để Electron kịp nhận diện trước sự kiện `ready`.
    2. *Giai đoạn 2 (Tác vụ nền - Async Non-blocking)*: Chuyển lệnh gọi `toad-core init-portable`, tác vụ dọn dẹp tệp rác temp tồn đọng (`cleanTempDir`) và đọc chi tiết cấu hình sang `child_process.execFile` bất đồng bộ (Promise/async-await), chạy song song trong khi cửa sổ đang render.
* **Hiệu quả dự kiến**: Luồng chính của Electron thông suốt 100%, loại bỏ độ trễ nghẽn CPU lúc khởi động ban đầu.

---

### 📌 Đề xuất 3: Tối ưu Webpack (Code Splitting / Lazy Loading)
* **Mô tả**: Phân tách gói mã nguồn giao diện (Bundle Splitting), chỉ nạp các thành phần giao diện và thư viện nặng khi người dùng thực sự mở tính năng đó.
* **Hiện trạng hiện tại**:
  - Cấu hình Webpack tại [`packages/tad-app/webpack.config.js`](file:///D:/Shared_UserData/Downloads/tad/tad-master/packages/tad-app/webpack.config.js) hiện đóng gói toàn bộ ứng dụng Renderer thành **1 file nguyên khối khổng lồ**:
    - `tadapp.bundle.js`: **4.68 MiB**
    - `tadviewer.js`: **2.5 MiB**
  - Trình duyệt Chromium của Electron phải tải, biên dịch và parse toàn bộ ~7.2 MiB mã JavaScript (bao gồm BlueprintJS components, DuckDB client, biểu đồ Pivot, bộ phân tích cú pháp RelTab) ngay từ khung hình đầu tiên.
* **Phương án triển khai**:
  - Áp dụng kỹ thuật `React.lazy()` và dynamic `import()` của ES6:
    - Module tài liệu trợ giúp (`QuickStartModal`, `HelpView`): Chỉ nạp khi bấm menu Help.
    - Module biểu đồ và Pivot nâng cao: Chỉ nạp khi người dùng kích hoạt tab Pivot/Chart.
    - Bộ lọc đa cột phức tạp và xuất tệp (Export CSV/Parquet): Nạp theo nhu cầu (on-demand).
  - Cấu hình `optimization.splitChunks` trong Webpack để tách các thư viện bên thứ ba (`vendor.bundle.js`) và lưu cache trình duyệt lâu dài.
* **Hiệu quả dự kiến**: Giảm kích thước bundle khởi động ban đầu xuống còn **< 1.2 MiB**, giảm **50% thời gian phân tích cú pháp JavaScript** của V8 Engine.

---

## 3. LỘ TRÌNH TRIỂN KHAI KHUYẾN NGHỊ (RECOMMENDED IMPLEMENTATION PHASES)

| Giai Đoạn | Hạng Mục Công Việc | Mức Độ Phức Tạp | Tác Động Tốc Độ |
|:---:|---|:---:|:---:|
| **Phase 1** | **Bản Fast Portable (Folder / ZIP)**: Bổ sung script tạo file zip của `win-unpacked` vào quy trình release. | Thấp (1 - 2 giờ) | 🟢 **Giảm ngay 2.5 - 3.5 giây** (Hiệu quả tức thì nhất) |
| **Phase 2** | **Bất đồng bộ hóa `init-portable`**: Tách nhẹ phase `setPath` và đẩy dọn dẹp temp/config sang async. | Trung bình (0.5 ngày) | 🟡 **Giảm thêm 200 - 400ms** |
| **Phase 3** | **Webpack Code Splitting**: Refactor các component lớn sang `React.lazy()` và cấu hình `splitChunks`. | Cao (1 - 2 ngày) | 🟡 **Giảm thêm 300 - 500ms** thời gian render UI |

---

## 4. TÀI LIỆU LIÊN QUAN

- [BA_PHUONG_AN_SUA_CHUA_VA_NANG_CAP_v1.3.9.1.md](file:///D:/Shared_UserData/Downloads/tad/docs/BA_PHUONG_AN_SUA_CHUA_VA_NANG_CAP_v1.3.9.1.md)
- [RELEASE_NOTES.md](file:///D:/Shared_UserData/Downloads/tad/releases/RELEASE_NOTES.md)
- [QUICK_START.md](file:///D:/Shared_UserData/Downloads/tad/QUICK_START.md)
- [DFIR_FEATURES_ROADMAP_PLAN.md](file:///D:/Shared_UserData/Downloads/tad/docs/DFIR_FEATURES_ROADMAP_PLAN.md)
