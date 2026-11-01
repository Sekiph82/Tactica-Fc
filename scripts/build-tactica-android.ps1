param(
    [switch]$BuildApk
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$javaHome = Join-Path $env:LOCALAPPDATA 'Programs\Eclipse Adoptium\jdk-21.0.13+9'
$gradle = Join-Path $repo 'android\gradlew.bat'
$legacyJni = Join-Path $repo 'android\app\src\main\jniLibs\armeabi-v7a\libtactica_android_engine.so'
$legacyApk = Join-Path $repo 'android\app\build\outputs\apk\debug\app-debug.apk'
$backupRoot = Join-Path $repo 'target\codex-android-engine-transition-backup'

function Get-FileSha256([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

foreach ($required in @($sdk, (Join-Path $javaHome 'bin\java.exe'), $gradle)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Android build prerequisite is missing: $required"
    }
}

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:JAVA_HOME = $javaHome
$env:PATH = "$(Join-Path $javaHome 'bin');$env:PATH"

Push-Location $repo
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "TACTICA web build failed with exit code $LASTEXITCODE" }

    # Android's asset merger treats `.js.gz` / `.wasm.gz` as colliding with
    # their uncompressed viewer siblings. The viewer fetches the plain files.
    $viewerAssets = Join-Path $repo 'dist\tactica-manager\open-football-viewer'
    foreach ($compressedAsset in @('match_viewer.js.gz', 'match_viewer_bg.wasm.gz')) {
        $assetPath = Join-Path $viewerAssets $compressedAsset
        if (Test-Path -LiteralPath $assetPath) { Remove-Item -LiteralPath $assetPath -Force }
    }

    $legacyAssets = Join-Path $repo 'android\app\src\main\assets'
    $assetsBackup = Join-Path $backupRoot 'legacy-capacitor-assets'
    if ((Test-Path -LiteralPath $legacyAssets) -and -not (Test-Path -LiteralPath $assetsBackup)) {
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        Copy-Item -LiteralPath $legacyAssets -Destination $assetsBackup -Recurse
    }

    npm exec -- cap sync android
    if ($LASTEXITCODE -ne 0) { throw "Capacitor Android sync failed with exit code $LASTEXITCODE" }

    # Retain the previously generated native engine binary outside the package,
    # then ensure the CM TypeScript app cannot accidentally bundle it.
    if (Test-Path -LiteralPath $legacyJni) {
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        $jniBackup = Join-Path $backupRoot 'libtactica_android_engine.so'
        if (Test-Path -LiteralPath $jniBackup) {
            $sourceHash = Get-FileSha256 $legacyJni
            $backupHash = Get-FileSha256 $jniBackup
            if ($sourceHash -ne $backupHash) { throw "Refusing to overwrite the existing JNI backup: $jniBackup" }
        } else {
            Copy-Item -LiteralPath $legacyJni -Destination $jniBackup
        }
        Remove-Item -LiteralPath $legacyJni -Force
    }

    if ($BuildApk) {
        if (Test-Path -LiteralPath $legacyApk) {
            New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
            $apkBackup = Join-Path $backupRoot 'legacy-app-debug.apk'
            if (Test-Path -LiteralPath $apkBackup) {
                $sourceHash = Get-FileSha256 $legacyApk
                $backupHash = Get-FileSha256 $apkBackup
                if ($sourceHash -ne $backupHash) { throw "Refusing to overwrite the existing APK backup: $apkBackup" }
            } else {
                Copy-Item -LiteralPath $legacyApk -Destination $apkBackup
            }
        }
        & $gradle --no-daemon --console=plain -p (Join-Path $repo 'android') assembleDebug
        if ($LASTEXITCODE -ne 0) { throw "Android APK build failed with exit code $LASTEXITCODE" }
    }
}
finally {
    Pop-Location
}
