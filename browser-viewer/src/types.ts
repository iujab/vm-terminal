import * as vscode from 'vscode';
import { ChildProcess } from 'child_process';

export interface BrowserViewerConfig {
  baseDisplayNumber: number;
  baseVncPort: number;
  baseWebsocketPort: number;
  autoCreateViewer: boolean;
}

export function getConfig(): BrowserViewerConfig {
  const config = vscode.workspace.getConfiguration('browserViewer');
  const baseDisplayNumber = config.get<number>('baseDisplayNumber') || 99;
  return {
    baseDisplayNumber,
    baseVncPort: 5900,
    baseWebsocketPort: config.get<number>('baseWebsocketPort') || 6080,
    autoCreateViewer: config.get<boolean>('autoCreateViewer') ?? true,
  };
}

export interface DisplayStack {
  displayNumber: number;
  vncPort: number;
  websocketPort: number;
  xvfbProcess?: ChildProcess;
  x11vncProcess?: ChildProcess;
  websockifyProcess?: ChildProcess;
  isReady: boolean;
}

export interface TerminalDisplayInfo {
  terminalId: number;  // Terminal's internal ID (we'll use a counter)
  terminal: vscode.Terminal;
  displayStack: DisplayStack;
  viewerPanel?: vscode.WebviewPanel;
  createdAt: Date;
}
