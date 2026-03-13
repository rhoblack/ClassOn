@echo off
echo.
echo  ClassOn - Reset Password
echo  ========================
echo  Resetting password to: admin1234
echo.
set /p confirm=Continue? (y/n):
if /i "%confirm%" neq "y" (
  echo Cancelled.
  pause
  exit /b
)
echo.
node reset-password.js
echo.
pause
