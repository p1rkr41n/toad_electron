#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TOAD TELEGRAM BRIDGE (Polling & Periodic Reporter)
Duy trì kết nối với @HelloKittyXamKinLung:
- Nhận lệnh và lưu yêu cầu/phương án mới vào file inbox (telegram_inbox.jsonl).
- Báo cáo định kỳ và phản hồi các lệnh (/status, /report, /ping, /help).
- Sử dụng thư viện chuẩn của Python (không cần pip install thêm package nào).
"""

import os
import sys
import time
import json
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path

# Đảm bảo UTF-8 trên Windows console
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# --- CẤU HÌNH ---
BOT_TOKEN = "8735945052:AAFvEYN0vkBV5tJKu8xMyWbPOtoCY14x-Qg"
ALLOWED_USERNAME = "HelloKittyXamKinLung".lower()
API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"

# Thư mục gốc dự án
WORKSPACE_DIR = Path(__file__).resolve().parent.parent
INBOX_FILE = WORKSPACE_DIR / "telegram_inbox.jsonl"
CHAT_ID_FILE = WORKSPACE_DIR / "tools" / ".telegram_chat_id"

def log(msg: str):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {msg}", flush=True)

def api_call(endpoint: str, params: dict = None, timeout: int = 35) -> dict:
    url = f"{API_BASE}/{endpoint}"
    if params:
        data = urllib.parse.urlencode(params).encode("utf-8")
        req = urllib.request.Request(url, data=data)
    else:
        req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except Exception as e:
        log(f"Lỗi gọi Telegram API ({endpoint}): {e}")
        return {}

def send_message(chat_id: int | str, text: str, parse_mode: str = "Markdown") -> bool:
    params = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode
    }
    res = api_call("sendMessage", params, timeout=15)
    return res.get("ok", False)

def get_workspace_status() -> str:
    releases_dir = WORKSPACE_DIR / "releases"
    latest_notes = ""
    latest_exe = ""
    if releases_dir.exists():
        exes = sorted(releases_dir.glob("Toad-*.exe"), key=lambda p: p.stat().st_mtime, reverse=True)
        if exes:
            latest_exe = f"`{exes[0].name}` ({exes[0].stat().st_size / (1024*1024):.2f} MB)"
        notes = sorted(releases_dir.glob("v*_NOTES.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        if notes:
            latest_notes = notes[0].name

    status_text = (
        "🐸 *TOAD SYSTEM STATUS*\n\n"
        f"• *Workspace*: `{WORKSPACE_DIR.name}`\n"
        f"• *Bản đóng gói mới nhất*: {latest_exe or 'Chưa có'}\n"
        f"• *Ghi chú phát hành*: `{latest_notes or 'Chưa có'}`\n"
        f"• *Thời gian máy chủ*: {datetime.now().strftime('%H:%M:%S %d/%m/%Y')}\n"
        "• *Trạng thái*: Đang kết nối ổn định ✅"
    )
    return status_text

def get_latest_report() -> str:
    releases_dir = WORKSPACE_DIR / "releases"
    notes = sorted(releases_dir.glob("v*_NOTES.md"), key=lambda p: p.stat().st_mtime, reverse=True)
    if notes:
        try:
            content = notes[0].read_text(encoding="utf-8")
            # Truncate nếu dài quá giới hạn telegram (4096 ký tự)
            if len(content) > 3500:
                content = content[:3500] + "\n\n... (Đã rút gọn)"
            return f"📄 *BÁO CÁO PHÁT HÀNH ({notes[0].name})*:\n\n{content}"
        except Exception as e:
            return f"❌ Lỗi đọc báo cáo: {e}"
    return "Chưa tìm thấy file ghi chú phát hành trong thư mục `releases/`."

def record_incoming_request(username: str, text: str) -> None:
    entry = {
        "timestamp": datetime.now().isoformat(),
        "sender": username,
        "request_text": text
    }
    with open(INBOX_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    log(f"Đã lưu yêu cầu mới từ @{username}: {text[:50]}...")

def load_saved_chat_id() -> str | None:
    if CHAT_ID_FILE.exists():
        try:
            return CHAT_ID_FILE.read_text().strip()
        except Exception:
            return None
    return None

def save_chat_id(chat_id: str | int) -> None:
    try:
        CHAT_ID_FILE.parent.mkdir(parents=True, exist_ok=True)
        CHAT_ID_FILE.write_text(str(chat_id))
    except Exception as e:
        log(f"Lỗi lưu chat_id: {e}")

def main():
    log("=== KHỞI ĐỘNG TOAD TELEGRAM BRIDGE ===")
    log(f"Người dùng được cấp quyền: @{ALLOWED_USERNAME}")

    # Lấy thông tin bot
    me = api_call("getMe")
    if me.get("ok"):
        bot_user = me["result"].get("username", "UnknownBot")
        log(f"Kết nối thành công tới Bot: @{bot_user}")
    else:
        log("❌ Không thể kết nối với Token đã cung cấp. Vui lòng kiểm tra lại Token!")
        return

    saved_chat_id = load_saved_chat_id()
    if saved_chat_id:
        log(f"Đã nạp chat_id đã lưu: {saved_chat_id}")
        send_message(saved_chat_id, "🐸 *Toad Telegram Bridge đã khởi động!*\nNhập `/help` để xem danh sách lệnh.")

    last_update_id = 0
    last_report_time = time.time()
    REPORT_INTERVAL_SEC = 3600  # Báo cáo định kỳ mỗi 1 tiếng (tùy chỉnh)

    try:
        while True:
            # 1. Long polling lấy tin nhắn
            updates = api_call("getUpdates", {"offset": last_update_id + 1, "timeout": 20})
            if updates.get("ok"):
                for upd in updates.get("result", []):
                    last_update_id = upd["update_id"]
                    msg = upd.get("message", {})
                    chat = msg.get("chat", {})
                    chat_id = chat.get("id")
                    from_user = msg.get("from", {})
                    username = (from_user.get("username") or "").lower()
                    text = (msg.get("text") or "").strip()

                    # Kiểm tra quyền: chỉ nhận tin nhắn từ @HelloKittyXamKinLung
                    if username != ALLOWED_USERNAME:
                        log(f"Bỏ qua tin nhắn từ người dùng lạ: @{username} (ID: {chat_id})")
                        send_message(chat_id, "⛔ Bạn không có quyền truy cập bot này.", parse_mode="")
                        continue

                    # Lưu lại chat_id nếu là tin nhắn đầu
                    if str(chat_id) != saved_chat_id:
                        saved_chat_id = str(chat_id)
                        save_chat_id(saved_chat_id)
                        log(f"Đã lưu chat_id của @{username}: {saved_chat_id}")

                    log(f"Nhận tin từ @{username}: {text}")

                    # Xử lý các lệnh
                    if text.startswith("/start"):
                        welcome = (
                            f"👋 Xin chào @{username}!\n\n"
                            "Toad Bridge đang hoạt động. Các lệnh khả dụng:\n"
                            "• `/status` : Xem trạng thái workspace & bản đóng gói\n"
                            "• `/report` : Xem nội dung release notes mới nhất\n"
                            "• `/ping` : Kiểm tra kết nối\n"
                            "• `/help` : Hướng dẫn sử dụng\n\n"
                            "Hoặc *gửi tin nhắn văn bản bất kỳ* để đẩy yêu cầu/phương án mới vào hàng đợi hệ thống!"
                        )
                        send_message(chat_id, welcome)

                    elif text.startswith("/status"):
                        send_message(chat_id, get_workspace_status())

                    elif text.startswith("/report"):
                        send_message(chat_id, get_latest_report())

                    elif text.startswith("/ping"):
                        send_message(chat_id, "🏓 Pong! Hệ thống hoạt động bình thường.")

                    elif text.startswith("/help"):
                        help_text = (
                            "📖 *DANH SÁCH LỆNH TOAD BRIDGE*:\n"
                            "• `/status` : Báo cáo trạng thái hiện tại\n"
                            "• `/report` : Xem release notes mới nhất\n"
                            "• `/ping` : Ping kiểm tra bot\n"
                            "• Gửi văn bản tự do: Ghi nhận yêu cầu/phương án mới vào `telegram_inbox.jsonl`."
                        )
                        send_message(chat_id, help_text)

                    elif text:
                        # Ghi nhận yêu cầu / phương án mới
                        record_incoming_request(username, text)
                        reply = (
                            "✅ *Đã tiếp nhận yêu cầu mới!*\n\n"
                            f"Nội dung: _\"{text}\"_\n"
                            f"Thời gian: `{datetime.now().strftime('%H:%M:%S %d/%m/%Y')}`\n"
                            "Đã ghi vào hàng đợi `telegram_inbox.jsonl`."
                        )
                        send_message(chat_id, reply)

            # 2. Báo cáo định kỳ
            now = time.time()
            if saved_chat_id and (now - last_report_time > REPORT_INTERVAL_SEC):
                last_report_time = now
                log("Đang gửi báo cáo định kỳ tới Telegram...")
                send_message(saved_chat_id, f"⏰ *BÁO CÁO ĐỊNH KỲ*\n\n{get_workspace_status()}")

            time.sleep(1)

    except KeyboardInterrupt:
        log("Dừng Toad Telegram Bridge bởi người dùng.")

if __name__ == "__main__":
    main()
