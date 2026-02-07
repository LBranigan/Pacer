@echo off
echo Stopping ReadingQuest services...

:: Change to the directory where this batch file is located
cd /d "%~dp0"

:: Kill Python HTTP server on port 8888
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8888 ^| findstr LISTENING') do (
    echo Killing web server process %%a on port 8888
    taskkill /F /PID %%a 2>nul
)

:: Stop Reverb ASR Docker container
echo Stopping Reverb ASR Docker container...
docker compose -f services\reverb\docker-compose.yml down

echo All services stopped.
pause
