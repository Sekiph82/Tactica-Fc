$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $projectRoot 'vendor\open-football\Cargo.toml'

$env:OPEN_FOOTBALL_SKIP_MATCH_VIEWER = '1'
Push-Location $projectRoot
try {
    cargo build --manifest-path $manifest --profile fast -j 2
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
