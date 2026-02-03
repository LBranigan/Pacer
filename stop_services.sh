#!/bin/bash
echo "Stopping ORF services..."

# Kill Python HTTP server on port 8000
PID=$(lsof -ti:8000)
if [ -n "$PID" ]; then
    echo "Killing process $PID on port 8000"
    kill -9 $PID
fi

echo "Services stopped."
