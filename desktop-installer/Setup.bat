@echo off
setlocal
title Morning Aging Processor - One Time Setup
echo.
echo ================================================
echo   Morning Aging Processor - One Time Setup
echo ================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup.ps1"
if errorlevel 1 (
  echo.
  echo Setup did not complete. Read the error above.
  pause
  exit /b 1
)
echo.
echo Setup completed successfully.
pause
