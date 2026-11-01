$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $projectRoot
try {
    $env:CARGO_TARGET_DIR = Join-Path $projectRoot 'vendor\open-football\target\desktop'
    $env:OPEN_FOOTBALL_SKIP_MATCH_VIEWER = '1'
    cargo build --manifest-path (Join-Path $projectRoot 'vendor\open-football\Cargo.toml') --profile fast -j 2
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    npm exec -- electron-builder --win nsis --x64 --publish never
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
