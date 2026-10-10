[CmdletBinding()]
param([switch]$ReplaceExisting)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = Join-Path $projectRoot 'release'
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw '发布版本号无效。' }
$appPath = Join-Path $releaseRoot 'ModelPort.exe'
if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) { throw '请先完成 Tauri 发布构建。' }
if ([System.Diagnostics.FileVersionInfo]::GetVersionInfo($appPath).ProductVersion -ne $version) { throw '程序版本与源码不同，请先运行完整发布构建。' }

# Exact allowlist: never archive the release folder, profiles, caches or user data.
$files = @('ModelPort.exe', '启动 ModelPort.cmd', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'licenses/Apache-2.0.txt', 'licenses/Geist-OFL-1.1.txt', 'PORTABLE_README.txt')
$sources = @{}
foreach ($file in $files) {
    $source = if ($file -eq 'ModelPort.exe') { $appPath } else { Join-Path $projectRoot $file }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "缺少发布文件：$file" }
    if ((Get-Item -LiteralPath $source -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "发布文件是链接，请先核对：$file" }
    $sources[$file] = $source
}
$outputPath = Join-Path $releaseRoot "ModelPort-$version-windows-x64.zip"
if ((Test-Path -LiteralPath $outputPath) -and -not $ReplaceExisting) { throw '程序包已存在；确认更新后添加 -ReplaceExisting，旧包会归档保留。' }
$stagingPath = Join-Path $releaseRoot ('.portable-' + [guid]::NewGuid().ToString('N') + '.zip')
$archive = $null
try {
    $archive = [System.IO.Compression.ZipFile]::Open($stagingPath, [System.IO.Compression.ZipArchiveMode]::Create)
    $checksums = [System.Collections.Generic.List[string]]::new()
    foreach ($file in $files) {
        $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $sources[$file], $file, [System.IO.Compression.CompressionLevel]::Optimal)
        $checksums.Add(((Get-FileHash -LiteralPath $sources[$file] -Algorithm SHA256).Hash.ToLowerInvariant()) + '  ' + $file)
    }
    $baseCommit = & git -C $projectRoot rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw '无法读取源码提交信息。' }
    $sourceDirty = [bool](@(& git -C $projectRoot status --porcelain).Count)
    if ($LASTEXITCODE -ne 0) { throw '无法读取源码状态。' }
    $metadata = [pscustomobject]@{ product = 'ModelPort'; version = $version; platform = 'windows'; architecture = 'x64';
        packagedAt = [DateTime]::UtcNow.ToString('o'); sourceBaseCommit = $baseCommit.Trim(); sourceHasUncommittedChanges = $sourceDirty;
        executableSha256 = (Get-FileHash -LiteralPath $appPath -Algorithm SHA256).Hash.ToLowerInvariant(); codeSigned = $false }
    foreach ($entry in @(@{ name = 'SHA256SUMS.txt'; content = ($checksums -join "`n") + "`n" },
            @{ name = 'package-info.json'; content = ($metadata | ConvertTo-Json) + "`n" })) {
        $writer = [System.IO.StreamWriter]::new($archive.CreateEntry($entry.name).Open(), [System.Text.UTF8Encoding]::new($false))
        try { $writer.Write($entry.content) } finally { $writer.Dispose() }
    }
    $archive.Dispose(); $archive = $null
    & (Join-Path $PSScriptRoot 'verify-portable-package.ps1') -PackagePath $stagingPath
    if (Test-Path -LiteralPath $outputPath) {
        $archiveRoot = Join-Path $releaseRoot 'archive'
        New-Item -ItemType Directory -Path $archiveRoot -Force | Out-Null
        $oldPackage = Join-Path $archiveRoot ("ModelPort-$version-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N') + '.zip')
        Move-Item -LiteralPath $outputPath -Destination $oldPackage -ErrorAction Stop
    }
    Move-Item -LiteralPath $stagingPath -Destination $outputPath -ErrorAction Stop
    Write-Host "程序包：$outputPath"
    Write-Host "ZIP SHA-256：$((Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash)"
} finally {
    if ($archive) { $archive.Dispose() }
    if (Test-Path -LiteralPath $stagingPath -PathType Leaf) { Remove-Item -LiteralPath $stagingPath -Force }
}
