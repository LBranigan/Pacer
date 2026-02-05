@echo off
title ReadingQuest Server

:: Change to the directory where this batch file is located
cd /d "%~dp0"

echo Starting ReadingQuest...
echo.

set PORT=8080

:: Start Reverb ASR service (Docker)
echo Starting Reverb ASR service...
cd services\reverb
docker compose up --build -d
cd ..\..
echo Reverb service starting on port 8765
echo.

:: Start Python HTTP server in background
start /B python -m http.server %PORT% >nul 2>&1

:: Wait a moment for server to start
timeout /t 2 /nobreak >nul

:: Open browser
start http://localhost:%PORT%/index.html

echo Web server running at http://localhost:%PORT%
echo Reverb ASR service at http://localhost:8765
echo.
echo Press Ctrl+C to stop the web server, or close this window.
echo Run stop_services.bat to stop everything.
echo.

:: Keep server running (re-run in foreground so window stays open)
python -m http.server %PORT%
