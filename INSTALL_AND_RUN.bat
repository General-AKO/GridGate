@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo  GridGate v0.1 - Install and run locally
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 20 LTS or 22 LTS 64-bit, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\wrangler" (
  echo [1/3] Installing project dependencies...
  call npm install
  if errorlevel 1 goto :fail
) else (
  echo [1/3] Dependencies already installed.
)

echo.
echo [2/3] Running Game Engine tests...
call npm test
if errorlevel 1 goto :fail

echo.
echo [3/3] Starting local Cloudflare development server...
echo Keep this window open while testing.
echo The game will normally be available at http://localhost:8787
echo.
call npm run dev
exit /b %errorlevel%

:fail
echo.
echo [ERROR] Setup stopped because a command failed.
echo Read README_AR.md, then copy the full error if you need help.
pause
exit /b 1
