$jj = "C:\Users\huydq\.cargo\bin\jj.exe"
if (-not (Test-Path $jj)) {
    $jj = "D:\Shared_UserData\Downloads\tad\tools\jj\jj.exe"
}

Write-Host "JJ Binary: $jj"

Write-Host "`n=== JJ STATUS ==="
& $jj status

Write-Host "`n=== JJ LOG -n 8 ==="
& $jj log -n 8 --template 'commit_id: {commit_id|short} | change_id: {change_id|short} | author: {author} | bookmarks: {bookmarks}\ndescription: {description|first_line}\n---\n'

Write-Host "`n=== GIT LOG -n 5 ==="
git log -n 5 --format="commit: %h | author: %an <%ae> | date: %ad | %s"
