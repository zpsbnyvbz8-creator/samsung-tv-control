@echo off
title Samsung Tizen TV Control Suite
cd /d "%~dp0"
echo ========================================================
echo   Samsung Tizen TV Controller ^& Volume Bypass Suite
echo ========================================================
echo.
echo Starte lokalen Node.js Server auf Port 3000...
echo Oeffne deinen Browser unter: http://localhost:3000
echo.
start http://localhost:3000
node server.js
pause
