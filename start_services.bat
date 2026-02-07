@echo off
setlocal enabledelayedexpansion
title ReadingQuest Server

:: Change to the directory where this batch file is located
cd /d "%~dp0"

echo Starting ReadingQuest...
echo.

set PORT=8888
set REVERB_PORT=8765

:: ── Start Reverb ASR service via Docker ──
echo Starting Reverb ASR Docker container...
docker compose -f services\reverb\docker-compose.yml up -d

:: Wait for Reverb to become responsive
echo Waiting for Reverb service...
set RETRIES=0
:healthcheck
timeout /t 2 /nobreak >nul
curl -s http://localhost:!REVERB_PORT!/health >nul 2>&1
if errorlevel 1 (
    set /a RETRIES+=1
    if !RETRIES! lss 30 (
        echo   Still waiting... [!RETRIES!/30]
        goto healthcheck
    ) else (
        echo.
        echo WARNING: Reverb service not responding after 60 seconds.
        echo Run: docker compose -f services\reverb\docker-compose.yml logs
        echo The web server will still start, but transcription may not work.
        echo.
    )
) else (
    echo Reverb ASR service is ready on port !REVERB_PORT!
    echo.
)

:: Open browser (before starting foreground server so it doesn't block)
start http://localhost:%PORT%/index.html

echo ──────────────────────────────────────────
echo   Web server:  http://localhost:%PORT%
echo   Reverb ASR:  http://localhost:%REVERB_PORT% (Docker)
echo ──────────────────────────────────────────
echo.
echo Press Ctrl+C to stop the web server, or close this window.
echo Run stop_services.bat to stop everything.
echo.

:: Start HTTP server in foreground (keeps window open)
python -m http.server %PORT%
