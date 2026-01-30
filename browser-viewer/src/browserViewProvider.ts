import * as vscode from 'vscode';
import { TerminalDisplayManager } from './terminalDisplayManager';

export class BrowserViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private terminalDisplayManager: TerminalDisplayManager;
  private outputChannel: vscode.OutputChannel;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    terminalDisplayManager: TerminalDisplayManager,
    outputChannel: vscode.OutputChannel
  ) {
    this.terminalDisplayManager = terminalDisplayManager;
    this.outputChannel = outputChannel;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this._getHtmlContent();

    webviewView.webview.onDidReceiveMessage(message => {
      switch (message.type) {
        case 'createTerminal':
          vscode.commands.executeCommand('browserViewer.createTerminal');
          break;
        case 'showViewer':
          const terminals = this.terminalDisplayManager.getAllTerminals();
          const info = terminals.find(t => t.displayStack.displayNumber === message.displayNumber);
          if (info) {
            this.terminalDisplayManager.createViewerPanel(info);
          }
          break;
        case 'focusTerminal':
          const terminalInfos = this.terminalDisplayManager.getAllTerminals();
          const termInfo = terminalInfos.find(t => t.displayStack.displayNumber === message.displayNumber);
          if (termInfo) {
            termInfo.terminal.show();
          }
          break;
      }
    });
  }

  refresh() {
    if (this._view) {
      this._view.webview.html = this._getHtmlContent();
    }
  }

  private _getHtmlContent(): string {
    const terminals = this.terminalDisplayManager.getAllTerminals();
    const terminalCount = terminals.length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      padding: 12px;
      font-family: inherit;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .header h2 {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground);
    }
    .count-badge {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .create-btn {
      width: 100%;
      padding: 10px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 16px;
      transition: background 0.15s;
    }
    .create-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .terminal-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .terminal-item {
      background: var(--vscode-list-hoverBackground);
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 6px;
      padding: 10px 12px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .terminal-item:hover {
      background: var(--vscode-list-activeSelectionBackground);
      border-color: var(--vscode-focusBorder);
    }
    .terminal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .terminal-name {
      font-weight: 500;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .terminal-name::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--vscode-terminal-ansiGreen, #4a4);
      box-shadow: 0 0 4px rgba(68, 170, 68, 0.5);
    }
    .display-tag {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 6px;
      border-radius: 8px;
      font-size: 10px;
      font-weight: 600;
    }
    .terminal-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    .terminal-actions button {
      flex: 1;
      padding: 5px 8px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 3px;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .terminal-actions button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .terminal-actions button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .terminal-actions button.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .empty-state {
      text-align: center;
      padding: 24px 16px;
      color: var(--vscode-descriptionForeground);
    }
    .empty-state .icon {
      font-size: 32px;
      margin-bottom: 12px;
      opacity: 0.6;
    }
    .empty-state p {
      font-size: 12px;
      line-height: 1.5;
      margin-bottom: 16px;
    }
    .info-box {
      margin-top: 16px;
      padding: 10px 12px;
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
      border-radius: 3px;
      font-size: 11px;
      line-height: 1.5;
      color: var(--vscode-descriptionForeground);
    }
    .info-box code {
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 2px;
      font-family: var(--vscode-editor-font-family);
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>Browser Terminals</h2>
    <span class="count-badge">${terminalCount}</span>
  </div>

  <button class="create-btn" onclick="createTerminal()">
    <span>+</span> Create Browser Terminal
  </button>

  ${terminalCount > 0 ? this._getTerminalListHtml(terminals) : this._getEmptyStateHtml()}

  <script>
    const vscode = acquireVsCodeApi();

    function createTerminal() {
      vscode.postMessage({ type: 'createTerminal' });
    }

    function showViewer(displayNumber) {
      vscode.postMessage({ type: 'showViewer', displayNumber });
    }

    function focusTerminal(displayNumber) {
      vscode.postMessage({ type: 'focusTerminal', displayNumber });
    }
  </script>
</body>
</html>`;
  }

  private _getTerminalListHtml(terminals: ReturnType<TerminalDisplayManager['getAllTerminals']>): string {
    return `
      <div class="terminal-list">
        ${terminals.map(info => `
          <div class="terminal-item">
            <div class="terminal-header">
              <span class="terminal-name">${this._escapeHtml(info.terminal.name)}</span>
              <span class="display-tag">:${info.displayStack.displayNumber}</span>
            </div>
            <div class="terminal-actions">
              <button onclick="focusTerminal(${info.displayStack.displayNumber})">Focus Terminal</button>
              <button class="primary" onclick="showViewer(${info.displayStack.displayNumber})">Show Browser</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="info-box">
        Each terminal has its own isolated display. Run <code>claude</code> in a terminal and use Playwright - the browser will appear in that terminal's viewer.
      </div>
    `;
  }

  private _getEmptyStateHtml(): string {
    return `
      <div class="empty-state">
        <div class="icon">🌐</div>
        <p>No browser terminals yet.<br/>Create one to start using Playwright with an isolated display.</p>
      </div>
      <div class="info-box">
        Each browser terminal gets its own X11 display (:99, :100, etc.) so multiple Claude sessions can run Playwright simultaneously without conflicts.
      </div>
    `;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
