#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$HOME/.config/gcal-xcowsay"
SERVICE_DIR="$HOME/.config/systemd/user"

echo "=== gcal-xcowsay setup ==="

# 1. Install Node.js dependencies
echo "[1/4] Installing Node.js dependencies..."
cd "$SCRIPT_DIR"
npm install

# 2. Ensure config dir exists
echo "[2/4] Creating config directory at $CONFIG_DIR..."
mkdir -p "$CONFIG_DIR"

# 3. Check for credentials.json
if [[ ! -f "$CONFIG_DIR/credentials.json" ]]; then
    echo ""
    echo "  *** ACTION REQUIRED ***"
    echo "  You need a Google OAuth2 credentials.json file."
    echo ""
    echo "  Steps:"
    echo "  1. Go to https://console.cloud.google.com/"
    echo "  2. Create a project (or select one)"
    echo "  3. Enable the Google Calendar API"
    echo "  4. Go to APIs & Services > Credentials"
    echo "  5. Create OAuth 2.0 Client ID (Desktop app)"
    echo "  6. Download the JSON and save it to:"
    echo "     $CONFIG_DIR/credentials.json"
    echo ""
    echo "  Then re-run this script."
    echo ""
    exit 1
else
    echo "  Found credentials.json. Running OAuth flow to get token..."
    node "$SCRIPT_DIR/index.js" &
    PID=$!
    # Give the browser flow time to complete
    sleep 10
    kill $PID 2>/dev/null || true
    echo "  (If a browser opened, complete the auth flow, then re-run setup)"
fi

# 4. Install and enable systemd user service
echo "[3/4] Installing systemd user service..."
mkdir -p "$SERVICE_DIR"

# Substitute HOME path into service file
SERVICE_FILE="$SERVICE_DIR/gcal-xcowsay.service"
sed "s|%h|$HOME|g" "$SCRIPT_DIR/gcal-xcowsay.service" > "$SERVICE_FILE"

echo "[4/4] Enabling and starting service..."
systemctl --user daemon-reload
systemctl --user enable gcal-xcowsay.service
systemctl --user start gcal-xcowsay.service

echo ""
echo "=== Done! ==="
echo "Service status:"
systemctl --user status gcal-xcowsay.service --no-pager || true
echo ""
echo "View logs with:"
echo "  journalctl --user -u gcal-xcowsay.service -f"
echo "  cat $CONFIG_DIR/gcal_notify.log"
