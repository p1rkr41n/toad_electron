param (
    [string]$AppName = "Toad",
    [string]$Version = "2.4.4",
    [string]$Publisher = "HelloKittyXamKinLung",
    [string]$ReleaseDir = "releases"
)

$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot ".agents\skills\releases\scripts\package_release.ps1"
& powershell -ExecutionPolicy Bypass -File $scriptPath -AppName $AppName -Version $Version -Publisher $Publisher -ReleaseDir $ReleaseDir
