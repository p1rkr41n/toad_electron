# TÀI LIỆU PHÂN TÍCH NGHIỆP VỤ & PHƯƠNG ÁN TRIỂN KHAI HỆ THỐNG TOAD (v1.3.16)
> **Dự án:** TOAD Viewer - Công cụ Phân tích Điều tra Số & Giám sát Log (DFIR / SOC Log Analyzer)  
> **Phiên bản mục tiêu:** v1.3.16 (Multi-dot Filename Support & Directory Scanner Hardening)  
> **Ngày lập tài liệu:** 28/10/2026  
> **Trạng thái:** Đặc tả nghiệp vụ BA & Kế hoạch triển khai chính thức  

---

## 1. TỔNG QUAN BỐI CẢNH & PHÁT HIỆN SỰ CỐ

### 1.1. Bối cảnh phát sinh
Khi người dùng mở một thư mục (chức năng `File -> Open Directory`) chứa các tập tin có **từ 2 dấu chấm trở lên trong tên tệp** (ví dụ: `a.b.c.csv`, `data.2024.10.csv`, `server.2026.log`, `audit.sys.json`), các tập tin này **hoàn toàn biến mất khỏi danh sách sidebar**, không được hàng đợi nền `MultipleLoadingManager` tiếp nhận và người dùng không thể mở để phân tích dữ liệu.

### 1.2. Phân tích nguyên nhân gốc rễ (Root Cause)
Lỗi bắt nguồn từ module quét thư mục của hệ thống: [`packages/reltab-fs/src/reltab-fs.ts`](file:///d:/Shared_UserData/Downloads/tad/tad-master/packages/reltab-fs/src/reltab-fs.ts#L66-L76).
- Tác giả ban đầu muốn hỗ trợ phần mở rộng kép `.csv.gz` và `.tsv.gz`.
- Thay vì dùng `path.extname()`, tác giả đã tự viết hàm `extNameEx`:
  ```typescript
  function extNameEx(path: string): string {
    const dotIndex = path.indexOf("."); // Lỗi: Lấy dấu chấm ĐẦU TIÊN
    if (dotIndex === -1) return "";
    return path.slice(dotIndex);
  }
  ```
- Khi quét file `a.b.c.csv`:
  - `path.indexOf(".")` trả về vị trí sau chữ `a` (index 1).
  - Chuỗi extension bị cắt thành `".b.c.csv"`.
  - Hàm lọc `getChildren` so sánh `b.c.csv` với danh sách `dataFileExtensions = ["csv", "tsv", "parquet", "json", "jsonl", "ndjson", "log", "txt", "evtx", "csv.gz", "tsv.gz"]`.
  - Kết quả: Không khớp (`index === -1`), file bị âm thầm lọc bỏ khỏi `dataEnts` và biến mất khỏi UI.

---

## 2. MA TRẬN YÊU CẦU NGHIỆP VỤ (BA SPECIFICATION)

| Mã YC | Hạng Mục Nghiệp Vụ | Mô Tả Yêu Cầu & Bối Cảnh Người Dùng | Tiêu Chí Nghiệm Thu (Acceptance Criteria - AC) | Mức Độ Ưu Tiên |
|:---:|---|---|---|:---:|
| **BA-46** | **Hỗ Trợ Toàn Diện Tệp Đa Dấu Chấm Khi Quét Thư Mục (Multi-dot Filename Support)** | Hệ thống nhận diện chính xác định dạng của mọi tập tin bất kể có bao nhiêu dấu chấm trong tên file (`a.b.c.csv`, `data.2024.10.28.csv`, `sys.audit.v1.log`, `archive.csv.gz`). | - Các file có nhiều dấu chấm hiển thị đầy đủ 100% trên Sidebar khi mở thư mục.<br>- Các file kép `.csv.gz` và `.tsv.gz` vẫn được nhận diện chính xác.<br>- Các file ẩn (`.gitignore`) hoặc không có extension bị bỏ qua an toàn. | **P0 (Critical)** |
| **BA-47** | **Đồng Bộ Hoá Hàng Đợi Nền Cho Tệp Đa Dấu Chấm** | Toàn bộ tệp hợp lệ chứa đa dấu chấm được tự động đăng ký vào hàng đợi nạp nền `MultipleLoadingManager` khi mở thư mục. | - Tất cả tệp `a.b.c.csv` tự động sinh Parquet cache nền.<br>- Click vào tệp mở tức thì DataGrid mà không gặp lỗi. | **P0 (Critical)** |
| **BA-48** | **Đóng Gói Phiên Bản Toad v1.3.16** | Tăng phiên bản lên 1.3.16 (SemVer 3 phần), biên dịch `reltab-fs`, `tad-app`, đóng gói bộ cài Portable và commit VCS (`jj` & `git`). | - Sinh thành công `Toad 1.3.16.exe`.<br>- Cập nhật `EXP.md` ghi nhận bài học kinh nghiệm. | **P1 (High)** |

---

## 3. THIẾT KẾ GIẢI PHÁP KỸ THUẬT

### Tái cấu trúc hàm `extNameEx` tại `packages/reltab-fs/src/reltab-fs.ts`
```typescript
function extNameEx(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  // 1. Ưu tiên kiểm tra các compound extensions đã đăng ký (ví dụ: .csv.gz, .tsv.gz)
  for (const ext of dataFileExtensions) {
    if (ext.includes(".") && base.endsWith("." + ext.toLowerCase())) {
      return "." + ext;
    }
  }
  // 2. Mặc định lấy theo extension chuẩn tại dấu chấm cuối cùng (Node.js path.extname)
  return path.extname(filePath);
}
```

---

## 4. MA TRẬN KIỂM THỬ CHẤP NHẬN (QA TEST MATRIX)

| Mã TC | Kịch Bản Kiểm Thử | Dữ Liệu Thử Nghiệm | Kết Quả Mong Đợi | Trạng Thái |
|:---:|---|---|---|:---:|
| **TC-1.3.16-01** | Quét thư mục chứa tệp 3 dấu chấm | `a.b.c.csv` | Hiển thị trên sidebar, click mở DataGrid thành công | Sẵn sàng |
| **TC-1.3.16-02** | Quét thư mục chứa ngày tháng dạng dấu chấm | `data.2024.10.28.csv` | Nhận diện extension `csv`, nạp vào DuckDB chuẩn xác | Sẵn sàng |
| **TC-1.3.16-03** | Quét thư mục chứa log nhiều phân đoạn | `sys.audit.v1.log` | Nhận diện extension `log`, nạp chế độ Raw Log | Sẵn sàng |
| **TC-1.3.16-04** | Kiểm tra độ tương thích ngược với file nén kép | `archive.csv.gz` | Nhận diện extension `csv.gz`, giải nén stream sang Parquet | Sẵn sàng |
| **TC-1.3.16-05** | Bỏ qua file ẩn hệ thống | `.gitignore`, `.DS_Store` | Bị bỏ qua, không hiển thị trên danh sách bảng dữ liệu | Sẵn sàng |

