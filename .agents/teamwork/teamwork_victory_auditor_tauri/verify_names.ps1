$jj = "C:\Users\huydq\.cargo\bin\jj.exe"
$commits = @("lpsokomu", "xxrmyklq", "yyvwmxks", "ymvtvzwm", "qmoozpuk", "kknlvvnq", "qnzpxkvn", "mvxwrymp", "xxqkplrt", "rxuqyyzx", "zknmrntn", "krrszmur", "zpzzzkrt", "qtrupsms", "unwuwolx", "tppstxzp", "yrkpvrwl", "zzmnykwo", "knnyptrm", "kpoxxopu", "nnssuzoz", "knronpkq", "rmorllxz", "yuknsxlq")

$bad = 0
foreach ($c in $commits) {
    $out = & $jj show $c --no-patch
    $hasAuthor = $false
    $hasCommitter = $false
    foreach ($l in ($out -split "\r?\n")) {
        if ($l -match '^Author\s*:\s*(.+)$') {
            $auth = $Matches[1]
            if ($auth -notmatch '^HelloKittyXamKinLung\s+<p1rkr41n@users\.noreply\.github\.com>') {
                Write-Host "Bad author in $($c): $auth"
                $bad++
            }
        }
        if ($l -match '^Committer\s*:\s*(.+)$') {
            $comm = $Matches[1]
            if ($comm -notmatch '^HelloKittyXamKinLung\s+<p1rkr41n@users\.noreply\.github\.com>') {
                Write-Host "Bad committer in $($c): $comm"
                $bad++
            }
        }
    }
}
Write-Host "Total checked: $($commits.Count), Bad count: $bad"
