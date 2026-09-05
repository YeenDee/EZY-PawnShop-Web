@echo off
title EZY Pawnshop Local Sync Server
echo ===================================================
echo   EZY Pawnshop 2006: Local Sync Server (Port 8000)
echo ===================================================
echo.
echo Starting server.py at http://localhost:8000 ...
cd /d "%~dp0"
python server.py
pause
