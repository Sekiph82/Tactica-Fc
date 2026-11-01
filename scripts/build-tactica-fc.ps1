$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $projectRoot
try {
    npm exec vite -- build --base=/ --outDir dist/tactica-manager --emptyOutDir
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
