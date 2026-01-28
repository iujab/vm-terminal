#!/bin/bash
# Startup script for Claude Code + noVNC Browser Viewer

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPLAY_NUM=99
VNC_PORT=5900
WEBSOCKET_PORT=6080

cleanup() {
    echo "Cleaning up..."
    pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true
    pkill -f "x11vnc" 2>/dev/null || true
    pkill -f "websockify.*${WEBSOCKET_PORT}" 2>/dev/null || true
    rm -f /tmp/.X${DISPLAY_NUM}-lock /tmp/.X11-unix/X${DISPLAY_NUM} 2>/dev/null || true
}

trap cleanup EXIT

# Kill any existing instances and clean up
cleanup
sleep 1

# Unset Wayland to force X11 mode
unset WAYLAND_DISPLAY

echo "Starting Xvfb on display :${DISPLAY_NUM}..."
Xvfb :${DISPLAY_NUM} -screen 0 1280x720x24 &
XVFB_PID=$!
sleep 2

# Verify Xvfb started
if ! kill -0 $XVFB_PID 2>/dev/null; then
    echo "ERROR: Xvfb failed to start"
    exit 1
fi

export DISPLAY=:${DISPLAY_NUM}

echo "Starting x11vnc on port ${VNC_PORT}..."
x11vnc -display :${DISPLAY_NUM} -nopw -listen 0.0.0.0 -rfbport ${VNC_PORT} -forever -shared -bg
sleep 1

echo "Starting websockify on port ${WEBSOCKET_PORT}..."
websockify --web=/usr/share/novnc ${WEBSOCKET_PORT} localhost:${VNC_PORT} &
sleep 1

echo ""
echo "=== Browser Viewer Ready ==="
echo "noVNC URL: http://localhost:${WEBSOCKET_PORT}/vnc.html"
echo "WebSocket: ws://localhost:${WEBSOCKET_PORT}"
echo ""
echo "Playwright will use DISPLAY=:${DISPLAY_NUM}"
echo ""

# Export for Playwright
export DISPLAY=:${DISPLAY_NUM}
export PLAYWRIGHT_HEADLESS=false

echo "Starting OpenVSCode Server..."
cd "$SCRIPT_DIR/openvscode-server-v1.106.3-linux-x64"
exec ./bin/openvscode-server --without-connection-token
