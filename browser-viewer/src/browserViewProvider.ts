import * as vscode from 'vscode';

export class BrowserViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'media')
      ]
    };

    webviewView.webview.html = this._getHtmlContent(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(message => {
      if (message.type === 'openExternal') {
        vscode.env.openExternal(vscode.Uri.parse(message.url));
      }
    });
  }

  refresh() {
    if (this._view) {
      this._view.webview.html = this._getHtmlContent(this._view.webview);
    }
  }

  private _getHtmlContent(webview: vscode.Webview): string {
    const config = vscode.workspace.getConfiguration('browserViewer');
    const wsPort = config.get<number>('websocketPort') || 6080;

    // Get URIs for noVNC resources
    const coreUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'core'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #1e1e1e;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      /* Padding to keep VSCode resize handles accessible */
      padding-right: 4px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      background: #3c3c3c;
      border-bottom: 1px solid #454545;
      font-size: 11px;
      color: #ccc;
    }
    .toolbar button {
      background: #0e639c;
      color: #fff;
      border: none;
      padding: 2px 8px;
      cursor: pointer;
      font-size: 11px;
      border-radius: 2px;
    }
    .toolbar button:hover {
      background: #1177bb;
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
    }
    .status-dot.connected {
      background: #4a4;
    }
    .status-dot.connecting {
      background: #fa4;
    }
    #screen {
      flex: 1;
      width: 100%;
      background: #000;
      overflow: hidden;
      position: relative;
    }
    #screen canvas {
      max-width: 100%;
      max-height: 100%;
      display: block;
    }
    .fallback {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #ccc;
      gap: 16px;
      padding: 20px;
      text-align: center;
    }
    .fallback p {
      color: #888;
      font-size: 12px;
      max-width: 250px;
      line-height: 1.5;
    }
    .fallback button {
      background: #0e639c;
      color: #fff;
      border: none;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 13px;
      border-radius: 4px;
    }
    .fallback button:hover {
      background: #1177bb;
    }
    .hidden {
      display: none !important;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="toolbar">
      <div class="status">
        <span class="status-dot" id="statusDot"></span>
        <span id="statusText">Connecting...</span>
      </div>
      <button id="openExternalBtn">Open in Browser</button>
    </div>
    <div id="screen"></div>
    <div id="fallback" class="fallback hidden">
      <p>WebSocket connection blocked by browser security.</p>
      <button id="openVncBtn">Open noVNC in Browser Tab</button>
      <p style="font-size: 10px; margin-top: 10px;">
        The browser viewer will open in a new tab where you can interact with the Playwright browser.
      </p>
    </div>
  </div>

  <script type="module">
    import RFB from '${coreUri}/rfb.js';

    const vscode = acquireVsCodeApi();
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const screen = document.getElementById('screen');
    const fallback = document.getElementById('fallback');
    const openExternalBtn = document.getElementById('openExternalBtn');
    const openVncBtn = document.getElementById('openVncBtn');

    let rfb = null;
    const wsPort = ${wsPort};
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

    openExternalBtn.addEventListener('click', openExternal);
    openVncBtn.addEventListener('click', openExternal);

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

          // Force rescale when sidebar resizes (debounced)
          let resizeTimeout;
          const resizeObserver = new ResizeObserver(() => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
              if (rfb) {
                // Toggle scaleViewport to force noVNC to recalculate dimensions
                rfb.scaleViewport = false;
                rfb.scaleViewport = true;
              }
            }, 50);
          });
          resizeObserver.observe(screen);

          // Initial rescale after connection settles
          setTimeout(() => {
            if (rfb) {
              rfb.scaleViewport = false;
              rfb.scaleViewport = true;
            }
          }, 100);
        });

        rfb.addEventListener('disconnect', (e) => {
          const clean = e.detail.clean;
          updateStatus('', clean ? 'Disconnected' : 'Connection lost');
          rfb = null;
          // Retry after a delay
          setTimeout(connect, 3000);
        });

      } catch (e) {
        console.error('VNC error:', e);
        // Check if it's a security/network error
        if (e.message && (e.message.includes('blocked') || e.message.includes('security'))) {
          showFallback();
        } else {
          updateStatus('', 'Error');
          setTimeout(connect, 3000);
        }
      }
    }

    // Also catch WebSocket errors at creation time
    const originalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      const ws = new originalWebSocket(url, protocols);
      ws.addEventListener('error', (e) => {
        console.log('WebSocket error, showing fallback');
        showFallback();
      });
      return ws;
    };
    window.WebSocket.prototype = originalWebSocket.prototype;
    window.WebSocket.CONNECTING = originalWebSocket.CONNECTING;
    window.WebSocket.OPEN = originalWebSocket.OPEN;
    window.WebSocket.CLOSING = originalWebSocket.CLOSING;
    window.WebSocket.CLOSED = originalWebSocket.CLOSED;

    // Start connection
    setTimeout(connect, 500);
  </script>
</body>
</html>`;
  }
}
