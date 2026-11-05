$jj = "C:\Users\huydq\.cargo\bin\jj.exe"
$out = & $jj log -r "::7cf329c2"
$lines = $out -split "\r?\n"
$commits = @()
$recent = @()
foreach ($line in $lines) {
    if ($line -match '([a-z0-9]{8})\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s+([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2})') {
        $changeId = $Matches[1]
        $email = $Matches[2]
        $date = $Matches[3]
        if ($date -ge "2026-11-04 18:00:00") {
            $recent += [PSCustomObject]@{
                ChangeId = $changeId
                Email = $email
                Date = $date
            }
        }
    }
}
Write-Host "Total commits in ::7cf329c2 since 2026-11-04 18:00:00: $($recent.Count)"
$nonCompliant = $recent | Where-Object { $_.Email -ne "p1rkr41n@users.noreply.github.com" }
Write-Host "Non-compliant commits: $($nonCompliant.Count)"
$recent | Format-Table -AutoSize
