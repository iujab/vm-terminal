# Playwright Assistant

A browser automation system featuring a VSCode extension interface, WebSocket-based relay server, and Docker containerization for sandboxed browser control. Integrates with the Anthropic Claude API for AI-powered browser interaction.

## Quick Start

```bash
# Basic startup (backend + VSCode IDE)
./start.sh

# With Docker VM for sandboxed browser
./start.sh --vm

# Build Docker image first, then start
./start.sh --build-vm
```

**Requirements:**
- Node.js v18+ (v20 recommended)
- Docker & Docker Compose (optional, for `--vm` mode)
- `ANTHROPIC_API_KEY` environment variable (for chat functionality)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Browser (localhost:3000)                │
│                         OpenVSCode Server                       │
└────────────────────────────────┬────────────────────────────────┘
                                 │
┌────────────────────────────────┴────────────────────────────────┐
│              Playwright Assistant VSCode Extension              │
│  ┌─────────────────────────┬──────────────────────────────────┐│
│  │   Playwright Viewer     │         Chat Panel               ││
│  │  - Live screenshots     │  - Claude AI integration         ││
│  │  - Click passthrough    │  - Context-aware responses       ││
│  │  - Tab management       │  - Streaming support             ││
│  └─────────────────────────┴──────────────────────────────────┘│
└────────────────────────────────┬────────────────────────────────┘
                                 │ WebSocket + HTTP
┌────────────────────────────────┴────────────────────────────────┐
│                  Backend Relay Server (Node.js)                 │
│  - WebSocket server (port 8767)                                 │
│  - Chat API (port 8766)                                         │
│  - Control coordination, session recording, code generation     │
└──────────────┬──────────────────────────────────────────────────┘
               │
┌──────────────┴──────────────┐
│    Docker VM (optional)     │
│  - Chrome + Playwright      │
│  - VNC/noVNC access         │
│  - Sandboxed environment    │
└─────────────────────────────┘
```

## Project Structure

```
terminalproject/
├── backend/                    # Node.js relay server
│   ├── playwright-relay.ts     # Main WebSocket + HTTP server
│   ├── docker-playwright-client.ts  # Docker WebSocket client
│   ├── claude-client.ts        # Anthropic Claude API integration
│   ├── code-generator.ts       # Test code generation from recordings
│   ├── session-recorder.ts     # Recording & playback management
│   ├── control-coordinator.ts  # Bidirectional control management
│   ├── voice-commands.ts       # Voice command parsing
│   └── mcp-client.ts           # MCP protocol client (fallback)
│
├── playwright-assistant/       # VSCode extension
│   ├── src/
│   │   ├── extension.ts        # Extension activation & commands
│   │   ├── playwrightViewProvider.ts  # Browser viewer panel
│   │   └── chatViewProvider.ts # Chat interface panel
│   └── media/
│       ├── playwright/         # Browser viewer UI (HTML/JS/CSS)
│       └── chatbot/            # Chat panel UI
│
├── vm/                         # Docker container for sandboxed browser
│   ├── playwright-server.ts    # Chrome automation server
│   ├── Dockerfile              # Ubuntu 22.04 + Chrome + VNC
│   ├── docker-compose.yml      # Service orchestration
│   └── supervisord.conf        # Process management
│
├── openvscode-server-v*/       # Pre-built OpenVSCode binary
└── start.sh                    # Main startup script
```

## Service Ports

| Service | Port | Description |
|---------|------|-------------|
| OpenVSCode | 3000 | Web IDE interface |
| Backend WebSocket | 8767 | Extension ↔ Backend communication |
| Chat API | 8766 | Claude API gateway |
| Docker Playwright | 8765 | VM ↔ Backend (when using --vm) |
| noVNC | 6080 | Web-based VNC viewer |
| VNC Direct | 5900 | Direct VNC connection |
| Chrome DevTools | 9222 | Chrome debugging protocol |

## Features

### Browser Automation
- **Live Screenshots**: Automatic refresh at configurable intervals (default 200ms)
- **Click/Scroll Passthrough**: Interact with the browser through the viewer
- **Tab Management**: Create, switch, and close browser tabs
- **Navigation**: URL bar, back/forward/reload buttons
- **Keyboard Input**: Type text, press keys, modifier combinations

### AI Integration
- **Claude Chat**: Context-aware AI assistance with browser state
- **Streaming Responses**: Real-time response streaming
- **Voice Commands**: Natural language browser control

### Session Recording
- **Record Actions**: Capture clicks, typing, navigation
- **Screenshot Capture**: Automatic screenshots with each action
- **Playback**: Replay recordings with speed control
- **Export**: Generate test code from recordings

### Code Generation
Export recorded sessions to executable test code:
- **Frameworks**: Playwright, Puppeteer, Selenium
- **Languages**: TypeScript, JavaScript, Python

### Inspector Mode
- **Element Selection**: Click to inspect DOM elements
- **Selector Generation**: CSS, XPath, test ID, role, ARIA label
- **Bounding Box**: Visual element highlighting

## Configuration

### Environment Variables

```bash
# Required for chat functionality
export ANTHROPIC_API_KEY="your-api-key"

