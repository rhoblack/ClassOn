@echo off
title ClassOn Stop

echo.
echo  ==============================
echo    ClassOn Server Stopping...
echo  ==============================
echo.

taskkill /f /im node.exe /fi "WINDOWTITLE eq ClassOn Server" >nul 2>&1
taskkill /f /im node.exe >nul 2>&1

echo [INFO] ClassOn server stopped.
echo.
timeout /t 2 /nobreak > nul
