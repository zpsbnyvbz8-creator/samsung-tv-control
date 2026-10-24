@echo off
title Samsung Tizen TV - Vercel Cloud Bridge Tunnel
cd /d "%~dp0"
echo ===================================================================
echo   Samsung TV Controller - Vercel HTTPS Bridge Tunnel
echo ===================================================================
echo.
echo 1) Pruefe, ob der lokale Node.js-Server auf Port 3000 laeuft...
curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% neq 0 (
  echo Der lokale Server laeuft noch nicht. Starte lokalen Server im Hintergrund...
  start /b node server.js
  timeout /t 2 /nobreak >nul
) else (
  echo Lokaler Server ist bereits aktiv auf Port 3000.
)
echo.
echo 2) Erstelle oeffentliche, sichere HTTPS-Bridge fuer Vercel...
echo Bitte die unten angezeigte URL kopieren und im Vercel-Dashboard einfuegen!
echo (Beispiel: https://xxxx.loca.lt)
echo ===================================================================
echo.
npx --yes localtunnel --port 3000
pause
