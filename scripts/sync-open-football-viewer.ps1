$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $projectRoot 'vendor\open-football\src\web\assets\static\viewer'
$targetDir = Join-Path $projectRoot 'public\open-football-viewer'

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

function Get-FileSha256([string]$path) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($path)
    try {
        return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
    } finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

foreach ($name in @('match_viewer.js', 'match_viewer_bg.wasm')) {
    $compressedName = "$name.gz"
    $source = Join-Path $sourceDir $compressedName
    $targetCompressed = Join-Path $targetDir $compressedName
    $targetPlain = Join-Path $targetDir $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Built Open Football viewer asset is missing: $source"
    }

    $sourceHash = Get-FileSha256 $source
    $targetHash = if (Test-Path -LiteralPath $targetCompressed -PathType Leaf) {
        Get-FileSha256 $targetCompressed
    } else { '' }
    if ($sourceHash -ne $targetHash) {
        Copy-Item -LiteralPath $source -Destination $targetCompressed -Force
    }

    $temporary = Join-Path $targetDir ($name + '.syncing')
    $inputStream = [System.IO.File]::OpenRead($source)
    try {
        $gzip = [System.IO.Compression.GZipStream]::new($inputStream, [System.IO.Compression.CompressionMode]::Decompress)
        try {
            $output = [System.IO.File]::Create($temporary)
            try { $gzip.CopyTo($output) } finally { $output.Dispose() }
        } finally { $gzip.Dispose() }
    } finally { $inputStream.Dispose() }

    $plainHash = Get-FileSha256 $temporary
    $existingHash = if (Test-Path -LiteralPath $targetPlain -PathType Leaf) {
        Get-FileSha256 $targetPlain
    } else { '' }
    if ($plainHash -eq $existingHash) {
        Remove-Item -LiteralPath $temporary -Force
    } else {
        Move-Item -LiteralPath $temporary -Destination $targetPlain -Force
    }
}
