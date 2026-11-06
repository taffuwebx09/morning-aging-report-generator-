$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host ""
Write-Host "Morning Aging Processor - One-time setup" -ForegroundColor Cyan
Write-Host "This installs a private portable Node.js runtime in your Windows user profile."
Write-Host ""

if (-not [Environment]::Is64BitOperatingSystem) {
    throw "This installer currently supports 64-bit Windows only."
}

$baseDir = Join-Path $env:LOCALAPPDATA "MorningAging"
$runtimeDir = Join-Path $baseDir "runtime"
$processorDir = Join-Path $baseDir "processor"
$sourceProcessor = Join-Path $PSScriptRoot "..\local-processor"
$tempDir = Join-Path $env:TEMP ("MorningAgingSetup-" + [guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $tempDir "node-win-x64.zip"
$extractDir = Join-Path $tempDir "extract"

New-Item -ItemType Directory -Force -Path $baseDir, $tempDir | Out-Null

try {
    Write-Host "[1/5] Finding the latest Node.js 26 LTS release..." -ForegroundColor Yellow
    $releases = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json"
    $release = $releases | Where-Object { $_.version -match '^v26\.' -and $_.lts } | Select-Object -First 1
    if (-not $release) { throw "Could not find a Node.js 26 LTS release from nodejs.org." }

    $version = $release.version
    $archiveName = "node-$version-win-x64.zip"
    $baseUrl = "https://nodejs.org/dist/$version"
    $archiveUrl = "$baseUrl/$archiveName"

    Write-Host "[2/5] Downloading official Node.js $version portable ZIP..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $archiveUrl -OutFile $zipPath -UseBasicParsing

    Write-Host "Verifying SHA-256 checksum..." -ForegroundColor Yellow
    $checksumText = (Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -UseBasicParsing).Content
    $checksumLine = ($checksumText -split "`n" | Where-Object { $_ -match ("\s" + [regex]::Escape($archiveName) + "$") } | Select-Object -First 1)
    if (-not $checksumLine) { throw "Could not find the official SHA-256 checksum for $archiveName." }
    $expectedHash = (($checksumLine.Trim() -split '\s+')[0]).ToLowerInvariant()
    $actualHash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expectedHash -ne $actualHash) { throw "Node.js archive checksum verification failed. Setup stopped." }

    Write-Host "[3/5] Installing portable Node.js runtime..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    $nodeFolder = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
    if (-not $nodeFolder) { throw "Node.js archive extraction failed." }
    if (Test-Path $runtimeDir) { Remove-Item $runtimeDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    Copy-Item -Path (Join-Path $nodeFolder.FullName "*") -Destination $runtimeDir -Recurse -Force

    $nodeExe = Join-Path $runtimeDir "node.exe"
    $npmCmd = Join-Path $runtimeDir "npm.cmd"
    if (-not (Test-Path $nodeExe) -or -not (Test-Path $npmCmd)) {
        throw "Portable Node.js runtime is missing node.exe or npm.cmd."
    }

    Write-Host "[4/5] Installing local processor files and dependencies..." -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $sourceProcessor "server.js"))) {
        throw "local-processor\server.js was not found beside this installer. Extract the complete project ZIP, then run Setup.bat inside desktop-installer."
    }
    if (Test-Path $processorDir) { Remove-Item $processorDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $processorDir | Out-Null
    Copy-Item (Join-Path $sourceProcessor "*") $processorDir -Recurse -Force

    Push-Location $processorDir
    try {
        & $npmCmd install --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm dependency installation failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }

    Write-Host "[5/5] Creating Desktop launcher..." -ForegroundColor Yellow
    $launcher = Join-Path $baseDir "Start Morning Aging Processor.bat"
    $launcherText = @"
@echo off
setlocal
title Morning Aging Local Processor
set "APPROOT=%LOCALAPPDATA%\MorningAging"
set "PATH=%APPROOT%\runtime;%PATH%"
cd /d "%APPROOT%\processor"
echo.
echo ================================================
echo   Morning Aging Local Processor
echo ================================================
echo Keep this window open while using the website.
echo.
"%APPROOT%\runtime\node.exe" server.js
echo.
echo Processor stopped. You may close this window.
pause
"@
    Set-Content -Path $launcher -Value $launcherText -Encoding ASCII

    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "Start Morning Aging Processor.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $launcher
    $shortcut.WorkingDirectory = $baseDir
    $shortcut.Description = "Start the local Morning Aging Report processor."
    $shortcut.Save()

    Write-Host ""
    Write-Host "SETUP COMPLETE" -ForegroundColor Green
    Write-Host "Desktop shortcut created: Start Morning Aging Processor"
    Write-Host "Daily use: double-click the Desktop shortcut, then open your Vercel website."
    Write-Host "Your local key is stored securely in your Windows user profile and stays the same on this PC."
    Write-Host "The first setup needs internet to download Node.js and processor packages."
    Write-Host "After setup, no Node.js installation or VS Code is required."
} finally {
    if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
}
