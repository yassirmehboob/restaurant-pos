@echo off
rem Updates Restaurant POS: backup, pull latest code, rebuild, then start-pos.bat restarts it.
title Restaurant POS Update
cd /d "%~dp0"

echo Backing up database...
call npm run backup || goto failed

echo Getting latest code...
git pull || goto failed

rem Pauses start-pos.bat and stops the running server so files are not locked.
echo updating> updating.flag
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
timeout /t 5 /nobreak >nul

echo Installing packages...
call npm ci || goto failed
echo Building...
call npm run build || goto failed

del updating.flag
echo.
echo Update complete. The POS restarts in a few seconds.
pause
exit /b 0

:failed
del updating.flag 2>nul
echo.
echo UPDATE FAILED - see the messages above. The POS keeps running the previous version if it was not stopped yet.
pause
exit /b 1
