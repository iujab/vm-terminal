# Claude Code Browser Viewer

A lightweight setup for using Claude Code CLI with Playwright browser automation, featuring a real-time browser viewer integrated into VSCode.

## Quick Start

```bash
# Start everything
./start-simple.sh

# Open VSCode in browser
# http://localhost:3000

# Open browser viewer (separate tab)
# http://localhost:6080/vnc.html
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                OpenVSCode Server (localhost:3000)               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Terminal                                                 │  │
│  │  └── claude (Claude Code CLI)                             │  │
│  │       └── @playwright/mcp (official MCP server)           │  │
│  │            └── Chromium Browser (headed, on display :99)  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Browser Viewer Extension (sidebar)                       │  │
│  │  └── Opens noVNC in new browser tab                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Virtual Display Stack                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Xvfb      │───▶│   x11vnc    │───▶│   websockify/noVNC  │  │
│  │  :99        │    │   :5900     │    │   :6080             │  │
│  │  (display)  │    │   (VNC)     │    │   (web viewer)      │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## How It Works

### The Display Pipeline

1. **Xvfb (Virtual Framebuffer)** - Creates a fake monitor (display :99) in memory. The Playwright browser opens here instead of your physical screen.

2. **x11vnc (VNC Server)** - Captures the virtual display and shares it over the VNC protocol on port 5900.

3. **websockify (WebSocket Proxy)** - Converts VNC protocol to WebSocket so it can work in a browser. Serves noVNC on port 6080.

4. **noVNC (Web Viewer)** - JavaScript VNC client that runs in your browser, letting you see and interact with the virtual display.

### The Claude Code Flow

1. You run `claude` in the VSCode terminal
2. Claude Code has access to `@playwright/mcp` (configured in `~/.claude.json`)
3. When Claude uses Playwright, it launches a browser on display :99
4. The browser appears in the noVNC viewer
5. You can watch Claude navigate, click, and interact in real-time

## Project Structure

```
terminalproject/
├── start-simple.sh           # Startup script (Xvfb + VNC + VSCode)
├── browser-viewer/           # VSCode extension
│   ├── src/
│   │   ├── extension.ts      # Extension entry point
│   │   └── browserViewProvider.ts  # Webview with noVNC launcher
│   └── media/                # noVNC JavaScript libraries
├── .claude/
│   └── settings.local.json   # Project Claude settings (DISPLAY=:99)
├── openvscode-server-v*/     # Pre-built OpenVSCode binary
└── archived/                 # Old complex architecture (reference)
```

## Ports

| Port | Service | Description |
|------|---------|-------------|
| 3000 | OpenVSCode | Web-based VSCode IDE |
| 5900 | x11vnc | VNC server (internal) |
| 6080 | websockify | noVNC web viewer |

## Requirements

- Node.js v18+
- Linux with X11 support (or WSL2)
- Packages: `xvfb x11vnc novnc websockify`

```bash
sudo apt-get install xvfb x11vnc novnc websockify
```

## Configuration

### Claude Code MCP Server

The Playwright MCP server is configured globally in `~/.claude.json`:

```json
{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

### Project Settings

The project's `.claude/settings.local.json` sets environment variables:

```json
{
  "env": {
    "DISPLAY": ":99",
    "PLAYWRIGHT_HEADLESS": "false"
  }
}
```

## Browser Viewer Extension

The extension adds a globe icon to VSCode's sidebar. Due to browser security restrictions, it can't embed the VNC viewer directly, so it provides a button to open noVNC in a new browser tab.

### Install Extension

```bash
cd browser-viewer
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository
```

Then in VSCode: Extensions → ... → Install from VSIX → select `browser-viewer-1.0.0.vsix`

## Troubleshooting

### Services not starting

```bash
# Check if processes are running
ps aux | grep -E "Xvfb|x11vnc|websockify"

# Check if ports are listening
ss -tlnp | grep -E "5900|6080"

# Clean up stale X locks
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
```

### x11vnc Wayland error

If you see "Wayland display server detected", ensure the start script includes:
```bash
unset WAYLAND_DISPLAY
```

### Browser not appearing in viewer

1. Verify display works: `DISPLAY=:99 xdpyinfo`
2. Check Playwright is using headed mode (PLAYWRIGHT_HEADLESS=false)
3. Try opening a test window: `DISPLAY=:99 xterm &`

### noVNC won't connect

1. Test VNC directly: visit `http://localhost:6080/vnc.html`
2. Click "Connect" button
3. Check websockify is running on port 6080

## Comparison: Old vs New Architecture

| Aspect | Old Architecture | New Architecture |
|--------|------------------|------------------|
| Lines of code | 2100+ (backend alone) | ~250 total |
| Components | Custom relay, chat UI, recorder | Just VNC stack + extension |
| Chat interface | Custom implementation | Claude Code CLI (built-in) |
| Browser control | Custom WebSocket protocol | @playwright/mcp (official) |
| Complexity | High | Low |

## License

MIT
