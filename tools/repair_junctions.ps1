<#
.SYNOPSIS
    Monorepo NTFS Junction repair and verification utility for Toad.

.DESCRIPTION
    Scans and repairs all 22 inter-package NTFS Junctions across
    `tad-master\packages\*\node_modules\*` to point dynamically to the current
    monorepo location `<rootDir>\tad-master\packages\<package>`.

.PARAMETER RootDir
    Root directory of the Toad repository. Defaults to the parent directory of this script.

.PARAMETER VerifyOnly
    When set, only verifies the health and targets of existing junctions without modifying them.

.EXAMPLE
    .\tools\repair_junctions.ps1
    .\tools\repair_junctions.ps1 -RootDir "D:\Shared_UserData\Downloads\_Software_Installers\toad"
    .\tools\repair_junctions.ps1 -VerifyOnly
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$RootDir = "",

    [Parameter(Mandatory = $false)]
    [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"

# 1. Resolve repository root directory
if ([string]::IsNullOrWhiteSpace($RootDir)) {
    $RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    if (-not (Test-Path -LiteralPath $RootDir)) {
        Write-Error "Specified RootDir does not exist: $RootDir"
        exit 1
    }
    $RootDir = (Resolve-Path $RootDir).Path
}
$RootDir = $RootDir.TrimEnd('\', '/')

$pkgsDir = Join-Path $RootDir "tad-master\packages"
if (-not (Test-Path -LiteralPath $pkgsDir)) {
    Write-Error "Monorepo packages directory not found at: $pkgsDir"
    exit 1
}

Write-Output "================================================================="
Write-Output "  TOAD MONOREPO NTFS JUNCTION REPAIR & VERIFICATION"
Write-Output "  Root Directory    : $RootDir"
Write-Output "  Packages Directory: $pkgsDir"
Write-Output "  Mode              : $(if ($VerifyOnly) { 'Verify-Only' } else { 'Repair & Verify' })"
Write-Output "================================================================="

# 2. Canonical list of all 22 monorepo package dependencies
$expectedJunctions = @(
    @{ Source = "aggtree";           Target = "reltab" },
    @{ Source = "aggtree";           Target = "reltab-sqlite" },
    @{ Source = "host-bridge";       Target = "reltab" },
    @{ Source = "reltab-aws-athena"; Target = "aggtree" },
    @{ Source = "reltab-aws-athena"; Target = "reltab" },
    @{ Source = "reltab-bigquery";   Target = "aggtree" },
    @{ Source = "reltab-bigquery";   Target = "reltab" },
    @{ Source = "reltab-duckdb";     Target = "reltab" },
    @{ Source = "reltab-fs";         Target = "reltab" },
    @{ Source = "reltab-fs";         Target = "reltab-duckdb" },
    @{ Source = "reltab-snowflake";  Target = "aggtree" },
    @{ Source = "reltab-snowflake";  Target = "reltab" },
    @{ Source = "reltab-sqlite";     Target = "reltab" },
    @{ Source = "toad-app";          Target = "aggtree" },
    @{ Source = "toad-app";          Target = "host-bridge" },
    @{ Source = "toad-app";          Target = "reltab" },
    @{ Source = "toad-app";          Target = "reltab-duckdb" },
    @{ Source = "toad-app";          Target = "reltab-fs" },
    @{ Source = "toad-app";          Target = "toadviewer" },
    @{ Source = "toadviewer";        Target = "aggtree" },
    @{ Source = "toadviewer";        Target = "host-bridge" },
    @{ Source = "toadviewer";        Target = "reltab" }
)

# Also dynamically scan for any existing reparse points in node_modules
$discoveredMap = @{}
foreach ($def in $expectedJunctions) {
    $key = "$($def.Source):$($def.Target)"
    $discoveredMap[$key] = $def
}

Get-ChildItem -LiteralPath $pkgsDir -Directory | ForEach-Object {
    $srcPkg = $_.Name
    $nmPath = Join-Path $_.FullName "node_modules"
    if (Test-Path -LiteralPath $nmPath) {
        Get-ChildItem -LiteralPath $nmPath -Force -ErrorAction SilentlyContinue | Where-Object {
            $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint
        } | ForEach-Object {
            $linkName = $_.Name
            $key = "$($srcPkg):$($linkName)"
            if (-not $discoveredMap.ContainsKey($key)) {
                # Discovered an additional junction
                $discoveredMap[$key] = @{ Source = $srcPkg; Target = $linkName }
            }
        }
    }
}

$allJunctions = $discoveredMap.Values | Sort-Object { "$($_.Source)\$($_.Target)" }
Write-Output "Identified $($allJunctions.Count) junction targets to process.`n"

# Helper function to check if item is a reparse point
function Test-IsReparsePoint([string]$Path) {
    if (-not [System.IO.Directory]::Exists($Path) -and -not [System.IO.File]::Exists($Path) -and -not (Test-Path -LiteralPath $Path)) {
        return $false
    }
    try {
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        return [bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
    } catch {
        return $false
    }
}

# Helper to get junction target
function Get-JunctionTarget([string]$Path) {
    try {
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if ($item.Target -and $item.Target.Count -gt 0) {
            return $item.Target[0]
        }
        return ""
    } catch {
        return ""
    }
}

# Helper to safely remove reparse point
function Remove-ReparsePointSafe([string]$Path) {
    if ([System.IO.Directory]::Exists($Path) -or [System.IO.File]::Exists($Path) -or (Test-Path -LiteralPath $Path)) {
        try {
            $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
            if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                $item.Delete()
                return $true
            }
        } catch {
            Write-Warning "Failed to delete reparse point via Get-Item.Delete(): $($_.Exception.Message)"
        }
        try {
            [System.IO.Directory]::Delete($Path)
            return $true
        } catch {
            Write-Warning "Directory::Delete failed: $($_.Exception.Message)"
        }
    }
    return $false
}

$results = @()
$hasErrors = $false

foreach ($junc in $allJunctions) {
    $srcPkgName = $junc.Source
    $targetPkgName = $junc.Target
    $srcPkgDir = Join-Path $pkgsDir $srcPkgName
    $nodeModulesDir = Join-Path $srcPkgDir "node_modules"
    $linkPath = Join-Path $nodeModulesDir $targetPkgName
    $targetPkgDir = Join-Path $pkgsDir $targetPkgName

    $status = "UNKNOWN"
    $actionTaken = "None"
    $currentTarget = ""

    # Check if target package directory actually exists
    if (-not (Test-Path -LiteralPath $targetPkgDir)) {
        $status = "FAILED: Target package directory does not exist ($targetPkgDir)"
        $hasErrors = $true
        $results += [PSCustomObject]@{
            Package  = $srcPkgName
            Link     = $targetPkgName
            Status   = $status
            Action   = $actionTaken
            LinkPath = $linkPath
            Target   = $targetPkgDir
        }
        continue
    }

    $isReparse = Test-IsReparsePoint $linkPath
    if ($isReparse) {
        $currentTarget = Get-JunctionTarget $linkPath
    }

    # Normalize paths for comparison
    $normalizedCurrent = if ($currentTarget) { $currentTarget.TrimEnd('\', '/') } else { "" }
    $normalizedExpected = $targetPkgDir.TrimEnd('\', '/')

    $targetMatches = [string]::Equals($normalizedCurrent, $normalizedExpected, [System.StringComparison]::OrdinalIgnoreCase)
    $packageJsonPath = Join-Path $linkPath "package.json"
    $packageJsonValid = Test-Path -LiteralPath $packageJsonPath

    $isHealthy = $isReparse -and $targetMatches -and $packageJsonValid

    if ($VerifyOnly) {
        if ($isHealthy) {
            $status = "OK"
        } else {
            $status = "FAILED (Stale/Invalid Target: '$currentTarget', package.json: $packageJsonValid)"
            $hasErrors = $true
        }
    } else {
        # Repair mode
        if (-not $isHealthy) {
            # Safely remove existing stale link / item if present
            if ($isReparse -or (Test-Path -LiteralPath $linkPath) -or [System.IO.Directory]::Exists($linkPath)) {
                Remove-ReparsePointSafe $linkPath | Out-Null
                $actionTaken = "Deleted stale link; "
            }

            # Ensure parent node_modules exists
            if (-not (Test-Path -LiteralPath $nodeModulesDir)) {
                New-Item -ItemType Directory -Path $nodeModulesDir -Force | Out-Null
            }

            # Create new Junction
            try {
                New-Item -ItemType Junction -Path $linkPath -Target $targetPkgDir -Force | Out-Null
                $actionTaken += "Created Junction"
            } catch {
                $status = "FAILED: Could not create junction: $($_.Exception.Message)"
                $hasErrors = $true
                $results += [PSCustomObject]@{
                    Package  = $srcPkgName
                    Link     = $targetPkgName
                    Status   = $status
                    Action   = $actionTaken
                    LinkPath = $linkPath
                    Target   = $targetPkgDir
                }
                continue
            }

            # Re-verify after repair
            $postReparse = Test-IsReparsePoint $linkPath
            $postTarget = Get-JunctionTarget $linkPath
            $postPkgJson = Test-Path -LiteralPath (Join-Path $linkPath "package.json")

            $normPostTarget = if ($postTarget) { $postTarget.TrimEnd('\', '/') } else { "" }
            if ($postReparse -and [string]::Equals($normPostTarget, $normalizedExpected, [System.StringComparison]::OrdinalIgnoreCase) -and $postPkgJson) {
                $status = "REPAIRED"
            } else {
                $status = "FAILED: Verification failed after repair (Target: '$postTarget', package.json: $postPkgJson)"
                $hasErrors = $true
            }
        } else {
            $status = "OK (Already Healthy)"
        }
    }

    $results += [PSCustomObject]@{
        Package  = $srcPkgName
        Link     = $targetPkgName
        Status   = $status
        Action   = $actionTaken
        LinkPath = $linkPath
        Target   = $targetPkgDir
    }
}

# Display results table
$results | Format-Table -Property Package, Link, Status, Action -AutoSize

$okCount = @($results | Where-Object { $_.Status -match "^(OK|REPAIRED)" }).Count
$failCount = @($results | Where-Object { $_.Status -match "^FAILED" }).Count

Write-Output "-----------------------------------------------------------------"
Write-Output "SUMMARY: Total: $($results.Count) | Succeeded: $okCount | Failed: $failCount"
Write-Output "================================================================="

if ($hasErrors -or $failCount -gt 0) {
    Write-Error "Monorepo junction verification/repair failed with $failCount error(s)!"
    exit 1
}

Write-Output "All $okCount monorepo junctions are verified healthy."
exit 0
