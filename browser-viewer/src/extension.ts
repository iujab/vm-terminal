import * as vscode from 'vscode';
import { BrowserViewProvider } from './browserViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new BrowserViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('browserViewer.view', provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('browserViewer.refresh', () => {
      provider.refresh();
    })
  );
}

export function deactivate() {}
