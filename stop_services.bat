@echo off
echo Stopping ReadingQuest services...

:: Kill Python HTTP server on port 8080
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do (
    echo Killing web server process %%a on port 8080
    taskkill /F /PID %%a 2>nul
)

:: Stop Reverb ASR Docker service
echo Stopping Reverb ASR service...
cd /d "%~dp0"
cd services\reverb
docker compose down
cd ..\..

echo All services stopped.
pause
