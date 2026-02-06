@echo off
echo Stopping ReadingQuest services...

:: Change to the directory where this batch file is located
cd /d "%~dp0"

:: Kill Python HTTP server on port 8080
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do (
    echo Killing web server process %%a on port 8080
    taskkill /F /PID %%a 2>nul
)

:: Stop Reverb ASR service (running in WSL)
echo Stopping Reverb ASR service...
wsl -- bash -c "pkill -f 'uvicorn server:app.*--port 8765' 2>/dev/null"

echo All services stopped.
pause
