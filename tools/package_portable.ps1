param (
    [string]$AppName = "Toad",
    [string]$Version = "2.5.2.2",
    [string]$Publisher = "HelloKittyXamKinLung"
)

$targetScript = Join-Path $PSScriptRoot "..\tauri\project\tools\package_portable.ps1"
if (-not (Test-Path $targetScript)) {
    throw "Target packaging script not found at $targetScript"
}

& $targetScript -AppName $AppName -Version $Version -Publisher $Publisher
