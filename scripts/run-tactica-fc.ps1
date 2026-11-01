$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $projectRoot 'vendor\open-football\Cargo.toml'

$port = 5184
$existingListener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingListener) {
    $listenerProcessId = $existingListener.OwningProcess
    $processName = (Get-Process -Id $listenerProcessId -ErrorAction SilentlyContinue).ProcessName
    if (-not $processName) { $processName = 'unknown process' }
    Write-Host "Port $port is already in use by $processName (PID $listenerProcessId)." -ForegroundColor Yellow
    Write-Host 'If this is an older TACTICA FC server, stop it in its PowerShell window with Ctrl+C, then run npm run open-football again.'
    exit 1
}

$env:TACTICA_PORT = [string]$port
$env:TACTICA_NO_BROWSER = '1'
$env:OPEN_FOOTBALL_SKIP_MATCH_VIEWER = '1'
$env:MATCH_PLAY_POOL_MAX_THREADS = '4'
$env:MATCH_STORE_POOL_MAX_THREADS = '2'

Push-Location $projectRoot
try {
    cargo run --manifest-path $manifest --profile fast -j 2 -- --match-events --match-threads=4
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
