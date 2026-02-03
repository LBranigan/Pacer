@echo off
title ReadingQuest Server

echo Starting ReadingQuest...
echo.

:: Find an available port (default 8080)
set PORT=8080

:: Start Python HTTP server in background
start /B python -m http.server %PORT% >nul 2>&1

:: Wait a moment for server to start
timeout /t 1 /nobreak >nul

:: Open browser
start http://localhost:%PORT%/index.html

echo Server running at http://localhost:%PORT%
echo.
echo Press Ctrl+C to stop the server, or close this window.
echo.

:: Keep server running (re-run in foreground so window stays open)
python -m http.server %PORT%
