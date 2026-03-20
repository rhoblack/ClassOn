@echo off
chcp 65001 >nul
title ClassOn - Stopping

echo.
echo  ==============================
echo    ClassOn Server Stopping
echo  ==============================
echo.

echo [INFO] Stopping Node.js server...
taskkill /f /im node.exe >nul 2>&1

echo [INFO] Done.
echo.
timeout /t 2 /nobreak >nul
