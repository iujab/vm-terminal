import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Annotation data structure for screenshot annotations
 */
export interface Annotation {
    id: string;
    type: 'pen' | 'highlighter' | 'arrow' | 'rectangle' | 'circle' | 'text';
    points?: { x: number; y: number }[];
    start?: { x: number; y: number };
    end?: { x: number; y: number };
    text?: string;
    color: string;
    strokeWidth: number;
    timestamp: number;
}

/**
 * Collaboration state for status bar updates
 */
export interface CollaborationState {
    active: boolean;
    participantCount: number;
    sessionId?: string;
    inviteCode?: string;
}

export class PlaywrightViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'playwrightViewer';
    private _view?: vscode.WebviewView;

    // Event emitter for annotated screenshots
    private _onAnnotatedScreenshot = new vscode.EventEmitter<{ image: string; annotations: Annotation[] }>();
    public readonly onAnnotatedScreenshot = this._onAnnotatedScreenshot.event;

    // Collaboration state
    private _collaborationState: CollaborationState = { active: false, participantCount: 0 };
    private _onCollaborationStateChange = new vscode.EventEmitter<CollaborationState>();
    public readonly onCollaborationStateChange = this._onCollaborationStateChange.event;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
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

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'click':
                    this._handleClick(message.x, message.y);
                    break;
                case 'scroll':
                    this._handleScroll(message.deltaX, message.deltaY);
                    break;
                case 'type':
                    this._handleType(message.text);
                    break;
                case 'navigate':
                    this._handleNavigate(message.url);
                    break;
                case 'snapshot':
                    this._handleSnapshot(message.content);
                    break;
                case 'browserEvent':
                    this._handleBrowserEvent(message.event, message.data);
                    break;
                case 'ready':
                    console.log('Playwright viewer ready');
                    break;
                case 'error':
                    vscode.window.showErrorMessage(`Playwright Viewer: ${message.message}`);
                    break;
                case 'vncConnected':
                    console.log('VNC connected');
                    break;
                case 'vncDisconnected':
                    console.log('VNC disconnected:', message.reason);
                    break;
                case 'voiceCommand':
                    this._handleVoiceCommand(message);
                    break;
                case 'voiceCommandResult':
                    console.log('Voice command result:', message);
                    break;
                case 'sendAnnotatedScreenshot':
                    this._handleAnnotatedScreenshot(message.image, message.annotations);
                    break;
                case 'recordingStarted':
                    console.log('Recording started');
                    break;
                case 'recordingStopped':
                    console.log('Recording stopped with', message.actions?.length || 0, 'actions');
                    break;
                case 'actionRecorded':
                    console.log('Action recorded:', message.action);
                    break;
                case 'codeGenerationReady':
                    console.log('Code generation module ready');
                    break;
                case 'openGeneratedCode':
                    this._openGeneratedCodeInEditor(message.code, message.language);
                    break;
                case 'generateCode':
                    console.log('Code generation request:', message.options);
                    break;
                case 'info':
                    vscode.window.showInformationMessage(message.message);
                    break;
                case 'tabsUpdated':
                    this._handleTabsUpdated(message.tabs, message.activeTabId);
                    break;
                case 'tabCreated':
                    console.log('Tab created:', message.tab);
                    break;
                case 'tabClosed':
                    console.log('Tab closed:', message.tabId);
                    break;
                case 'tabChanged':
                    console.log('Tab changed:', message.tabId);
                    break;
                // Collaboration messages
                case 'collaborationSessionCreated':
                    this._handleSessionCreated(message);
                    break;
                case 'collaborationSessionJoined':
                    this._handleSessionJoined(message);
                    break;
                case 'collaborationSessionLeft':
                    this._handleSessionLeft();
                    break;
                case 'collaborationParticipantJoined':
                    this._handleParticipantJoined(message);
                    break;
                case 'collaborationParticipantLeft':
                    this._handleParticipantLeft(message);
                    break;
                case 'collaborationStateUpdate':
                    this._handleCollaborationStateUpdate(message);
                    break;
                case 'collaborationError':
                    vscode.window.showErrorMessage(`Collaboration Error: ${message.message}`);
                    break;
            }
        });
    }

    private _handleTabsUpdated(tabs: any[], activeTabId: string) {
        console.log(`Tabs updated: ${tabs.length} tabs, active: ${activeTabId}`);
    }

    public refresh() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'refresh' });
        }
    }

    public navigate(url: string) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'navigate', url });
        }
    }

    public getSnapshot() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'getSnapshot' });
        }
    }

    public setMode(mode: 'screenshot' | 'vnc') {
        if (this._view) {
            this._view.webview.postMessage({ type: 'setMode', mode });
        }
    }

    private _handleClick(x: number, y: number) {
        console.log(`Click at (${x}, ${y})`);
        if (this._view) {
            this._view.webview.postMessage({
                type: 'sendAction',
                action: 'click',
                x,
                y
            });
        }
    }

    private _handleScroll(deltaX: number, deltaY: number) {
        console.log(`Scroll by (${deltaX}, ${deltaY})`);
        if (this._view) {
            this._view.webview.postMessage({
                type: 'sendAction',
                action: 'scroll',
                deltaX,
                deltaY
            });
        }
    }

    private _handleType(text: string) {
        console.log(`Type: ${text}`);
        if (this._view) {
            this._view.webview.postMessage({
                type: 'sendAction',
                action: 'type',
                text
            });
        }
    }

    private _handleNavigate(url: string) {
        console.log(`Navigate to: ${url}`);
    }

    private _handleSnapshot(content: string) {
        console.log('Received accessibility snapshot');
        // Could display in a separate panel or use for AI context
    }

    private _handleBrowserEvent(event: string, data: any) {
        console.log(`Browser event: ${event}`, data);
    }

    private _handleVoiceCommand(message: any) {
        console.log('Voice command received:', message);
        // Forward voice command to relay server for processing
        if (this._view) {
            this._view.webview.postMessage({
                type: 'sendAction',
                ...message
            });
        }
    }

    private _handleAnnotatedScreenshot(image: string, annotations: Annotation[]) {
        console.log('Annotated screenshot received with', annotations.length, 'annotations');
        // Fire the event so other parts of the extension can handle it
        this._onAnnotatedScreenshot.fire({ image, annotations });
    }

    /**
     * Toggle annotation mode on/off
     */
    public toggleAnnotationMode() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'toggleAnnotationMode' });
        }
    }

    /**
     * Send annotated screenshot to chat
     */
    public sendAnnotatedScreenshotToChat() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'sendAnnotatedScreenshotToChat' });
        }
    }

    /**
     * Start recording browser interactions
     */
    public startRecording() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'startRecording' });
        }
    }

    /**
     * Stop recording browser interactions
     */
    public stopRecording() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'stopRecording' });
        }
    }

    /**
     * Open the code export modal
     */
    public exportCode() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'exportCode' });
        }
    }

    /**
     * Clear the current recording
     */
    public clearRecording() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'clearRecording' });
        }
    }

    /**
     * Create a new browser tab
     */
    public newTab(url?: string) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'newTab', url });
        }
    }

    /**
     * Close a browser tab
     */
    public closeTab(tabId?: string) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'closeTab', tabId });
        }
    }

    /**
     * Switch to a specific tab
     */
    public switchTab(tabId: string) {
        if (this._view) {
            this._view.webview.postMessage({ type: 'switchTab', tabId });
        }
    }

    /**
     * Get all tabs
     */
    public getTabs() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'getTabs' });
        }
    }

    // ================== Collaboration Methods ==================

    /**
     * Create a new collaboration session
     */
    public createCollaborationSession(sessionName: string, participantName: string) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'createCollaborationSession',
                sessionName,
                participantName
            });
        }
    }

    /**
     * Join an existing collaboration session
     */
    public joinCollaborationSession(inviteCode: string, participantName: string) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'joinCollaborationSession',
                inviteCode,
                participantName
            });
        }
    }

    /**
     * Leave the current collaboration session
     */
    public leaveCollaborationSession() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'leaveCollaborationSession' });
        }
    }

    /**
     * Get the current session's invite code
     */
    public getSessionInviteCode(): string | undefined {
        return this._collaborationState.inviteCode;
    }

    /**
     * Show session info
     */
    public showSessionInfo() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'showSessionInfo' });
        }
    }

    /**
     * Check if collaboration is active
     */
    public isCollaborationActive(): boolean {
        return this._collaborationState.active;
    }

    // Collaboration message handlers

    private _handleSessionCreated(message: any) {
        this._collaborationState = {
            active: true,
            participantCount: 1,
            sessionId: message.sessionId,
            inviteCode: message.inviteCode
        };
        this._onCollaborationStateChange.fire(this._collaborationState);
        vscode.window.showInformationMessage(
            `Collaboration session created! Invite code: ${message.inviteCode}`
        );
    }

    private _handleSessionJoined(message: any) {
        this._collaborationState = {
            active: true,
            participantCount: message.participantCount || 1,
            sessionId: message.sessionId,
            inviteCode: message.inviteCode
        };
        this._onCollaborationStateChange.fire(this._collaborationState);
        vscode.window.showInformationMessage(
            `Joined collaboration session: ${message.sessionName || 'Session'}`
        );
    }

    private _handleSessionLeft() {
        this._collaborationState = { active: false, participantCount: 0 };
        this._onCollaborationStateChange.fire(this._collaborationState);
    }

    private _handleParticipantJoined(message: any) {
        this._collaborationState.participantCount = message.participantCount || (this._collaborationState.participantCount + 1);
        this._onCollaborationStateChange.fire(this._collaborationState);
        vscode.window.showInformationMessage(`${message.name || 'Someone'} joined the session`);
    }

    private _handleParticipantLeft(message: any) {
        this._collaborationState.participantCount = message.participantCount || Math.max(0, this._collaborationState.participantCount - 1);
        this._onCollaborationStateChange.fire(this._collaborationState);
        vscode.window.showInformationMessage(`${message.name || 'Someone'} left the session`);
    }

    private _handleCollaborationStateUpdate(message: any) {
        this._collaborationState = {
            active: message.active,
            participantCount: message.participantCount,
            sessionId: message.sessionId,
            inviteCode: message.inviteCode
        };
        this._onCollaborationStateChange.fire(this._collaborationState);
    }

    /**
     * Open generated code in a new editor tab
     */
    private async _openGeneratedCodeInEditor(code: string, language: string) {
        const ext = language === 'python' ? 'py' : (language === 'typescript' ? 'ts' : 'js');
        const languageId = language === 'python' ? 'python' : (language === 'typescript' ? 'typescript' : 'javascript');

        // Create a new untitled document with the code
        const doc = await vscode.workspace.openTextDocument({
            content: code,
            language: languageId
        });

        await vscode.window.showTextDocument(doc, {
            preview: false,
            viewColumn: vscode.ViewColumn.One
        });

        vscode.window.showInformationMessage(`Generated ${language} test code opened in editor`);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const config = vscode.workspace.getConfiguration('playwrightAssistant');
        const relayServerUrl = config.get<string>('relayServerUrl', 'ws://localhost:8765');
        const screenshotInterval = config.get<number>('screenshotInterval', 200);
        const vncUrl = config.get<string>('vncUrl', 'ws://localhost:6080/websockify');

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'playwright', 'viewer.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'playwright', 'viewer.js')
        );
        const voiceControlUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'playwright', 'voice-control.js')
        );
        const annotationUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'playwright', 'annotation.js')
        );
        const codeGenerationUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'playwright', 'code-generation.js')
        );
        const collaborationUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'playwright', 'collaboration.js')
        );

        const nonce = getNonce();

        // Read the HTML template
        const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'playwright', 'viewer.html');
        let htmlTemplate = '';

        try {
            htmlTemplate = fs.readFileSync(htmlPath, 'utf8');
        } catch (e) {
            // Fallback to inline HTML if template not found
            return this._getFallbackHtml(webview, nonce, styleUri, scriptUri, relayServerUrl, screenshotInterval, vncUrl);
        }

        // Inject CSP, styles, scripts, and config
        const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; connect-src ws://localhost:* wss://localhost:* http://localhost:* https://localhost:*;`;

        // Replace placeholders in template
        htmlTemplate = htmlTemplate
            .replace('</head>', `
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link href="${styleUri}" rel="stylesheet">
</head>`)
            .replace('</body>', `
    <script nonce="${nonce}">
        const CONFIG = {
            relayServerUrl: "${relayServerUrl}",
            screenshotInterval: ${screenshotInterval},
            vncUrl: "${vncUrl}",
            enableHoverTracking: false
        };
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
    <script nonce="${nonce}" src="${voiceControlUri}"></script>
    <script nonce="${nonce}" src="${annotationUri}"></script>
    <script nonce="${nonce}" src="${codeGenerationUri}"></script>
    <script nonce="${nonce}" src="${collaborationUri}"></script>
</body>`);

        return htmlTemplate;
    }

    private _getFallbackHtml(
        webview: vscode.Webview,
        nonce: string,
        styleUri: vscode.Uri,
        scriptUri: vscode.Uri,
        relayServerUrl: string,
        screenshotInterval: number,
        vncUrl: string
    ): string {
        const voiceControlUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'playwright', 'voice-control.js')
        );
        const annotationUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'playwright', 'annotation.js')
        );
        const codeGenerationUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'playwright', 'code-generation.js')
        );
        const collaborationUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'playwright', 'collaboration.js')
        );
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; connect-src ws://localhost:* wss://localhost:* http://localhost:* https://localhost:*;">
    <link href="${styleUri}" rel="stylesheet">
    <title>Playwright Viewer</title>
