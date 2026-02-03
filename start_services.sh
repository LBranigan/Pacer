#!/bin/bash
# ReadingQuest Launcher - starts HTTP server and opens browser

PORT=8080

echo "Starting ReadingQuest on http://localhost:$PORT"

# Open browser (works on Linux/Mac/WSL)
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:$PORT/index.html" &
elif command -v open &> /dev/null; then
    open "http://localhost:$PORT/index.html" &
elif command -v wslview &> /dev/null; then
    wslview "http://localhost:$PORT/index.html" &
else
    echo "Open http://localhost:$PORT/index.html in your browser"
fi

# Start server (blocks - Ctrl+C to stop)
python3 -m http.server $PORT
