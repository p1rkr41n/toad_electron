$jj = "C:\Users\huydq\.cargo\bin\jj.exe"
$commits = @("7cf329c2", "6d9c5cdb", "638e5419", "6df573ac", "7cf9cfee", "43c6974c", "4fa1c00d", "73915649", "40a881d8", "a54962c1")
foreach ($c in $commits) {
    Write-Host "================== Commit $c =================="
    & $jj show $c --stat
}
