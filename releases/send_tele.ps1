param(
    [string]$TargetUsername = "HelloKittyXamKinLung"
)

$token = "8735945052:AAFvEYN0vkBV5tJKu8xMyWbPOtoCY14x-Qg"
$botBase = "https://api.telegram.org/bot$token"

Write-Host "Fetching updates from bot @hskfsdbot..."
$jsonText = & curl.exe -s "$botBase/getUpdates"
$resp = $jsonText | ConvertFrom-Json

if (-not $resp.ok) {
    Write-Error "Telegram API returned error: $jsonText"
    exit 1
}

if ($resp.result.Count -eq 0) {
    Write-Host "No messages received yet. User @$TargetUsername needs to send /start to @hskfsdbot first."
    exit 0
}

# Find message from target user or take latest
$foundChatId = $null
foreach ($upd in $resp.result) {
    if ($upd.message) {
        $user = $upd.message.from.username
        Write-Host "Found message from user: @$user, chat_id: $($upd.message.chat.id), text: $($upd.message.text)"
        if ($user -and ($user.ToLower() -eq $TargetUsername.ToLower())) {
            $foundChatId = $upd.message.chat.id
        }
    }
}

if (-not $foundChatId -and $resp.result.Count -gt 0) {
    $lastMsg = $resp.result[-1].message
    if ($lastMsg) {
        $foundChatId = $lastMsg.chat.id
        Write-Host "Target username @$TargetUsername not directly matched, using latest chat_id: $foundChatId"
    }
}

if ($foundChatId) {
    Write-Host "Target Chat ID: $foundChatId. Sending release files..."
    
    $introText = "Toad v1.3.7.4 Portable (Native Disk I/O Ingest Tracking -10%). Telegram Bot API limits files to 50MB. Split into 3 parts (.7z.001, .7z.002, .7z.003). Download all 3 parts into the same folder and extract .001 with 7-Zip or WinRAR."
    & curl.exe -s -X POST "$botBase/sendMessage" -d "chat_id=$foundChatId" -d "text=$introText"
    
    $files = @(
        "d:\Shared_UserData\Downloads\tad\releases\toad_v1.3.7.4_portable.7z.001",
        "d:\Shared_UserData\Downloads\tad\releases\toad_v1.3.7.4_portable.7z.002",
        "d:\Shared_UserData\Downloads\tad\releases\toad_v1.3.7.4_portable.7z.003"
    )
    
    $partIdx = 1
    foreach ($f in $files) {
        if (Test-Path $f) {
            Write-Host "Uploading $f (Part $partIdx/3)..."
            $caption = "Toad v1.3.7.4 Portable - Part $partIdx/3"
            & curl.exe -F "chat_id=$foundChatId" -F "caption=$caption" -F "document=@$f" "$botBase/sendDocument"
            Write-Host "Part $partIdx upload complete."
            $partIdx++
        }
    }
    
    Write-Host "All files sent successfully to chat_id: $foundChatId!"
}
