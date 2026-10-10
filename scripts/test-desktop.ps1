[CmdletBinding()]
param([string]$Executable = 'release\ModelPort.exe')

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$appPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $Executable))
if (-not $appPath.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    [System.IO.Path]::GetFileName($appPath) -ine 'ModelPort.exe') { throw '只允许检查本项目的 ModelPort 程序。' }
if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) { throw '请先构建程序，再运行桌面检查。' }
$null = Get-Command node -ErrorAction Stop
if ([int]((& node --version).TrimStart('v').Split('.')[0]) -lt 24) { throw '桌面检查需要 Node.js 24 或更新版本。' }

$testRoot = Join-Path $projectRoot ('release\desktop-regression-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -ErrorAction Stop | Out-Null
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
try { $listener.Start(); $debugPort = $listener.LocalEndpoint.Port } finally { $listener.Stop() }
$priorProfile = $env:WEBVIEW2_USER_DATA_FOLDER
$priorArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$testApp = $null
$results = [System.Collections.Generic.List[object]]::new()
$suites = @('verify-desktop-ui.mjs', 'verify-keyboard-shortcuts.mjs', 'verify-chat-recovery.mjs',
    'verify-chat-performance.mjs', 'verify-providers.mjs', 'verify-mcp.mjs', 'verify-composer-layout.mjs')

Push-Location -LiteralPath $projectRoot
try {
    try {
        $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $testRoot 'webview'
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$debugPort"
        $testApp = Start-Process -FilePath $appPath -WindowStyle Hidden -PassThru
    } finally {
        $env:WEBVIEW2_USER_DATA_FOLDER = $priorProfile
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $priorArguments
    }
    foreach ($suite in $suites) {
        Write-Host "检查：$suite"
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        $arguments = @((Join-Path $PSScriptRoot $suite), [string]$debugPort)
        if ($suite -eq 'verify-desktop-ui.mjs') { $arguments += (Join-Path $testRoot 'ui-failure.png') }
        & node @arguments 2>&1 | Tee-Object -FilePath (Join-Path $testRoot ($suite + '.log'))
        $exitCode = $LASTEXITCODE
        $results.Add([pscustomobject]@{ suite = $suite; passed = ($exitCode -eq 0); seconds = [math]::Round($watch.Elapsed.TotalSeconds, 2) })
        if ($exitCode -ne 0) { throw "桌面检查失败：$suite。已停止后续检查；记录在 $testRoot" }
    }
    Write-Host "全部 $($suites.Count) 组桌面检查通过。隔离测试资料：$testRoot"
} finally {
    if ($testApp) {
        $ownedProcess = Get-Process -Id $testApp.Id -ErrorAction SilentlyContinue
        if ($ownedProcess -and $ownedProcess.Path -eq $appPath -and $ownedProcess.StartTime -eq $testApp.StartTime) {
            [void]$ownedProcess.CloseMainWindow()
            if (-not $ownedProcess.WaitForExit(5000)) { Stop-Process -Id $ownedProcess.Id -ErrorAction Stop }
        }
    }
    $report = [pscustomobject]@{ executable = $appPath; profile = $testRoot; total = $suites.Count; completed = $results.Count;
        passed = ($results.Count -eq $suites.Count -and -not ($results | Where-Object { -not $_.passed })); results = @($results.ToArray()) }
    [System.IO.File]::WriteAllText((Join-Path $testRoot 'report.json'), ($report | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
    Pop-Location
}
