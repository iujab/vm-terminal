import * as vscode from 'vscode';
import * as fs from 'fs';
import { DisplayManager } from './displayManager';
import { TerminalDisplayInfo, getConfig } from './types';

export class TerminalDisplayManager {
  private terminalMap: Map<vscode.Terminal, TerminalDisplayInfo> = new Map();
  private displayManager: DisplayManager;
  private extensionUri: vscode.Uri;
  private outputChannel: vscode.OutputChannel;
  private nextTerminalId = 1;

  constructor(
    displayManager: DisplayManager,
    extensionUri: vscode.Uri,
    outputChannel: vscode.OutputChannel
  ) {
    this.displayManager = displayManager;
    this.extensionUri = extensionUri;
    this.outputChannel = outputChannel;
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] TerminalDisplayManager: ${message}`);
  }

  async createTerminalWithDisplay(name?: string): Promise<TerminalDisplayInfo> {
    const displayNumber = this.displayManager.allocateDisplayNumber();
    const terminalId = this.nextTerminalId++;

    this.log(`Creating terminal ${terminalId} with display :${displayNumber}`);

    // Start display stack first
    const displayStack = await this.displayManager.startDisplayStack(displayNumber);

    // Create terminal with isolated environment
    const terminalName = name || `Browser Terminal :${displayNumber}`;
    // Each terminal needs its own user-data-dir to prevent Chrome from
    // connecting to existing browser sessions instead of launching new ones
    const userDataDir = `/tmp/browser-viewer-playwright-${displayNumber}`;

    // Create a wrapper script that forces the correct DISPLAY
    const wrapperDir = `/tmp/browser-viewer-${displayNumber}`;
    const wrapperScript = `${wrapperDir}/playwright-wrapper.sh`;

    try {
      if (!fs.existsSync(wrapperDir)) {
        fs.mkdirSync(wrapperDir, { recursive: true });
      }
      // Wrapper script that forces DISPLAY before running Playwright MCP
      fs.writeFileSync(wrapperScript,
`#!/bin/bash
export DISPLAY=:${displayNumber}
export PLAYWRIGHT_MCP_USER_DATA_DIR="${userDataDir}"
exec npx @playwright/mcp@latest --isolated "$@"
`, { mode: 0o755 });
      this.log(`Created wrapper script: ${wrapperScript}`);
    } catch (err) {
      this.log(`Failed to create wrapper script: ${err}`);
    }

    const terminal = vscode.window.createTerminal({
      name: terminalName,
      env: {
        DISPLAY: `:${displayNumber}`,
        BROWSER_VIEWER_DISPLAY: displayNumber.toString(),
        PLAYWRIGHT_MCP_USER_DATA_DIR: userDataDir,
      },
    });

    // Configure Claude to use our wrapper script for Playwright MCP in this terminal
    terminal.sendText(`# Setting up Browser Terminal :${displayNumber}
claude mcp remove playwright 2>/dev/null
claude mcp add playwright -- ${wrapperScript}
echo "✓ Browser Terminal :${displayNumber} ready (DISPLAY=:${displayNumber})"
`);

    const info: TerminalDisplayInfo = {
      terminalId,
      terminal,
      displayStack,
      createdAt: new Date(),
    };

    this.terminalMap.set(terminal, info);

    // Create viewer panel if auto-create is enabled
    const config = getConfig();
    if (config.autoCreateViewer) {
      this.createViewerPanel(info);
    }

    terminal.show();
    this.log(`Terminal ${terminalId} created with display :${displayNumber}`);

    return info;
  }

  createViewerPanel(info: TerminalDisplayInfo): vscode.WebviewPanel {
    if (info.viewerPanel) {
      info.viewerPanel.reveal();
      return info.viewerPanel;
    }

    this.log(`Creating viewer panel for display :${info.displayStack.displayNumber}`);

    const panel = vscode.window.createWebviewPanel(
      'browserViewer',
      `Browser :${info.displayStack.displayNumber}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      }
    );

    panel.webview.html = this.getViewerHtml(panel.webview, info);

    panel.onDidDispose(() => {
      this.log(`Viewer panel for display :${info.displayStack.displayNumber} disposed`);
      info.viewerPanel = undefined;
    });

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(message => {
      if (message.type === 'openExternal') {
        vscode.env.openExternal(vscode.Uri.parse(message.url));
      }
    });

    info.viewerPanel = panel;
    return panel;
  }

  releaseTerminal(terminal: vscode.Terminal): void {
    const info = this.terminalMap.get(terminal);
    if (!info) {
      return;
    }

    const displayNumber = info.displayStack.displayNumber;
    this.log(`Releasing terminal ${info.terminalId} with display :${displayNumber}`);

    // Close viewer panel if open
    if (info.viewerPanel) {
      info.viewerPanel.dispose();
    }

    // Stop display stack
    this.displayManager.stopDisplayStack(displayNumber);

    // Clean up user data directory
    const userDataDir = `/tmp/browser-viewer-playwright-${displayNumber}`;
    try {
      if (fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
        this.log(`Cleaned up user data directory: ${userDataDir}`);
      }
    } catch (err) {
      this.log(`Failed to clean up user data directory: ${err}`);
    }

    this.terminalMap.delete(terminal);
  }

  getTerminalInfo(terminal: vscode.Terminal): TerminalDisplayInfo | undefined {
    return this.terminalMap.get(terminal);
  }

  getAllTerminals(): TerminalDisplayInfo[] {
    return Array.from(this.terminalMap.values());
  }

  getTerminalCount(): number {
    return this.terminalMap.size;
  }

  dispose(): void {
    this.log('Disposing TerminalDisplayManager');
    for (const [terminal] of this.terminalMap) {
      this.releaseTerminal(terminal);
    }
  }

  private getViewerHtml(webview: vscode.Webview, info: TerminalDisplayInfo): string {
    const coreUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'core')
    );
    const { displayNumber, websocketPort } = info.displayStack;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--vscode-editor-background, #1e1e1e);
      font-family: inherit;
    }
    .container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      background: var(--vscode-sideBarSectionHeader-background, #3c3c3c);
      border-bottom: 1px solid var(--vscode-sideBar-border, #454545);
      font-size: 12px;
      color: var(--vscode-sideBar-foreground, #ccc);
    }
    .display-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .display-badge::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--vscode-terminal-ansiGreen, #4a4);
    }
    .toolbar button {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      padding: 4px 12px;
      cursor: pointer;
      font-size: 11px;
      border-radius: 3px;
      transition: background 0.15s ease;
    }
    .toolbar button:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    .status {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f44;
      transition: background 0.2s ease, box-shadow 0.2s ease;
    }
    .status-dot.connected {
      background: #4a4;
      box-shadow: 0 0 6px rgba(68, 170, 68, 0.6);
    }
    .status-dot.connecting {
      background: #fa4;
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.8); }
    }
    #screen {
      flex: 1;
      width: 100%;
      background: #000;
      overflow: hidden;
    }
    #screen canvas {
      max-width: 100%;
      max-height: 100%;
      display: block;
    }
    #screen canvas[style*="cursor: none"],
    #screen canvas[style*="cursor:none"] {
      cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Ccircle cx='10' cy='10' r='6' fill='none' stroke='%23fff' stroke-width='1.5'/%3E%3Cline x1='10' y1='0' x2='10' y2='6' stroke='%23fff' stroke-width='1.5'/%3E%3Cline x1='10' y1='14' x2='10' y2='20' stroke='%23fff' stroke-width='1.5'/%3E%3Cline x1='0' y1='10' x2='6' y2='10' stroke='%23fff' stroke-width='1.5'/%3E%3Cline x1='14' y1='10' x2='20' y2='10' stroke='%23fff' stroke-width='1.5'/%3E%3C/svg%3E") 10 10, crosshair !important;
    }
    .fallback {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--vscode-sideBar-foreground, #ccc);
      gap: 16px;
      padding: 20px;
      text-align: center;
    }
    .fallback p {
      color: var(--vscode-descriptionForeground, #888);
      font-size: 12px;
      line-height: 1.5;
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="container">
    <div class="toolbar">
      <div class="display-badge">DISPLAY :${displayNumber}</div>
      <div class="status">
        <span class="status-dot" id="statusDot"></span>
        <span id="statusText">Connecting...</span>
      </div>
      <button id="openExternalBtn">Open External</button>
    </div>
    <div id="screen"></div>
    <div id="fallback" class="fallback hidden">
      <p>WebSocket connection blocked.</p>
      <button id="openVncBtn">Open in Browser</button>
    </div>
  </div>

  <script type="module">
    import RFB from '${coreUri}/rfb.js';

    const vscode = acquireVsCodeApi();
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const screen = document.getElementById('screen');
    const fallback = document.getElementById('fallback');

    let rfb = null;
    const wsPort = ${websocketPort};
    const wsUrl = 'ws://localhost:' + wsPort;
    const httpUrl = 'http://localhost:' + wsPort + '/vnc.html?autoconnect=true&resize=scale';

    function updateStatus(state, text) {
      statusDot.className = 'status-dot ' + state;
      statusText.textContent = text;
    }

    function showFallback() {
      screen.classList.add('hidden');
      fallback.classList.remove('hidden');
      updateStatus('', 'Blocked');
    }

    function openExternal() {
      vscode.postMessage({ type: 'openExternal', url: httpUrl });
    }

    document.getElementById('openExternalBtn').addEventListener('click', openExternal);
    document.getElementById('openVncBtn').addEventListener('click', openExternal);

    function connect() {
      updateStatus('connecting', 'Connecting...');
      try {
        rfb = new RFB(screen, wsUrl, {
          scaleViewport: true,
          resizeSession: false,
          clipViewport: false
        });

        rfb.addEventListener('connect', () => {
          updateStatus('connected', 'Connected');
          screen.classList.remove('hidden');
          fallback.classList.add('hidden');

          let resizeTimeout;
          const resizeObserver = new ResizeObserver(() => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
              if (rfb) {
                rfb.scaleViewport = false;
                rfb.scaleViewport = true;
              }
            }, 50);
          });
          resizeObserver.observe(screen);

          setTimeout(() => {
            if (rfb) {
              rfb.scaleViewport = false;
              rfb.scaleViewport = true;
            }
          }, 100);
        });

        rfb.addEventListener('disconnect', (e) => {
          updateStatus('', e.detail.clean ? 'Disconnected' : 'Connection lost');
          rfb = null;
          setTimeout(connect, 3000);
        });
      } catch (e) {
        console.error('VNC error:', e);
        updateStatus('', 'Error');
        setTimeout(connect, 3000);
      }
    }

    const originalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      const ws = new originalWebSocket(url, protocols);
      ws.addEventListener('error', () => showFallback());
      return ws;
    };
    window.WebSocket.prototype = originalWebSocket.prototype;
    Object.assign(window.WebSocket, originalWebSocket);

    setTimeout(connect, 500);
  </script>
</body>
</html>`;
  }
}
