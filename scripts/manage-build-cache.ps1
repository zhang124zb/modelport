[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$CleanDebug)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$targetRoot = Join-Path $projectRoot 'src-tauri\target'
$debugRoot = [System.IO.Path]::GetFullPath((Join-Path $targetRoot 'debug'))
$releaseRoot = Join-Path $targetRoot 'release'
if (-not $debugRoot.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    $debugRoot -ne (Join-Path $projectRoot 'src-tauri\target\debug')) { throw '缓存路径超出本项目范围，未清理。' }

function Get-CacheBytes([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return [long]0 }
    $total = (Get-ChildItem -LiteralPath $Path -Recurse -File -Force | Measure-Object -Property Length -Sum).Sum
    return [long]$total
}
$debugBytes = Get-CacheBytes $debugRoot
[pscustomobject]@{ DebugPath = $debugRoot; DebugGiB = [math]::Round($debugBytes / 1GB, 2); ReleaseGiB = [math]::Round((Get-CacheBytes $releaseRoot) / 1GB, 2) }
if (-not $CleanDebug -or -not (Test-Path -LiteralPath $debugRoot -PathType Container)) { return }

foreach ($path in @($projectRoot, (Join-Path $projectRoot 'src-tauri'), $targetRoot, $debugRoot)) {
    if ((Get-Item -LiteralPath $path -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw '缓存目录包含链接或重定向，未清理。请手动核对。' }
}
if (Get-ChildItem -LiteralPath $debugRoot -Recurse -Force | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint } | Select-Object -First 1) { throw '缓存内部包含链接，未清理。' }
if (Get-Process -Name cargo,rustc,link -ErrorAction SilentlyContinue) { throw '检测到正在编译的进程，请等待构建结束后再清理。' }
if (Get-Process -Name modelport -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($debugRoot + '\', [StringComparison]::OrdinalIgnoreCase) }) { throw '调试程序仍在运行，请关闭后再清理。' }
if ($PSCmdlet.ShouldProcess($debugRoot, '删除可重新生成的本项目调试缓存；保留发布程序和发布缓存')) {
    Remove-Item -LiteralPath $debugRoot -Recurse -Force
    Write-Host "已清理约 $([math]::Round($debugBytes / 1GB, 2)) GiB 调试产物。源码与 release 未删除；下次开发需要重新编译。"
}
