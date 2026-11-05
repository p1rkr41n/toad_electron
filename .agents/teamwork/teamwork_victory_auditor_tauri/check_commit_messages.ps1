$jj = "C:\Users\huydq\.cargo\bin\jj.exe"
$commits = @("lpsokomu", "xxrmyklq", "yyvwmxks", "ymvtvzwm", "qmoozpuk", "kknlvvnq", "qnzpxkvn", "mvxwrymp", "xxqkplrt", "rxuqyyzx", "zknmrntn", "krrszmur", "zpzzzkrt", "qtrupsms", "unwuwolx", "tppstxzp", "yrkpvrwl", "zzmnykwo", "knnyptrm", "kpoxxopu", "nnssuzoz", "knronpkq", "rmorllxz", "yuknsxlq")

foreach ($c in $commits) {
    $out = & $jj show $c --no-patch
    Write-Host "--- Commit $($c) ---"
    $out -split "\r?\n" | Where-Object { $_ -match '^\s{4}\S' } | ForEach-Object { Write-Host $_ }
}
