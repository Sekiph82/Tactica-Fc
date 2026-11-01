$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $projectRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm exec -- electron-builder --win nsis --x64 --publish never
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
