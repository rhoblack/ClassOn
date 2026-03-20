@echo off
chcp 65001 >nul
title ClassOn

echo.
echo  ==============================
echo    ClassOn Server
echo  ==============================
echo.

REM Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed.
    echo         Install Node.js v22+ from https://nodejs.org
    pause
    exit /b 1
)

REM Check Node.js version
for /f "tokens=1 delims=v." %%V in ('node -v') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 (
    echo [ERROR] Node.js v22 or later is required.
    node -v
    pause
    exit /b 1
)

cd /d "%~dp0"

REM Install dependencies
if not exist "node_modules" (
    echo [INFO] Installing packages...
    npm install
    echo.
)

REM Kill process using port 3000
echo [INFO] Checking port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 "') do (
    taskkill /PID %%a /F >nul 2>&1
)

REM Start server in background
echo [INFO] Starting server...
start "ClassOn Server" /min node core/server.js

REM Wait for startup
timeout /t 2 /nobreak >nul

REM Open browser
echo [INFO] Opening browser...
start http://localhost:3000

echo.
echo  ==============================
echo    ClassOn is running
echo    http://localhost:3000
echo  ==============================
echo.
echo You can close this window. Server will keep running.
pause
