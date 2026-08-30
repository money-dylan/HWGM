@echo off
title The Hollow Ledger - Table Server
cd /d "%~dp0"
echo The Hollow Ledger is opening (the table server starts the voice studio and the Game Master itself)...
where msedge >nul 2>nul
if %errorlevel%==0 (
  start "" msedge --app=http://localhost:7439
) else (
  start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:7439
)
node server.js
pause
