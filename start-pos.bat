@echo off
rem Starts Restaurant POS and restarts it automatically if it crashes.
rem Closing this window stops the POS. While update-pos.bat runs, it waits instead of restarting.
title Restaurant POS Server
cd /d "%~dp0"

:loop
rem An update takes minutes, so a flag older than 30 minutes was left by a closed or interrupted update.
if exist updating.flag powershell -NoProfile -Command "if (((Get-Date) - (Get-Item 'updating.flag').LastWriteTime).TotalMinutes -gt 30) { Remove-Item 'updating.flag' }"
if exist updating.flag (
  echo Update in progress, waiting... If no update is running, delete updating.flag in this folder.
  timeout /t 5 /nobreak >nul
  goto loop
)
rem Frees port 3000 if a previous run left a process behind.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo [%date% %time%] Starting Restaurant POS...
call npm start
if exist updating.flag goto loop
echo [%date% %time%] POS stopped (exit code %errorlevel%), restarting in 5 seconds >> pos-crash.log
echo POS stopped, restarting in 5 seconds... (close this window to stop it)
timeout /t 5 /nobreak >nul
goto loop
