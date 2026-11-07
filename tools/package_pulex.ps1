param (
    [string]$AppName = "Pulex",
    [string]$Version = "3.0.0-beta",
    [string]$Publisher = "HelloKittyXamKinLung"
)

$targetScript = Join-Path $PSScriptRoot "..\tauri\project\tools\package_pulex.ps1"
if (-not (Test-Path $targetScript)) {
    throw "Target packaging script not found at $targetScript"
}

& $targetScript -AppName $AppName -Version $Version -Publisher $Publisher

