param(
    [switch]$ReplaceExisting,
    [switch]$PackageOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseDir = Join-Path $projectRoot 'release'
$outputExe = Join-Path $releaseDir 'ModelPort.exe'
$packageFiles = @('LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses\Apache-2.0.txt', 'licenses\Geist-OFL-1.1.txt', '启动 ModelPort.cmd')
foreach ($relativePath in $packageFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) {
        throw "缺少发布所需文件：$relativePath"
    }
}

function Copy-PortableNotices {
    foreach ($relativePath in $packageFiles) {
        $destination = Join-Path $releaseDir $relativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination $destination -Force -ErrorAction Stop
    }
}

if ($env:CARGO_TARGET_DIR) {
    if ([System.IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)) {
        $targetDir = $env:CARGO_TARGET_DIR
    } else {
        $targetDir = Join-Path $projectRoot $env:CARGO_TARGET_DIR
    }
} else {
    $targetDir = Join-Path $projectRoot 'src-tauri\target'
}

$builtExe = Join-Path $targetDir 'release\modelport.exe'

function Get-PortableSha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
    } finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\.bin\tauri.cmd') -PathType Leaf)) {
    throw '缺少项目依赖。请先在项目根目录运行 npm ci。'
}

if (-not $PackageOnly) {
  Push-Location -LiteralPath $projectRoot
  try {
    # Tauri's release build and a later plain Cargo build share the same output
    # filename. Clear only this package's release artifacts so Cargo cannot reuse
    # an executable that was compiled without Tauri's embedded frontend assets.
    & cargo clean --manifest-path (Join-Path $projectRoot 'src-tauri\Cargo.toml') --package modelport --release
    if ($LASTEXITCODE -ne 0) {
        throw "清理 ModelPort 发布产物失败，退出码：$LASTEXITCODE"
    }

    & npm.cmd run tauri build -- --no-bundle
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri 构建失败，退出码：$LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath $builtExe -PathType Leaf)) {
    throw "构建完成，但没有找到程序：$builtExe"
}

if ($PackageOnly) {
    # shortcut: version-only check; use a full build whenever source or frontend assets changed.
    $expectedVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
    $artifactVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($builtExe).ProductVersion
    if ($artifactVersion -ne $expectedVersion) {
        throw "发布文件版本 $artifactVersion 与项目版本 $expectedVersion 不符，请先完成 Tauri 发布构建。"
    }
}

if (Test-Path -LiteralPath $outputExe -PathType Leaf) {
    $builtHash = Get-PortableSha256 $builtExe
    $outputHash = Get-PortableSha256 $outputExe
    if ($builtHash -eq $outputHash) {
        Copy-PortableNotices
        Write-Host "程序已是当前构建版本：$outputExe"
        exit 0
    }
    if (-not $ReplaceExisting) {
        throw "已存在不同版本：$outputExe。确认要更新后，重新运行脚本并添加 -ReplaceExisting；旧版会归档到 release\archive。"
    }
}

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$stagingPath = Join-Path $releaseDir ('.ModelPort-' + [guid]::NewGuid().ToString('N') + '.exe')
$backupPath = $null

try {
    Copy-Item -LiteralPath $builtExe -Destination $stagingPath -ErrorAction Stop

    if (Test-Path -LiteralPath $outputExe -PathType Leaf) {
        $archiveDir = Join-Path $releaseDir 'archive'
        New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
        $backupName = 'ModelPort-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.exe'
        $backupPath = Join-Path $archiveDir $backupName
        Move-Item -LiteralPath $outputExe -Destination $backupPath -ErrorAction Stop
    }

    try {
        Move-Item -LiteralPath $stagingPath -Destination $outputExe -ErrorAction Stop
    } catch {
        if ($backupPath -and -not (Test-Path -LiteralPath $outputExe)) {
            Move-Item -LiteralPath $backupPath -Destination $outputExe -ErrorAction Stop
        }
        throw
    }
} finally {
    if (Test-Path -LiteralPath $stagingPath) {
        Remove-Item -LiteralPath $stagingPath -Force
    }
}

Write-Host "已生成：$outputExe"
Copy-PortableNotices
if ($backupPath) {
    Write-Host "旧版已归档：$backupPath"
}
