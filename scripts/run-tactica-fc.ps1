$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $projectRoot 'vendor\open-football\Cargo.toml'

$env:TACTICA_PORT = '5184'
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
