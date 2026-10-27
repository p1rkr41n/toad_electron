# KẾ HOẠCH TRIỂN KHAI & MA TRẬN KIỂM THỬ TOAD v1.3.8
## High-Throughput Jitterless Ingestion Engine (SSD & HDD Ready) & Adaptive Memory Budgeting

---

## 1. Bối cảnh & Yêu cầu Nghiệp vụ (Business Analysis - BA Specification)

### 1.1. Vấn đề thực tế từ người dùng & chuyên viên DFIR
1. **Tốc độ nạp tệp lớn (10GB - 40GB+) bị trồi sụt thất thường**:
   - Khi nạp các file log lớn, tốc độ đọc ổ đĩa thường xuyên dao động mạnh theo đồ thị "hình răng cưa": có lúc vọt lên 400 - 500 MB/s, nhưng ngay sau đó lại tụt thê thảm về 0.0 MB/s rồi mới tăng trở lại.
   - Nguyên nhân: DuckDB mặc định kích hoạt cờ `PRESERVE_INSERTION_ORDER = true` buộc các luồng đọc CPU phải chờ đợi nhau (barrier lock). Đồng thời, kích thước khối `row_group_size = 25000` quá nhỏ khiến việc xả dữ liệu xuống đĩa diễn ra liên tục, làm gián đoạn luồng đọc tuần tự của ổ đĩa.
2. **Chiếm dụng RAM quá mức khi đặt `max_memory = auto`**:
   - Khi cấu hình `auto`, DuckDB tự động giành tới 80% RAM vật lý của toàn hệ thống (trên máy 32GB - 64GB RAM, tiến trình có thể phình to lên tới 16GB RAM). Điều này dẫn đến hiện tượng tranh chấp bộ nhớ đệm với Windows Kernel (OS Page Cache Swapping / Dirty Page Flush), làm đóng băng toàn bộ tiến trình nạp tệp.
3. **Hiệu năng trên ổ cứng cơ (HDD) bị suy giảm nghiêm trọng**:
   - Trên HDD, việc vừa đọc CSV vừa ghi Parquet ngắt quãng với các khối nhỏ 25.000 dòng khiến đầu đọc từ tính phải di chuyển cơ học liên tục (Seek Penalty), làm tốc độ đọc tụt từ 150 MB/s xuống chỉ còn 10 - 15 MB/s.

### 1.2. Mục tiêu Nghiệp vụ v1.3.8
| Mã YC | Hạng mục | Mục tiêu Kỹ thuật | Tiêu chí Nghiệm thu (Acceptance Criteria) |
|---|---|---|---|
| **BA-09** | **Non-blocking Parallel Ingestion** | Tắt cờ bảo toàn thứ tự dòng (`SET preserve_insertion_order = false;`) trong phiên nạp DuckDB. | - Các luồng đọc và nén CPU hoạt động độc lập hoàn toàn, không bị barrier lock.<br>- Tốc độ đọc đĩa ổn định liên tục, loại bỏ hiện tượng tụt về 0.0 MB/s.<br>- Tận dụng tối đa hàng đợi đa luồng của NVMe/SSD và duy trì đọc tuần tự tối đa của HDD. |
| **BA-10** | **Adaptive Memory Budgeting Guard** | Khi `max_memory = auto`, tự động áp dụng trần an toàn (tối đa 45% RAM hệ thống hoặc tối đa 8GB). | - Tiến trình nạp không bao giờ chiếm vượt quá 8GB RAM trên máy 32GB/64GB.<br>- Không gây giật lag Windows, không kích hoạt OS memory thrashing.<br>- Người dùng vẫn có thể ghi đè thủ công trong `config.ini` nếu muốn. |
| **BA-11** | **Optimized Row Group Size (100K)** | Nâng kích thước `row_group_size` mặc định từ 25.000 lên **100.000 dòng**. | - Giảm 75% số lần xả đĩa ngắt quãng.<br>- Tăng tỷ lệ nén Snappy/Zstd thêm 15% - 25%.<br>- Trên HDD: giảm tới 80% số lần di chuyển đầu từ vật lý, giữ tốc độ đọc ở mức trần cơ học (130 - 160 MB/s). |

---

## 2. Giải pháp Kiến trúc & Kỹ thuật

```
[File CSV/JSON Nguồn (40GB)]
          │
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│  DuckDB Streaming Pipeline (v1.3.8 Tối ưu hóa)                         │
│  - SET preserve_insertion_order = false (Đa luồng phi khóa)          │
│  - SET max_memory = SafeBudgetMB (Trần an toàn 45% RAM / max 8GB)     │
│  - ROW_GROUP_SIZE = 100,000 (Gom khối lớn xả tuần tự)                  │
└────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Kết quả Đầu ra                                                        │
│  - Ổ SSD/NVMe: Tốc độ đọc bão hòa 1.500 - 3.000 MB/s ổn định           │
│  - Ổ HDD cơ: Giảm 80% seek penalty, duy trì đọc tuần tự 130-160 MB/s   │
│  - RAM ứng dụng: Giữ vững < 8GB trong suốt quá trình nạp              │
│  - Tương thích 100%: Toàn bộ UI (SlickGrid, Paging, Event Details)     │
│    truy vấn qua Virtual SQL View với tốc độ 0ms                         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Ma trận Thử nghiệm & Đảm bảo Chất lượng (QA Test Matrix v1.3.8)

| Test Case ID | Phân hệ Kiểm thử | Điều kiện Tiên quyết | Các bước Thực hiện | Kết quả Kỳ vọng |
|---|---|---|---|---|
| **TC-601** | Parallel Non-blocking Cfg | Khởi chạy import CSV. | 1. Bắt đầu quá trình `nativeCSVImport`.<br>2. Kiểm tra câu lệnh cấu hình gửi tới DuckDB connection. | Đã áp dụng `SET preserve_insertion_order = false`. Phiên DuckDB chấp nhận lệnh 0 lỗi. |
| **TC-602** | Adaptive Memory Budgeting | Cấu hình `max_memory = auto` trên máy RAM lớn. | 1. Mở file dữ liệu lớn.<br>2. Theo dõi `Private Bytes` qua PowerShell/Task Manager. | Mức RAM chiếm dụng tối đa không vượt quá trần an toàn (~8GB), không làm đơ hệ thống. |
| **TC-603** | Row Group 100K Flush | Import tệp mẫu dữ liệu. | 1. Hoàn tất nạp tệp CSV.<br>2. Truy vấn `parquet_metadata` của tệp Parquet sinh ra. | Mỗi Row Group chứa xấp xỉ 100.000 dòng. Tổng số dòng đọc qua metadata chính xác 100%. |
| **TC-604** | Jitterless Throughput | Mở tệp dữ liệu lớn (e.g. 40GB hoặc file lớn). | 1. Quan sát Hộp thoại Tiến trình.<br>2. Theo dõi chỉ số MB/s mỗi 1s. | Tốc độ đọc duy trì liên tục, không bị tụt về 0.0 MB/s theo chu kỳ răng cưa ngắn. |
| **TC-605** | UI Regression (v1.3.7.5) | Mở bảng phân trang có cột `_expand`. | 1. Cuộn ngang kiểm tra cột cố định mép trái.<br>2. Dùng phím mũi tên Lên/Xuống duyệt sự kiện. | Cột `_expand` vẫn ghim mép trái; phím mũi tên di chuyển thẳng đứng và đồng bộ Event Details hoàn hảo. |
