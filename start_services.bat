@echo off
setlocal enabledelayedexpansion
title Pacer Backend
cd /d "%~dp0"

echo ======================================
echo   Pacer Backend Startup
echo ======================================
echo.

set REVERB_PORT=8765
set PORT=8888

:: ── 1. Start Docker backend if not running ──
echo [1/5] Checking Docker backend...
docker ps --filter "ancestor=reverb-reverb" --format "{{.ID}}" > "%TEMP%\pacer_container.txt" 2>nul
set /p CONTAINER=<"%TEMP%\pacer_container.txt"
del "%TEMP%\pacer_container.txt" 2>nul

if "!CONTAINER!"=="" (
    echo       Starting Docker container...
    docker compose -f services\reverb\docker-compose.yml up -d
    echo       Waiting for backend...
    set RETRIES=0
    :healthcheck
    timeout /t 2 /nobreak >nul
    curl -s http://localhost:!REVERB_PORT!/health >nul 2>&1
    if errorlevel 1 (
        set /a RETRIES+=1
        if !RETRIES! lss 30 (
            echo       Still waiting... [!RETRIES!/30]
            goto healthcheck
        ) else (
            echo.
            echo WARNING: Backend not responding after 60 seconds.
            echo.
        )
    ) else (
        echo       Backend is ready!
    )
) else (
    echo       Already running ^(container: !CONTAINER!^)
)
echo.

:: ── 2. Kill old cloudflared tunnels ──
echo [2/5] Killing old tunnels...
taskkill /F /IM cloudflared.exe >nul 2>&1
wsl pkill -f cloudflared 2>nul
timeout /t 2 /nobreak >nul
echo       Done.
echo.

:: ── 3. Start new tunnel and capture URL ──
echo [3/5] Starting Cloudflare tunnel...
set TUNNEL_LOG=%TEMP%\pacer_tunnel.log
del "%TUNNEL_LOG%" 2>nul

:: Try Windows cloudflared first, fall back to WSL
where cloudflared >nul 2>&1
if !errorlevel!==0 (
    start /B "" cloudflared tunnel --url http://localhost:%REVERB_PORT% > "%TUNNEL_LOG%" 2>&1
) else (
    start /B "" wsl cloudflared tunnel --url http://localhost:%REVERB_PORT% > "%TUNNEL_LOG%" 2>&1
)

:: Wait for URL to appear in logs
set TUNNEL_URL=
set ATTEMPTS=0
:tunnel_wait
timeout /t 1 /nobreak >nul
set /a ATTEMPTS+=1
for /f "tokens=*" %%A in ('findstr /R "https://.*trycloudflare.com" "%TUNNEL_LOG%" 2^>nul') do (
    for %%U in (%%A) do (
        echo %%U | findstr /R "https://.*trycloudflare.com" >nul 2>&1
        if not errorlevel 1 (
            set TUNNEL_URL=%%U
        )
    )
)
if "!TUNNEL_URL!"=="" (
    if !ATTEMPTS! lss 30 goto tunnel_wait
    echo ERROR: Could not get tunnel URL after 30 seconds.
    type "%TUNNEL_LOG%"
    pause
    exit /b 1
)

:: Clean any trailing characters from URL
for /f "tokens=1 delims= " %%U in ("!TUNNEL_URL!") do set TUNNEL_URL=%%U

echo       Tunnel: !TUNNEL_URL!
echo.

:: ── 4. Update backend-config.json ──
echo [4/5] Updating backend-config.json...
(
echo {
echo   "backendUrl": "!TUNNEL_URL!",
echo   "backendToken": "775b25bab047811191840f643b2d987202898971859541d4"
echo }
) > backend-config.json
echo       Updated!
echo.

:: ── 5. Push to GitHub ──
echo [5/5] Pushing to GitHub...
git add backend-config.json >nul 2>&1
git commit -m "chore: update tunnel URL" --no-verify >nul 2>&1
git push >nul 2>&1 && (
    echo       Pushed!
) || (
    echo       Push failed or nothing to push.
)
echo.

:: ── Done ──
echo ======================================
echo   Pacer is ready!
echo.
echo   Backend:  http://localhost:%REVERB_PORT%
echo   Tunnel:   !TUNNEL_URL!
echo.
echo   Login:    phonetictruth.com ^> Log In
echo   Direct:   https://lbranigan.github.io/Pacer/?backendUrl=!TUNNEL_URL!^&backendToken=775b25bab047811191840f643b2d987202898971859541d4
echo ======================================
echo.
echo Opening browser...
start http://localhost:%PORT%/index.html
echo.
echo Press Ctrl+C or close this window to stop.
echo Run stop_services.bat to stop everything.
echo.

:: Keep window open with local HTTP server
python -m http.server %PORT%
