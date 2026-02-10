#!/bin/bash
# Called by start_services.bat — runs entirely in WSL
cd /mnt/c/Users/brani/Desktop/googstt

echo ""
echo "======================================"
echo "  Pacer Backend Startup"
echo "======================================"
echo ""

# 1. Docker
echo "[1/4] Checking Docker backend..."
if docker ps --format '{{.Image}}' 2>/dev/null | grep -q reverb; then
  echo "      Already running."
else
  echo "      Starting Docker..."
  cd services/reverb && docker compose up -d && cd /mnt/c/Users/brani/Desktop/googstt
  for i in $(seq 1 30); do
    curl -s http://localhost:8765/health >/dev/null 2>&1 && break
    sleep 2
  done
  echo "      Ready."
fi
echo ""

# 2. Kill old tunnels
echo "[2/4] Killing old tunnels..."
pkill -f /home/brani/bin/cloudflared 2>/dev/null; true
sleep 1
echo "      Done."
echo ""

# 3. Start tunnel
echo "[3/4] Starting tunnel..."
/home/brani/bin/cloudflared tunnel --url http://localhost:8765 2>/tmp/pacer_tunnel.log &
TUNNEL_PID=$!

TUNNEL_URL=""
for i in $(seq 1 30); do
  TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/pacer_tunnel.log 2>/dev/null | head -1)
  if [ -n "$TUNNEL_URL" ]; then break; fi
  sleep 1
  echo "      Waiting... [$i/30]"
done

if [ -z "$TUNNEL_URL" ]; then
  echo "ERROR: No tunnel URL after 30s"
  cat /tmp/pacer_tunnel.log
  exit 1
fi
echo "      Tunnel: $TUNNEL_URL"
echo ""

# 4. Update config + push
echo "[4/4] Updating config and pushing..."
cat > backend-config.json << EOF
{
  "backendUrl": "$TUNNEL_URL",
  "backendToken": "775b25bab047811191840f643b2d987202898971859541d4"
}
EOF
git add backend-config.json
git commit -m "chore: update tunnel URL" --no-verify 2>/dev/null
git push 2>/dev/null && echo "      Pushed to GitHub!" || echo "      (already up to date)"
echo ""

echo "======================================"
echo "  READY!"
echo ""
echo "  Tunnel: $TUNNEL_URL"
echo "  Just go to: https://lbranigan.github.io/Pacer/"
echo "  Settings will auto-populate."
echo "======================================"
echo ""
echo "Tunnel running (PID $TUNNEL_PID). Close this window to stop."

# Keep alive
wait $TUNNEL_PID