</head>
<body>
    <div id="container">
        <div id="status-bar">
            <span id="connection-status" class="disconnected">Disconnected</span>
            <div id="status-actions">
                <button id="reconnect-btn" title="Reconnect">Reconnect</button>
                <button id="mode-toggle" title="Toggle VNC/Screenshot mode">VNC Mode</button>
            </div>
        </div>
        <div id="tab-bar">
            <div id="tabs-container"></div>
            <button id="new-tab-btn" title="New Tab">+</button>
        </div>
        <div id="toolbar">
            <div id="nav-controls">
                <button id="back-btn" title="Back">&#8592;</button>
                <button id="forward-btn" title="Forward">&#8594;</button>
                <button id="reload-btn" title="Reload">&#8635;</button>
            </div>
            <input type="text" id="url-bar" placeholder="Enter URL..." />
            <div id="tool-controls">
                <button id="voice-control-btn" class="tool-btn" title="Toggle voice control (Ctrl+Shift+V)" disabled>
                    <svg class="mic-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                    </svg>
                    <span id="voice-btn-indicator"></span>
                </button>
                <span id="voice-status"></span>
                <span class="toolbar-separator"></span>
                <button id="annotate-btn" title="Annotation Mode" class="tool-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                    </svg>
                </button>
                <button id="inspector-btn" title="Inspector Mode" class="tool-btn">I</button>
                <button id="record-btn" title="Record Session" class="tool-btn">R</button>
            </div>
        </div>
        <!-- Annotation Toolbar -->
        <div id="annotation-toolbar" class="hidden">
            <!-- Drawing Tools -->
            <button class="anno-tool active" data-tool="pen" title="Pen (P)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                    <path d="M2 2l7.586 7.586"/>
                    <circle cx="11" cy="11" r="2"/>
                </svg>
            </button>
            <button class="anno-tool" data-tool="highlighter" title="Highlighter (H)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 11l-6 6v3h9l3-3"/>
                    <path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
                </svg>
            </button>
            <button class="anno-tool" data-tool="arrow" title="Arrow (A)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                </svg>
            </button>
            <button class="anno-tool" data-tool="rectangle" title="Rectangle (R)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                </svg>
            </button>
            <button class="anno-tool" data-tool="circle" title="Circle (C)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                </svg>
            </button>
            <button class="anno-tool" data-tool="text" title="Text (T)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="4 7 4 4 20 4 20 7"/>
                    <line x1="9" y1="20" x2="15" y2="20"/>
                    <line x1="12" y1="4" x2="12" y2="20"/>
                </svg>
            </button>
            <button class="anno-tool" data-tool="eraser" title="Eraser (E)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L13.4 2.8c.8-.8 2-.8 2.8 0L21 7.7c.8.8.8 2 0 2.8L12.8 18.6"/>
                </svg>
            </button>

            <span class="anno-separator"></span>

            <!-- Color Presets -->
            <div class="anno-color-presets">
                <button class="anno-color-preset active" data-color="#ff0000" style="background-color: #ff0000" title="Red"></button>
                <button class="anno-color-preset" data-color="#00ff00" style="background-color: #00ff00" title="Green"></button>
                <button class="anno-color-preset" data-color="#0000ff" style="background-color: #0000ff" title="Blue"></button>
                <button class="anno-color-preset" data-color="#ffff00" style="background-color: #ffff00" title="Yellow"></button>
                <button class="anno-color-preset" data-color="#ff00ff" style="background-color: #ff00ff" title="Magenta"></button>
                <button class="anno-color-preset" data-color="#ffffff" style="background-color: #ffffff" title="White"></button>
            </div>
            <input type="color" id="anno-color" value="#ff0000" title="Custom Color">

            <span class="anno-separator"></span>

            <!-- Stroke Width -->
            <select id="anno-stroke" title="Stroke Width">
                <option value="1">1px</option>
                <option value="2">2px</option>
                <option value="3" selected>3px</option>
                <option value="5">5px</option>
                <option value="8">8px</option>
            </select>

            <span class="anno-separator"></span>

            <!-- Action Buttons -->
            <button id="anno-undo" title="Undo (Ctrl+Z)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 7v6h6"/>
                    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
                </svg>
            </button>
            <button id="anno-redo" title="Redo (Ctrl+Y)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 7v6h-6"/>
                    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>
                </svg>
            </button>
            <button id="anno-clear" title="Clear All">Clear</button>

            <span class="anno-separator"></span>

            <!-- Send to Chat -->
            <button id="anno-send" title="Send to Chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
                Send to Chat
            </button>
        </div>
        <div id="viewer-wrapper">
            <img id="screenshot" alt="Browser screenshot" />
            <div id="click-overlay"></div>
            <canvas id="annotation-canvas"></canvas>
            <div id="vnc-container" class="hidden"></div>
            <div id="inspector-overlay" class="hidden">
                <div id="inspector-highlight"></div>
                <div id="inspector-tooltip">
                    <div id="inspector-tag"></div>
                    <div id="inspector-selector"></div>
                    <button id="inspector-copy">Copy</button>
                </div>
            </div>
            <div id="remote-cursors"></div>
            <div id="loading">
                <div class="spinner"></div>
                <span>Connecting to Playwright...</span>
            </div>
            <div id="recording-indicator" class="hidden">
                <span class="recording-dot"></span>
                <span>Recording</span>
            </div>
            <div id="voice-indicator" class="hidden">
                <div class="voice-wave">
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
                <span id="voice-text">Listening...</span>
            </div>
            <!-- Voice UI Elements -->
            <div id="voice-transcript-container">
                <div id="voice-transcript"></div>
                <div id="voice-command"></div>
            </div>
            <div id="voice-feedback-container">
                <div id="voice-feedback"></div>
            </div>
            <div id="listening-overlay"></div>
            <!-- Voice Help Modal -->
            <div id="voice-help">
                <button id="voice-help-close">&times;</button>
                <h3>Voice Commands</h3>
                <ul>
                    <li><strong>"Click [element]"</strong> <span>Click on an element</span></li>
                    <li><strong>"Type [text]"</strong> <span>Type text</span></li>
                    <li><strong>"Go to [URL]"</strong> <span>Navigate to URL</span></li>
                    <li><strong>"Scroll [up/down]"</strong> <span>Scroll the page</span></li>
                    <li><strong>"Go back"</strong> <span>Navigate back</span></li>
                    <li><strong>"Go forward"</strong> <span>Navigate forward</span></li>
                    <li><strong>"Refresh"</strong> <span>Reload the page</span></li>
                    <li><strong>"Take screenshot"</strong> <span>Capture screenshot</span></li>
                    <li><strong>"Search for [text]"</strong> <span>Find on page</span></li>
                    <li><strong>"Stop"</strong> <span>Stop listening</span></li>
                </ul>
            </div>
        </div>
        <div id="controls">
            <input type="text" id="type-input" placeholder="Type text and press Enter..." />
        </div>
        <div id="collab-panel" class="hidden"></div>
        <!-- Tab Context Menu -->
        <div id="tab-context-menu">
            <div class="context-menu-item" data-action="reload">Reload</div>
            <div class="context-menu-item" data-action="duplicate">Duplicate</div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="close">Close</div>
            <div class="context-menu-item" data-action="close-others">Close Others</div>
            <div class="context-menu-item" data-action="close-right">Close Tabs to Right</div>
        </div>
    </div>
    <script nonce="${nonce}">
        const CONFIG = {
            relayServerUrl: "${relayServerUrl}",
            screenshotInterval: ${screenshotInterval},
            vncUrl: "${vncUrl}",
            enableHoverTracking: false
        };
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
    <script nonce="${nonce}" src="${voiceControlUri}"></script>
    <script nonce="${nonce}" src="${annotationUri}"></script>
    <script nonce="${nonce}" src="${codeGenerationUri}"></script>
    <script nonce="${nonce}" src="${collaborationUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
