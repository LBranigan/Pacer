@echo off
echo Stopping ORF services...

:: Kill Python HTTP server on port 8000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
    echo Killing process %%a on port 8000
    taskkill /F /PID %%a 2>nul
)

echo Services stopped.
pause
