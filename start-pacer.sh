#!/bin/bash
# start-pacer.sh — One command to start the entire Pacer backend
# Usage: ./start-pacer.sh
#
# What it does:
#   1. Starts the Docker backend (if not already running)
#   2. Waits for backend health check
#   3. Kills any old cloudflared tunnels
#   4. Starts a new cloudflared quick tunnel
#   5. Extracts the new tunnel URL
#   6. Updates backend-config.json with the new URL
#   7. Pushes to GitHub so the live site picks it up automatically

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Pacer Backend Startup ==="
echo ""

# 1. Start Docker backend if not running
CONTAINER=$(docker ps --filter "ancestor=reverb-reverb" --format "{{.ID}}" 2>/dev/null || true)
if [ -z "$CONTAINER" ]; then
  echo "[1/5] Starting Docker backend..."
  cd services/reverb
  docker compose up -d
  cd "$SCRIPT_DIR"
  echo "      Waiting for backend to be ready..."
  for i in $(seq 1 30); do
    if curl -s http://localhost:8765/health > /dev/null 2>&1; then
      echo "      Backend is ready!"
      break
    fi
    sleep 2
  done
else
  echo "[1/5] Docker backend already running (container: $CONTAINER)"
fi

# Verify health
if ! curl -s http://localhost:8765/health > /dev/null 2>&1; then
  echo "ERROR: Backend not responding on port 8765"
  exit 1
fi
echo ""

# 2. Kill old cloudflared tunnels
echo "[2/5] Killing old tunnels..."
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 2
echo ""

# 3. Start new cloudflared tunnel and capture URL
echo "[3/5] Starting Cloudflare tunnel..."
TUNNEL_LOG=$(mktemp)
cloudflared tunnel --url http://localhost:8765 > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# Wait for tunnel URL to appear in logs
TUNNEL_URL=""
for i in $(seq 1 30); do
  TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo "ERROR: Could not get tunnel URL after 30 seconds"
  cat "$TUNNEL_LOG"
  exit 1
fi

echo "      Tunnel URL: $TUNNEL_URL"
echo ""

# 4. Update backend-config.json
echo "[4/5] Updating backend-config.json..."
TOKEN=$(python3 -c "import json; print(json.load(open('backend-config.json'))['backendToken'])" 2>/dev/null || echo "775b25bab047811191840f643b2d987202898971859541d4")
cat > backend-config.json << EOF
{
  "backendUrl": "$TUNNEL_URL",
  "backendToken": "$TOKEN"
}
EOF
echo "      Updated!"
echo ""

# 5. Push to GitHub
echo "[5/5] Pushing to GitHub..."
git add backend-config.json
git commit -m "chore: update tunnel URL to $TUNNEL_URL" --no-verify 2>/dev/null || echo "      (no changes to commit)"
git push 2>/dev/null && echo "      Pushed!" || echo "      Push failed (check git credentials)"
echo ""

# Done
echo "=== Pacer is ready! ==="
echo ""
echo "  Backend:  http://localhost:8765"
echo "  Tunnel:   $TUNNEL_URL"
echo "  Token:    $TOKEN"
echo ""
echo "  Auto-login URL:"
echo "  https://lbranigan.github.io/Pacer/?backendUrl=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TUNNEL_URL'))")&backendToken=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TOKEN'))")"
echo ""
echo "  Tunnel PID: $TUNNEL_PID (kill with: kill $TUNNEL_PID)"
echo ""

# Cleanup temp file
rm -f "$TUNNEL_LOG"
