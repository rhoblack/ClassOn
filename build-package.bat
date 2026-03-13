@echo off
chcp 65001 >nul
setlocal

echo.
echo  ==============================
echo    ClassOn 배포 패키지 생성
echo  ==============================
echo.

cd /d "%~dp0"

:: 임시 PowerShell 스크립트 생성
set "PS1=%TEMP%\classon_build_%RANDOM%.ps1"

(
echo $src = '%~dp0'
echo $src = $src.TrimEnd('\')
echo $tmpDir = "$env:TEMP\ClassOn_build"
echo $zipName = 'ClassOn_' + ^(Get-Date -Format 'yyyyMMdd'^) + '.zip'
echo $outZip = "$src\$zipName"
echo.
echo Write-Host '[1/4] 임시 폴더 생성...'
echo if ^(Test-Path $tmpDir^) { Remove-Item $tmpDir -Recurse -Force }
echo New-Item -ItemType Directory -Path "$tmpDir\ClassOn" ^| Out-Null
echo.
echo Write-Host '[2/4] 파일 복사 중...'
echo $excludeDirs  = @^('.git', 'backup', '.claude', 'docs'^)
echo $excludeFiles = @^('*.db', '*.db-wal', '*.db-shm', '*.csv', '*.md', 'build-package.bat', '*.jsonl', '*.log'^)
echo.
echo Get-ChildItem -Path $src -Force ^| Where-Object {
echo   $name = $_.Name
echo   if ^($excludeDirs -contains $name^) { return $false }
echo   foreach ^($pat in $excludeFiles^) { if ^($name -like $pat^) { return $false } }
echo   return $true
echo } ^| ForEach-Object {
echo   $dest = "$tmpDir\ClassOn\$^($_.Name^)"
echo   if ^($_.PSIsContainer^) {
echo     Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force
echo   } else {
echo     Copy-Item -Path $_.FullName -Destination $dest -Force
echo   }
echo }
echo.
echo Get-ChildItem -Path "$tmpDir\ClassOn\data" -Filter '*.db'   -Recurse -ErrorAction SilentlyContinue ^| Remove-Item -Force
echo Get-ChildItem -Path "$tmpDir\ClassOn\data" -Filter '*.db-*' -Recurse -ErrorAction SilentlyContinue ^| Remove-Item -Force
echo if ^(-not ^(Test-Path "$tmpDir\ClassOn\data"^)^) { New-Item -ItemType Directory -Path "$tmpDir\ClassOn\data" ^| Out-Null }
echo.
echo Write-Host '[3/4] ZIP 생성 중...'
echo Compress-Archive -Path "$tmpDir\ClassOn" -DestinationPath $outZip -Force
echo.
echo Write-Host '[4/4] 임시 폴더 정리...'
echo Remove-Item $tmpDir -Recurse -Force
echo.
echo if ^(Test-Path $outZip^) {
echo   $mb = [math]::Round^(^(Get-Item $outZip^).Length / 1MB, 1^)
echo   Write-Host "완료: $zipName ^($mb MB^)"
echo   Write-Host "위치: $src"
echo } else {
echo   Write-Host '[ERROR] ZIP 생성 실패'
echo   exit 1
echo }
) > "%PS1%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
del "%PS1%" 2>nul

echo.
echo  배포 방법:
echo    1. 생성된 ZIP 파일을 대상 PC로 복사
echo    2. ZIP 압축 해제
echo    3. ClassOn_시작.bat 실행 (Node.js v22 이상 필요)
echo.
pause
endlocal