# Automatically set by start.sh when using --vm
export USE_DOCKER_PLAYWRIGHT=true
export DOCKER_PLAYWRIGHT_WS="ws://localhost:8765"
```

### VSCode Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `playwrightAssistant.relayServerUrl` | `ws://localhost:8765` | WebSocket server URL |
| `playwrightAssistant.screenshotInterval` | `200` | Screenshot refresh interval (ms) |
| `playwrightAssistant.chatApiUrl` | `http://localhost:8766/chat` | Chat API endpoint |
| `playwrightAssistant.codeGenFormat` | `playwright` | Code generation format |
| `playwrightAssistant.codeGenLanguage` | `typescript` | Code generation language |

## Development

### Build Backend

```bash
cd backend
npm install
npm run build    # Compile TypeScript
npm run dev      # Development with ts-node
```

### Build Extension

```bash
cd playwright-assistant
npm install
npm run compile  # Compile TypeScript
npm run watch    # Watch mode
```

### Build Docker VM

```bash
cd vm
npm install
npm run build    # Compile TypeScript
docker-compose build
docker-compose up -d
```

## How It Works

### Without Docker (`./start.sh`)

1. Backend relay server starts on ports 8767 (WebSocket) and 8766 (HTTP)
2. OpenVSCode server starts on port 3000
3. Extension connects to backend via WebSocket
4. Backend uses MCP client for browser automation (requires MCP server)

### With Docker (`./start.sh --vm`)

1. Docker container starts with:
   - Xvfb (virtual display)
   - x11vnc (VNC server)
   - noVNC (web VNC)
   - Chrome with DevTools Protocol
   - Playwright server (WebSocket on 8765)
2. Backend connects to Docker's Playwright server
3. Browser runs in isolated container environment
4. VNC provides alternative viewing method

## Data Flow

```
User Action (click in viewer)
    ↓
Extension captures event, calculates coordinates
    ↓
WebSocket message to backend: { type: 'click', x, y }
    ↓
Control Coordinator queues action
    ↓
Docker Playwright Client sends to VM: { type: 'click', x, y }
    ↓
Playwright Server executes: page.mouse.click(x, y)
    ↓
Screenshot captured and broadcast
    ↓
Extension receives screenshot, updates viewer
```

## Troubleshooting

### Docker container won't start

```bash
# Check container status
docker ps -a

# View container logs
docker logs playwright-vm

# Check supervisor logs inside container
docker exec playwright-vm cat /var/log/supervisor/chrome-error.log
```

### Chrome CDP not responding

The Chrome flags in `vm/supervisord.conf` must include:
- `--remote-debugging-port=9222`
- `--remote-debugging-address=0.0.0.0`
- `--user-data-dir=/tmp/chrome-data`

### Port already in use

```bash
# Find process using port
lsof -i :8765

# Kill process
kill -9 <PID>
```

### WebSocket connection failed

1. Ensure backend is running: `curl http://localhost:8766/health`
2. Check if Docker container is healthy: `docker ps`
3. Verify port mapping: `docker port playwright-vm`

## Technology Stack

| Component | Technology |
|-----------|------------|
| IDE Server | OpenVSCode 1.106.3 |
| Backend | Node.js, TypeScript |
| Communication | WebSockets (ws), HTTP |
| Browser Automation | Playwright |
| AI | Anthropic Claude API |
| Containerization | Docker, Ubuntu 22.04 |
| Display | Xvfb, x11vnc, noVNC |
| Process Management | Supervisor |

## License

[Add your license here]
