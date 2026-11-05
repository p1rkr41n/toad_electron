$jj = "C:\Users\huydq\.cargo\bin\jj.exe"
$out = & $jj log -r "all()"
$lines = $out -split "\r?\n"
$results = @()
foreach ($line in $lines) {
    if ($line -match '([a-z0-9]{8})\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s+([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2})') {
        $changeId = $Matches[1]
        $email = $Matches[2]
        $date = $Matches[3]
        if ($email -ne "p1rkr41n@users.noreply.github.com") {
            $results += [PSCustomObject]@{
                ChangeId = $changeId
                Email = $email
                Date = $date
            }
        }
    }
}

Write-Host "Non-p1rkr41n commits count: $($results.Count)"
$results | Select-Object -First 10 | Format-Table -AutoSize
$results | Select-Object -Last 10 | Format-Table -AutoSize
