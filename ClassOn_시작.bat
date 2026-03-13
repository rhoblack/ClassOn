@echo off
title ClassOn Server

echo.
echo  ==============================
echo    ClassOn Server Starting...
echo  ==============================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js가 설치되어 있지 않습니다.
    echo         https://nodejs.org 에서 Node.js v22 이상을 설치해주세요.
    pause
    exit /b 1
)

:: Node.js 버전 확인 (v22 이상 필요)
for /f "tokens=1 delims=v." %%V in ('node -v') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 (
    echo [ERROR] Node.js v22 이상이 필요합니다.
    node -v
    echo         https://nodejs.org 에서 최신 버전을 설치해주세요.
    pause
    exit /b 1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 "') do (
    taskkill /PID %%a /F >nul 2>&1
)

cd /d "%~dp0"

if not exist "node_modules" (
    echo [INFO] First run - installing packages...
    npm install
    echo.
)

echo [INFO] Starting ClassOn server...
start "ClassOn Server" /min node core/server.js

ping -n 3 127.0.0.1 >nul

echo [INFO] Opening browser...
start http://localhost:3000

echo.
echo  ==============================
echo    ClassOn is running!
echo    http://localhost:3000
echo  ==============================
echo.
pause
