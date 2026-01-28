#!/bin/bash
set -e

echo "=== Playwright VM Container Starting ==="

# Create VNC password file (empty password for local dev)
mkdir -p ~/.vnc
x11vnc -storepasswd "" ~/.vnc/passwd 2>/dev/null || true

# Set up Xauthority
touch ~/.Xauthority

echo "Display: $DISPLAY"
echo "Screen: ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}"
echo "VNC Port: $VNC_PORT"
echo "noVNC Port: $NOVNC_PORT"
echo "Playwright Port: $PLAYWRIGHT_PORT"

exec "$@"
