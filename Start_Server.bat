@echo off
title EZY Pawnshop Local Sync Server
echo ===================================================
echo   EZY Pawnshop 2006: Local Sync Server (Port 8000)
echo ===================================================
echo.
echo Stopping old server instances (if any)...
taskkill /F /IM server.exe >nul 2>&1
echo Start Server at http://localhost:8000 ...
cd /d "%~dp0"
start "" "server.exe"
timeout /t 1 /nobreak >nul
netstat -ano | findstr :8000
pause
