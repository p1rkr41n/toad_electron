param (
    [string]$AppName = "Toad",
    [string]$Version = "2.6.0",
    [string]$Publisher = "HelloKittyXamKinLung"
)

$targetScript = Join-Path $PSScriptRoot "..\package_release.ps1"
if (-not (Test-Path $targetScript)) {
    throw "Target packaging script not found at $targetScript"
}

& $targetScript -AppName $AppName -Version $Version -Publisher $Publisher
