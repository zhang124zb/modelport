[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$PackagePath)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expectedVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$expected = @('ModelPort.exe', '启动 ModelPort.cmd', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'licenses/Apache-2.0.txt', 'licenses/Geist-OFL-1.1.txt', 'PORTABLE_README.txt', 'SHA256SUMS.txt', 'package-info.json')
$archive = [System.IO.Compression.ZipFile]::OpenRead([System.IO.Path]::GetFullPath($PackagePath))
try {
    $names = @($archive.Entries | ForEach-Object FullName)
    if ($names.Count -ne $expected.Count -or (Compare-Object $expected $names)) { throw 'ZIP 文件清单异常：存在缺失、重复或非允许文件。' }
    $reader = [System.IO.StreamReader]::new($archive.GetEntry('SHA256SUMS.txt').Open())
    try { $lines = @($reader.ReadToEnd().TrimEnd() -split "`n") } finally { $reader.Dispose() }
    if ($lines.Count -ne 7) { throw '校验文件清单异常。' }
    $checked = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($line in $lines) {
        if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw '校验值格式异常。' }
        $expectedHash = $Matches[1]; $name = $Matches[2].TrimEnd("`r")
        if ($name -notin $expected[0..6] -or -not $checked.Add($name)) { throw '校验文件不是允许的唯一程序文件。' }
        $stream = $archive.GetEntry($name).Open()
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        try { $actual = [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose(); $algorithm.Dispose() }
        if ($actual -ne $expectedHash) { throw "ZIP 文件校验失败：$name" }
        $source = if ($name -eq 'ModelPort.exe') { Join-Path $projectRoot 'release/ModelPort.exe' } else { Join-Path $projectRoot $name }
        if ($actual -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()) { throw "ZIP 与当前发布文件不同：$name" }
    }
    $reader = [System.IO.StreamReader]::new($archive.GetEntry('package-info.json').Open())
    try { $metadata = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($metadata.version -ne $expectedVersion -or $metadata.platform -ne 'windows' -or $metadata.architecture -ne 'x64' -or $metadata.codeSigned -ne $false -or
        $metadata.executableSha256 -ne (Get-FileHash -LiteralPath (Join-Path $projectRoot 'release/ModelPort.exe') -Algorithm SHA256).Hash.ToLowerInvariant()) { throw '发布元数据不匹配。' }
    Write-Host 'PASS: ZIP 仅包含 9 个允许的程序 / 许可 / 说明文件，全部内容校验正确，不含缓存或用户资料。'
} finally { $archive.Dispose() }
