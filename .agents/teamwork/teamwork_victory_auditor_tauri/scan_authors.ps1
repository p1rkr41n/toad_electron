$jj = "C:\Users\huydq\.cargo\bin\jj.exe"
$out = & $jj log -r "all()"
$lines = $out -split "\r?\n"
$emails = @{}
foreach ($l in $lines) {
    if ($l -match '(?<email>[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})') {
        $em = $Matches['email']
        $emails[$em] = ($emails[$em] -as [int]) + 1
    }
}
Write-Host "Found emails in jj log:"
$emails.GetEnumerator() | ForEach-Object { Write-Host "$($_.Key): $($_.Value)" }
