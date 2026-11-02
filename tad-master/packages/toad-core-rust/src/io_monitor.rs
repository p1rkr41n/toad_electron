//! io_monitor.rs
//!
//! Theo dõi chỉ số I/O đọc/ghi của tiến trình trên Windows qua Win32 GetProcessIoCounters.
//! Không yêu cầu quyền Administrator (Standard User Permission).
//! Không gây ảnh hưởng đến băng thông đĩa hoặc CPU (đọc biến nhớ Kernel RAM trong < 0.001ms).

#[repr(C)]
#[derive(Default, Debug, Clone, Copy)]
pub struct IoCounters {
    pub read_operation_count: u64,
    pub write_operation_count: u64,
    pub other_operation_count: u64,
    pub read_transfer_count: u64,
    pub write_transfer_count: u64,
    pub other_transfer_count: u64,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> *mut std::ffi::c_void;
    fn GetProcessIoCounters(hProcess: *mut std::ffi::c_void, lpIoCounters: *mut IoCounters) -> i32;
    fn CloseHandle(hObject: *mut std::ffi::c_void) -> i32;
    fn GetCurrentProcess() -> *mut std::ffi::c_void;
}

/// Lấy tổng số byte đã đọc và ghi của tiến trình theo PID
/// Trả về: Some((read_bytes, write_bytes))
pub fn get_process_io_bytes(pid: u32) -> Option<(u64, u64)> {
    #[cfg(windows)]
    unsafe {
        let mut counters = IoCounters::default();
        let handle = if pid == 0 || pid == std::process::id() {
            GetCurrentProcess()
        } else {
            // PROCESS_QUERY_LIMITED_INFORMATION (0x1000)
            let mut h = OpenProcess(0x1000, 0, pid);
            if h.is_null() {
                // Thử PROCESS_QUERY_INFORMATION (0x0400)
                h = OpenProcess(0x0400, 0, pid);
            }
            h
        };

        if handle.is_null() {
            return None;
        }

        let is_current = handle == GetCurrentProcess();
        let ok = GetProcessIoCounters(handle, &mut counters);
        if !is_current {
            CloseHandle(handle);
        }

        if ok != 0 {
            Some((counters.read_transfer_count, counters.write_transfer_count))
        } else {
            None
        }
    }

    #[cfg(not(windows))]
    {
        let _ = pid;
        None
    }
}
