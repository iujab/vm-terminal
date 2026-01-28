# Playwright Assistant

A VSCode extension that provides two interactive panels:
1. **Playwright Viewer** - Live browser screenshots with click/scroll passthrough
2. **Chat Panel** - Dedicated chatbot interface

## Installation

The extension is automatically symlinked to the OpenVSCode server's extensions folder.

## Usage

### Starting the Services

From the project root:

```bash
./start.sh
```

Or manually:

1. Start the backend relay server:
   ```bash
   cd backend
   npm start
   ```

2. Start OpenVSCode server:
   ```bash
   cd openvscode-server-v1.106.3-linux-x64
   ./bin/openvscode-server --without-connection-token
   ```

3. Open http://localhost:3000 in your browser

### Using the Extension

1. Click the "Playwright Assistant" icon in the activity bar (left sidebar)
2. Two panels will appear:
   - **Playwright Viewer**: Shows live browser screenshots
   - **Chat**: Chat interface for asking questions

### Playwright Viewer Features

- **Click passthrough**: Click on the screenshot to interact with the page
- **Scroll passthrough**: Scroll on the screenshot to scroll the page
- **Type input**: Use the text input to type text on the focused element
- **Auto-refresh**: Screenshots update automatically every 200ms

### Chat Panel Features

- **Message history**: Persists across panel reloads
- **Send messages**: Type and press Enter or click the send button
- **Error handling**: Shows connection errors inline

## Configuration

Settings are available in VSCode settings under "Playwright Assistant":

- `playwrightAssistant.relayServerUrl`: WebSocket URL for Playwright relay (default: `ws://localhost:8765`)
- `playwrightAssistant.screenshotInterval`: Screenshot refresh interval in ms (default: 200)
- `playwrightAssistant.chatApiUrl`: Chat API endpoint (default: `http://localhost:8766/chat`)

## Architecture

```
Webview <--postMessage--> Extension Host <--WebSocket--> Backend <--MCP--> Playwright
```

## Development

### Extension
```bash
cd playwright-assistant
npm install
npm run compile   # Build once
npm run watch     # Watch mode
```

### Backend
```bash
cd backend
npm install
npm run build     # Build once
npm run dev       # Development with ts-node
npm start         # Production
```

## File Structure

```
playwright-assistant/
├── package.json          # Extension manifest
├── tsconfig.json         # TypeScript config
├── src/
│   ├── extension.ts      # Main entry point
│   ├── playwrightViewProvider.ts
│   └── chatViewProvider.ts
├── media/
│   ├── icon.svg
│   ├── playwright/
│   │   ├── viewer.html
│   │   ├── viewer.css
│   │   └── viewer.js
│   └── chatbot/
│       ├── chat.html
│       ├── chat.css
│       └── chat.js
└── dist/                 # Compiled output

backend/
├── package.json
├── tsconfig.json
├── playwright-relay.ts   # WebSocket relay + Chat API
└── dist/
```
