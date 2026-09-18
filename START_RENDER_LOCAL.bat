@echo off
cd /d "%~dp0"
echo ========================================
echo GridGate Render backend - local test
echo ========================================
call npm install
if errorlevel 1 pause & exit /b 1
call npm test
if errorlevel 1 pause & exit /b 1
echo.
echo Open: http://localhost:10000
echo Keep this window open while testing.
echo.
call npm run dev:render
pause
