[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$PackagePath)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $projectRoot ('release\package-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -ErrorAction Stop | Out-Null
$verifier = Join-Path $PSScriptRoot 'verify-portable-package.ps1'
& $verifier -PackagePath $PackagePath
foreach ($testCase in @('unexpected-file', 'tampered-executable')) {
    $copy = Join-Path $testRoot ($testCase + '.zip')
    Copy-Item -LiteralPath $PackagePath -Destination $copy -ErrorAction Stop
    $archive = [System.IO.Compression.ZipFile]::Open($copy, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        if ($testCase -eq 'tampered-executable') { $archive.GetEntry('ModelPort.exe').Delete() }
        $name = if ($testCase -eq 'unexpected-file') { 'chat-backup.json' } else { 'ModelPort.exe' }
        $writer = [System.IO.StreamWriter]::new($archive.CreateEntry($name).Open())
        try { $writer.Write('synthetic invalid fixture') } finally { $writer.Dispose() }
    } finally { $archive.Dispose() }
    $rejected = $false
    try { & $verifier -PackagePath $copy } catch { $rejected = $true }
    if (-not $rejected) { throw "包安全检查未拒绝异常：$testCase" }
}
Write-Host 'PASS: 含额外资料文件或被篡改的程序包都会被拒绝；原程序包未修改。'
