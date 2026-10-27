param(
    [string]$TargetUsername = "HelloKittyXamKinLung",
    [int]$TimeoutSeconds = 900
)

$token = "8735945052:AAFvEYN0vkBV5tJKu8xMyWbPOtoCY14x-Qg"
$botBase = "https://api.telegram.org/bot$token"

Write-Host "Starting Telegram polling daemon for @$TargetUsername (Timeout: ${TimeoutSeconds}s)..."
$elapsed = 0
$foundChatId = $null

while ($elapsed -lt $TimeoutSeconds) {
    try {
        $jsonText = & curl.exe -s "$botBase/getUpdates"
        $resp = $jsonText | ConvertFrom-Json
        
        if ($resp -and $resp.ok -and $resp.result -and $resp.result.Count -gt 0) {
            foreach ($upd in $resp.result) {
                if ($upd.message) {
                    $user = $upd.message.from.username
                    $cid = $upd.message.chat.id
                    Write-Host "Detected message from: @$user (chat_id: $cid): $($upd.message.text)"
                    
                    if ($user -and ($user.ToLower() -eq $TargetUsername.ToLower())) {
                        $foundChatId = $cid
                        break
                    }
                    if (-not $foundChatId) {
                        $foundChatId = $cid
                    }
                }
            }
            if ($foundChatId) {
                break
            }
        }
    } catch {
        Write-Host "Warning: Polling request error: $_"
    }

    Start-Sleep -Seconds 3
    $elapsed += 3
}

if (-not $foundChatId) {
    Write-Host "Timeout reached (${TimeoutSeconds}s). No message received from @$TargetUsername."
    exit 0
}

Write-Host "Connecting with Chat ID: $foundChatId..."

$introMsg = "Toad v1.3.7.5 Portable Release (SQL Escape Fix, Frozen Expander Column, Smart Vertical Arrow Navigation). Due to Telegram Bot API 50MB per-file limit, the 92.25MB package is split into 3 parts (.7z.001, .7z.002, .7z.003). Please download all 3 files and extract .001 with 7-Zip or WinRAR."
& curl.exe -s -X POST "$botBase/sendMessage" -d "chat_id=$foundChatId" -d "text=$introMsg"

$files = @(
    "d:\Shared_UserData\Downloads\tad\releases\toad_v1.3.7.5_portable.7z.001",
    "d:\Shared_UserData\Downloads\tad\releases\toad_v1.3.7.5_portable.7z.002",
    "d:\Shared_UserData\Downloads\tad\releases\toad_v1.3.7.5_portable.7z.003"
)

$idx = 1
foreach ($f in $files) {
    if (Test-Path $f) {
        Write-Host "Uploading part $idx/3 ($f)..."
        $caption = "Toad v1.3.7.5 Portable - Volume $idx of 3"
        $uploadResp = & curl.exe -F "chat_id=$foundChatId" -F "caption=$caption" -F "document=@$f" "$botBase/sendDocument"
        Write-Host "Part $idx response: $uploadResp"
        $idx++
    }
}

Write-Host "All release archives delivered successfully to Telegram chat $foundChatId!"
