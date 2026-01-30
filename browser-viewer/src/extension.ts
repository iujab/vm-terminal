import * as vscode from 'vscode';
import { DisplayManager } from './displayManager';
import { TerminalDisplayManager } from './terminalDisplayManager';
import { BrowserViewProvider } from './browserViewProvider';

let displayManager: DisplayManager;
let terminalDisplayManager: TerminalDisplayManager;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Browser Viewer');
  log('Extension activating...');

  // Initialize managers
  displayManager = new DisplayManager(outputChannel);
  terminalDisplayManager = new TerminalDisplayManager(
    displayManager,
    context.extensionUri,
    outputChannel
  );

  // Register sidebar view provider (shows dashboard)
  const sidebarProvider = new BrowserViewProvider(
    context.extensionUri,
    terminalDisplayManager,
    outputChannel
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('browserViewer.view', sidebarProvider)
  );

  // Track terminal closures to cleanup displays
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(terminal => {
      const info = terminalDisplayManager.getTerminalInfo(terminal);
      if (info) {
        log(`Terminal closed: display :${info.displayStack.displayNumber}`);
        terminalDisplayManager.releaseTerminal(terminal);
        sidebarProvider.refresh();
      }
    })
  );

  // Command: Create new terminal with isolated display
  context.subscriptions.push(
    vscode.commands.registerCommand('browserViewer.createTerminal', async () => {
      try {
        log('Creating new terminal with isolated display...');
        await terminalDisplayManager.createTerminalWithDisplay();
        sidebarProvider.refresh();
        vscode.window.showInformationMessage('Browser terminal created');
      } catch (err) {
        log(`Error creating terminal: ${err}`);
        vscode.window.showErrorMessage(`Failed to create browser terminal: ${err}`);
      }
    })
  );

  // Command: Show viewer for active terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('browserViewer.showViewer', () => {
      const activeTerminal = vscode.window.activeTerminal;
      if (!activeTerminal) {
        vscode.window.showWarningMessage('No active terminal');
        return;
      }

      const info = terminalDisplayManager.getTerminalInfo(activeTerminal);
      if (!info) {
        vscode.window.showWarningMessage('Active terminal does not have an isolated display. Use "Create Browser Terminal" command.');
        return;
      }

      terminalDisplayManager.createViewerPanel(info);
    })
  );

  // Command: Refresh sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('browserViewer.refresh', () => {
      sidebarProvider.refresh();
    })
  );

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: () => {
      terminalDisplayManager.dispose();
      displayManager.dispose();
      outputChannel.dispose();
    }
  });

  log('Extension activated');
}

function log(message: string): void {
  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}

export function deactivate() {
  // Cleanup handled by dispose subscriptions
}
