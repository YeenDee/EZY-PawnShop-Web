@echo off
title EZY Pawnshop - Direct Sync MySQL to Cloudflare
echo ===================================================
echo   EZY Pawnshop: Sync MySQL to Cloudflare D1
echo ===================================================
echo.
echo Source MySQL : S:\AppServ\MySQL\data\Pawnshop (option.ini)
echo Target Cloud : Cloudflare D1 (tickets & customers)
echo.
cd /d "%~dp0"
python db_sync.py sync
echo.
echo ===================================================
echo   Sync Process Complete!
echo ===================================================
pause
