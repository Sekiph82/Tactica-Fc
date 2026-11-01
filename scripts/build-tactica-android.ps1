param(
    [switch]$BuildApk
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$ndk = Join-Path $sdk 'ndk\28.1.13356709'
$toolchain = Join-Path $ndk 'toolchains\llvm\prebuilt\windows-x86_64\bin'
$linker = Join-Path $toolchain 'armv7a-linux-androideabi21-clang.cmd'
$cargoTarget = Join-Path $repo 'target\android-armv7'
$jniOutput = Join-Path $repo 'android\app\src\main\jniLibs\armeabi-v7a'
$javaHome = Join-Path $env:LOCALAPPDATA 'Programs\Eclipse Adoptium\jdk-21.0.13+9'

foreach ($required in @($sdk, $ndk, $linker, (Join-Path $javaHome 'bin\java.exe'))) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Android build prerequisite is missing: $required"
    }
}

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:JAVA_HOME = $javaHome
$env:PATH = "$(Join-Path $javaHome 'bin');$env:PATH"
$env:CARGO_TARGET_DIR = $cargoTarget
$env:CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER = $linker
$env:CC_armv7_linux_androideabi = $linker
$env:CXX_armv7_linux_androideabi = (Join-Path $toolchain 'armv7a-linux-androideabi21-clang++.cmd')
$env:AR_armv7_linux_androideabi = (Join-Path $toolchain 'llvm-ar.exe')

Push-Location $repo
try {
    & cargo build --manifest-path 'android/rust-engine/Cargo.toml' --target armv7-linux-androideabi --release -j 2
    if ($LASTEXITCODE -ne 0) { throw "Android Rust engine build failed with exit code $LASTEXITCODE" }

    $nativeLibrary = Join-Path $cargoTarget 'armv7-linux-androideabi\release\libtactica_android_engine.so'
    if (-not (Test-Path -LiteralPath $nativeLibrary)) { throw "Rust engine library was not produced: $nativeLibrary" }
    New-Item -ItemType Directory -Path $jniOutput -Force | Out-Null
    Copy-Item -LiteralPath $nativeLibrary -Destination (Join-Path $jniOutput 'libtactica_android_engine.so') -Force

    if ($BuildApk) {
        & (Join-Path $repo 'android\gradlew.bat') --no-daemon --console=plain -p (Join-Path $repo 'android') assembleDebug
        if ($LASTEXITCODE -ne 0) { throw "Android debug APK build failed with exit code $LASTEXITCODE" }
    }
}
finally {
    Pop-Location
}
