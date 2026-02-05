#!/bin/bash
# ReadingQuest Launcher - starts Reverb ASR + HTTP server and opens browser

cd "$(dirname "$0")"

PORT=8080

echo "Starting ReadingQuest..."
echo

# Start Reverb ASR service (Docker)
echo "Starting Reverb ASR service..."
(cd services/reverb && docker compose up --build -d)
echo "Reverb service starting on port 8765"
echo

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

echo "Web server running at http://localhost:$PORT"
echo "Reverb ASR service at http://localhost:8765"
echo
echo "Press Ctrl+C to stop the web server."
echo "Run ./stop_services.sh to stop everything."
echo

# Start server (blocks - Ctrl+C to stop)
python3 -m http.server $PORT
