#!/bin/bash
echo "Stopping ReadingQuest services..."

cd "$(dirname "$0")"

# Kill Python HTTP server on port 8080
PID=$(lsof -ti:8080)
if [ -n "$PID" ]; then
    echo "Killing web server process $PID on port 8080"
    kill -9 $PID
fi

# Stop Reverb ASR Docker service
echo "Stopping Reverb ASR service..."
(cd services/reverb && docker compose down)

echo "All services stopped."
