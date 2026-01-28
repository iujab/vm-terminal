import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { ClaudeClient, BrowserContext, ConversationMessage } from './claude-client';
import {
    ControlCoordinator,
    createControlCoordinator,
    ControlSource,
    ControlMode,
    ControlState,
    QueuedAction,
    ActionResult
} from './control-coordinator';
import {
    PlaywrightMCPClient as RealMCPClient,
    ClickOptions,
    TypeOptions,
    NavigateOptions,
    ScrollOptions,
    SnapshotResult
} from './mcp-client';
import {
    VoiceCommandHandler,
    voiceCommandHandler,
    VoiceCommand,
    VoiceCommandResult,
    parseVoiceCommand,
    AccessibilityNode
} from './voice-commands';
import {
    SessionRecorder,
    createRecorder,
    RecordingInfo,
    RecordedAction as SessionRecordedAction,
    PlaybackEvent,
    RecordingEvent
} from './session-recorder';
import {
    CodeGenerator,
    RecordedAction as CodeGenAction,
    CodeFormat,
    CodeLanguage
} from './code-generator';
import * as path from 'path';

// Configuration
const PLAYWRIGHT_WS_PORT = parseInt(process.env.PLAYWRIGHT_WS_PORT || '8765');
const CHAT_HTTP_PORT = parseInt(process.env.CHAT_HTTP_PORT || '8766');
const SCREENSHOT_INTERVAL = parseInt(process.env.SCREENSHOT_INTERVAL || '200'); // ms
const MCP_CONNECTION_RETRY_DELAY = 5000; // ms
const MCP_MAX_RETRIES = 10;
const USE_REAL_MCP = process.env.USE_REAL_MCP !== 'false'; // Enable by default
const RECORDINGS_DIR = path.join(__dirname, 'recordings');

interface PlaywrightAction {
    type: 'click' | 'scroll' | 'type' | 'getScreenshot' | 'getSnapshot' | 'dblclick' | 'hover' | 'press' | 'navigate' | 'reload' | 'back' | 'forward' | 'newTab' | 'closeTab' | 'voiceCommand' | 'findElement' |
          'startRecording' | 'stopRecording' | 'listRecordings' | 'deleteRecording' |
          'playRecording' | 'pausePlayback' | 'resumePlayback' | 'stopPlayback' |
          'setPlaybackSpeed' | 'stepForward' | 'exportRecording' | 'getRecordingStatus' |
          'generateCode' | 'generateCodeFromActions';
    x?: number;
    y?: number;
    deltaX?: number;
    deltaY?: number;
    text?: string;
    key?: string;
    url?: string;
    ref?: string;
    element?: string;
    source?: ControlSource;
    // Voice command specific
    action?: string;
    target?: string;
    value?: string;
    needsInterpretation?: boolean;
    description?: string;
    // Recording specific
    name?: string;
    recordingId?: string;
    speed?: number;
    format?: 'json' | 'playwright' | 'puppeteer' | 'cypress';
    // Code generation specific
    codeFormat?: CodeFormat;
    codeLanguage?: CodeLanguage;
    actions?: CodeGenAction[];
    startUrl?: string;
    includeComments?: boolean;
    includeWaits?: boolean;
    useLocators?: boolean;
}

interface PlaywrightResponse {
    type: 'screenshot' | 'snapshot' | 'actionResult' | 'error' | 'controlState' | 'controlGrant' | 'actionQueued' | 'actionComplete' | 'voiceCommandResult' | 'elementFound' |
          'recordingStatus' | 'recordingsList' | 'recordingEvent' | 'playbackEvent' | 'exportResult' | 'generatedCode';
    image?: string;
    content?: string;
    message?: string;
    success?: boolean;
    state?: ControlState;
    to?: ControlSource;
    actionId?: string;
    queued?: boolean;
    // Voice command result
    action?: string;
    interpretation?: string;
    speak?: string;
    // Element found
    found?: boolean;
    element?: string;
    description?: string;
    suggestions?: string[];
    boundingBox?: { x: number; y: number; width: number; height: number };
    // Recording specific
    isRecording?: boolean;
    isPlaying?: boolean;
    isPaused?: boolean;
    recordingId?: string;
    recordingName?: string;
    recordings?: RecordingInfo[];
    playbackProgress?: number;
    currentAction?: number;
    totalActions?: number;
    exportedCode?: string;
    exportFormat?: string;
    // Code generation result
    generatedCode?: string;
    codeLanguage?: string;
    codeFormat?: string;
    filename?: string;
}

interface ControlMessage {
    type: 'controlRequest' | 'controlRelease' | 'setControlMode' | 'getControlState' | 'cancelAction';
    source?: ControlSource;
    mode?: ControlMode;
    timeout?: number;
    actionId?: string;
}

interface ChatRequest {
    message: string;
    context?: BrowserContext;
    stream?: boolean;
    clearHistory?: boolean;
}

interface ClientInfo {
    ws: WebSocket;
    source: ControlSource;
    connectedAt: number;
}

/**
 * MCP Client Manager that wraps the real MCP client with connection management,
 * caching, and fallback behavior
 */
class MCPClientManager {
    private mcpClient: RealMCPClient | null = null;
    private connected = false;
    private connecting = false;
    private retryCount = 0;
    private lastScreenshot: string | null = null;
    private lastSnapshot: SnapshotResult | null = null;
    private currentUrl: string | null = null;
    private currentTitle: string | null = null;
    private onConnectionChange?: (connected: boolean) => void;

    constructor() {
        if (USE_REAL_MCP) {
            this.mcpClient = new RealMCPClient();
            this.setupEventHandlers();
        }
    }

    private setupEventHandlers() {
        if (!this.mcpClient) return;

        this.mcpClient.on('connected', () => {
            console.log('[MCPManager] Connected to MCP server');
            this.connected = true;
            this.connecting = false;
            this.retryCount = 0;
            this.onConnectionChange?.(true);
        });

        this.mcpClient.on('disconnected', (code) => {
            console.log('[MCPManager] Disconnected from MCP server, code:', code);
            this.connected = false;
            this.connecting = false;
            this.onConnectionChange?.(false);
            this.scheduleReconnect();
        });

        this.mcpClient.on('error', (error) => {
            console.error('[MCPManager] MCP error:', error);
        });
    }

    setConnectionChangeHandler(handler: (connected: boolean) => void) {
        this.onConnectionChange = handler;
    }

    private scheduleReconnect() {
        if (this.retryCount >= MCP_MAX_RETRIES) {
            console.error('[MCPManager] Max retries reached, using mock mode');
            return;
        }

        this.retryCount++;
        const delay = MCP_CONNECTION_RETRY_DELAY * Math.min(this.retryCount, 3);
        console.log(`[MCPManager] Scheduling reconnect in ${delay}ms (attempt ${this.retryCount})`);

        setTimeout(() => {
            this.connect().catch(err => {
                console.error('[MCPManager] Reconnect failed:', err.message);
            });
        }, delay);
    }

    async connect(): Promise<void> {
        if (!USE_REAL_MCP || !this.mcpClient) {
            console.log('[MCPManager] Running in mock mode (USE_REAL_MCP=false)');
            return;
        }

        if (this.connected || this.connecting) {
            return;
        }

        this.connecting = true;
        console.log('[MCPManager] Connecting to MCP server...');

        try {
            await this.mcpClient.connect();
        } catch (error) {
            this.connecting = false;
            console.error('[MCPManager] Connection failed:', error);
            this.scheduleReconnect();
            throw error;
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Take a screenshot, with fallback to cached version
     */
    async takeScreenshot(): Promise<string> {
        if (USE_REAL_MCP && this.connected && this.mcpClient) {
            try {
                const screenshot = await this.mcpClient.takeScreenshot({ type: 'png' });
                this.lastScreenshot = screenshot;
                return screenshot;
            } catch (error) {
                console.error('[MCPManager] Screenshot failed:', error);
            }
        }

        // Fallback to cached or placeholder
        if (this.lastScreenshot) {
            return this.lastScreenshot;
        }
        return this.getPlaceholderImage();
    }

    /**
     * Get accessibility snapshot
     */
    async getSnapshot(): Promise<string> {
        if (USE_REAL_MCP && this.connected && this.mcpClient) {
            try {
                const snapshot = await this.mcpClient.getSnapshot();
                this.lastSnapshot = snapshot;
                return snapshot.content;
            } catch (error) {
                console.error('[MCPManager] Snapshot failed:', error);
            }
        }

        // Fallback
        if (this.lastSnapshot) {
            return this.lastSnapshot.content;
        }
        return 'Accessibility snapshot not available (MCP not connected)';
    }

    /**
     * Click at coordinates or element reference
     */
    async click(x: number, y: number): Promise<boolean> {
        console.log(`[MCP] Click at (${x}, ${y})`);

        if (USE_REAL_MCP && this.connected && this.mcpClient) {
            try {
                return await this.mcpClient.click({ x, y });
            } catch (error) {
                console.error('[MCPManager] Click failed:', error);
                return false;
            }
        }
        return true; // Mock success
    }

    /**
     * Double-click at coordinates
     */
    async dblclick(x: number, y: number): Promise<boolean> {
        console.log(`[MCP] Double-click at (${x}, ${y})`);

        if (USE_REAL_MCP && this.connected && this.mcpClient) {
            try {
                return await this.mcpClient.click({ x, y, doubleClick: true });
            } catch (error) {
                console.error('[MCPManager] Double-click failed:', error);
                return false;
            }
        }
        return true; // Mock success
    }

    /**
     * Hover at coordinates
     */
    async hover(x: number, y: number): Promise<boolean> {
        console.log(`[MCP] Hover at (${x}, ${y})`);

        // Coordinate-based hover would need different implementation
        // The MCP client uses ref-based hover
        if (USE_REAL_MCP && this.connected && this.mcpClient) {
            // For now, just log - real hover needs element ref
            console.log('[MCPManager] Coordinate hover not directly supported, skipping');
        }
        return true;
    }

    /**
     * Scroll the page
     */
    async scroll(deltaX: number, deltaY: number): Promise<boolean> {
        console.log(`[MCP] Scroll by (${deltaX}, ${deltaY})`);

        if (USE_REAL_MCP && this.connected && this.mcpClient) {
            try {
                return await this.mcpClient.scroll({ deltaX, deltaY });
            } catch (error) {
                console.error('[MCPManager] Scroll failed:', error);
                return false;
            }
        }
        return true; // Mock success
    }

    /**
     * Type text
     */
    async type(text: string): Promise<boolean> {
        console.log(`[MCP] Type: ${text}`);

        if (USE_REAL_MCP && this.connected && this.mcpClient) {
            try {
                return await this.mcpClient.type({ text });
            } catch (error) {
                console.error('[MCPManager] Type failed:', error);
                return false;
            }
        }
        return true; // Mock success
    }

    /**
     * Press a key
     */
    async press(key: string): Promise<boolean> {
        console.log(`[MCP] Press key: ${key}`);

        if (USE_REAL_MCP && this.connected && this.mcpClient) {
            try {
                return await this.mcpClient.pressKey(key);
            } catch (error) {
                console.error('[MCPManager] Press key failed:', error);
                return false;
            }
        }
        return true; // Mock success
    }

    /**
     * Navigate to URL
     */
    async navigate(url: string): Promise<boolean> {
        console.log(`[MCP] Navigate to: ${url}`);

        if (USE_REAL_MCP && this.connected && this.mcpClient) {
            try {
                const result = await this.mcpClient.navigate({ url });
                if (result) {
                    this.currentUrl = url;
                }
                return result;
            } catch (error) {
                console.error('[MCPManager] Navigate failed:', error);
                return false;
            }
        }
        this.currentUrl = url; // Mock
        return true;
    }

    /**
     * Reload the page
     */
    async reload(): Promise<boolean> {
        console.log(`[MCP] Reload page`);

        if (USE_REAL_MCP && this.connected && this.mcpClient) {
            try {
                return await this.mcpClient.pressKey('F5');
            } catch (error) {
                console.error('[MCPManager] Reload failed:', error);
                return false;
            }
        }
        return true; // Mock success
    }

    /**
     * Go back in history
     */
    async back(): Promise<boolean> {
        console.log(`[MCP] Go back`);

        if (USE_REAL_MCP && this.connected && this.mcpClient) {
            try {
                return await this.mcpClient.navigateBack();
            } catch (error) {
                console.error('[MCPManager] Back failed:', error);
                return false;
            }
        }
        return true; // Mock success
    }

    /**
     * Get browser context for Claude API
     */
    getBrowserContext(): BrowserContext {
        return {
            url: this.currentUrl || undefined,
            title: this.currentTitle || undefined,
            snapshot: this.lastSnapshot?.content || undefined
        };
    }

    /**
     * Get a placeholder image for when not connected
     */
    private getPlaceholderImage(): string {
        // 1x1 transparent PNG
        return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    }

    /**
     * Update screenshot from external source
     */
    setScreenshot(base64Image: string) {
        this.lastScreenshot = base64Image;
    }

    /**
     * Update snapshot from external source
     */
    setSnapshot(snapshot: string) {
        this.lastSnapshot = { content: snapshot };
    }

    /**
     * Update page info
     */
    setPageInfo(url: string, title: string) {
        this.currentUrl = url;
        this.currentTitle = title;
    }

    async disconnect(): Promise<void> {
        if (this.mcpClient) {
            await this.mcpClient.disconnect();
        }
    }
}

// Alias for backward compatibility
const PlaywrightMCPClient = MCPClientManager;

// WebSocket relay server for Playwright with bidirectional control
class PlaywrightRelayServer {
    private wss: WebSocketServer;
    private mcpClient: MCPClientManager;
    private clients: Map<WebSocket, ClientInfo> = new Map();
    private screenshotInterval: NodeJS.Timeout | null = null;
    private controlCoordinator: ControlCoordinator;
    private recorder: SessionRecorder;

    constructor(port: number) {
        this.wss = new WebSocketServer({ port });
        this.mcpClient = new MCPClientManager();
        this.controlCoordinator = createControlCoordinator();
        this.recorder = createRecorder(RECORDINGS_DIR);

        // Set up session recorder
        this.setupSessionRecorder();

        // Set up control coordinator callbacks
        this.setupControlCoordinator();

        // Set up MCP connection change handler
        this.mcpClient.setConnectionChangeHandler((connected) => {
            this.broadcastMCPStatus(connected);
        });

        // Attempt initial MCP connection
        if (USE_REAL_MCP) {
            this.mcpClient.connect().catch(err => {
                console.warn('[Relay] Initial MCP connection failed, will retry:', err.message);
            });
        }

        this.wss.on('connection', (ws, req) => {
            // Determine source from query params or headers
            const url = new URL(req.url || '', `http://localhost:${port}`);
            const source = (url.searchParams.get('source') as ControlSource) || 'user';

            const clientInfo: ClientInfo = {
                ws,
                source,
                connectedAt: Date.now()
            };

            console.log(`Client connected to Playwright relay as ${source}`);
            this.clients.set(ws, clientInfo);

            // Send current control state
            this.sendControlState(ws);

            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    await this.handleMessage(ws, clientInfo, message);
                } catch (error) {
                    console.error('Error handling message:', error);
                    this.sendError(ws, 'Invalid message format');
                }
            });

            ws.on('close', () => {
                console.log(`Client disconnected from Playwright relay (${source})`);
                this.clients.delete(ws);

                // Release lock if this client held it
                if (this.controlCoordinator.getState().lockedBy === source) {
                    this.controlCoordinator.releaseLock(source);
                }

                if (this.clients.size === 0) {
                    this.stopScreenshotStream();
                }
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.clients.delete(ws);
            });

            // Start screenshot streaming
            this.startScreenshotStream();
        });

        console.log(`Playwright relay server running on ws://localhost:${port}`);
    }

    private setupSessionRecorder() {
        // Set up action executor for playback
        this.recorder.setActionExecutor(async (action: SessionRecordedAction) => {
            return this.executeRecordedAction(action);
        });

        // Set up recording event listener
        this.recorder.onRecordingEvent((event: RecordingEvent) => {
            this.broadcastRecordingEvent(event);
        });

        // Set up playback event listener
        this.recorder.onPlaybackEvent((event: PlaybackEvent) => {
            this.broadcastPlaybackEvent(event);
        });
    }

    private async executeRecordedAction(action: SessionRecordedAction): Promise<any> {
        // Execute action during playback
        switch (action.type) {
            case 'click':
                return this.mcpClient.click(action.params.x, action.params.y);
            case 'dblclick':
                return this.mcpClient.dblclick(action.params.x, action.params.y);
            case 'scroll':
                return this.mcpClient.scroll(action.params.deltaX || 0, action.params.deltaY || 0);
            case 'type':
                return this.mcpClient.type(action.params.text);
            case 'press':
                return this.mcpClient.press(action.params.key);
            case 'hover':
                return this.mcpClient.hover(action.params.x, action.params.y);
            case 'navigate':
                return this.mcpClient.navigate(action.params.url);
            case 'reload':
                return this.mcpClient.reload();
            case 'back':
                return this.mcpClient.back();
            default:
                console.log(`[Playback] Unknown action type: ${action.type}`);
                return null;
        }
    }

    private broadcastRecordingEvent(event: RecordingEvent): void {
        const response: PlaywrightResponse = {
            type: 'recordingEvent',
            isRecording: this.recorder.isRecording(),
            recordingId: event.recordingId,
            recordingName: event.recordingName,
            message: `Recording ${event.type}`
        };
        this.broadcast(response);
    }

    private broadcastPlaybackEvent(event: PlaybackEvent): void {
        const response: PlaywrightResponse = {
            type: 'playbackEvent',
            isPlaying: this.recorder.isPlaying(),
            isPaused: this.recorder.getPlaybackState()?.isPaused ?? false,
            recordingId: event.recordingId,
            playbackProgress: event.progress,
            currentAction: event.currentIndex,
            totalActions: event.totalActions,
            message: `Playback ${event.type}`
        };

        // If there's a screenshot to display during playback
        if (event.type === 'screenshotDisplayed' && event.screenshot) {
            this.broadcast({ type: 'screenshot', image: event.screenshot.image });
        }

        this.broadcast(response);
    }

    private sendRecordingStatus(ws: WebSocket): void {
        const playbackState = this.recorder.getPlaybackState();
        const response: PlaywrightResponse = {
            type: 'recordingStatus',
            isRecording: this.recorder.isRecording(),
            isPlaying: this.recorder.isPlaying(),
            isPaused: playbackState?.isPaused ?? false,
            recordingId: this.recorder.getCurrentRecordingId() ?? playbackState?.recording.id,
            currentAction: playbackState?.currentIndex,
            totalActions: playbackState?.recording.actions.length
        };
        this.send(ws, response);
    }

    private setupControlCoordinator() {
        // Broadcast state changes to all clients
        this.controlCoordinator.setOnStateChange((state) => {
            this.broadcastControlState(state);
        });

        // Handle action execution
        this.controlCoordinator.setOnActionExecute(async (action) => {
            return this.executeAction(action);
        });

        // Notify when actions are queued
        this.controlCoordinator.setOnActionQueued((action) => {
            this.notifyActionQueued(action);
        });
    }

    getMCPClient(): MCPClientManager {
        return this.mcpClient;
    }

    getControlCoordinator(): ControlCoordinator {
        return this.controlCoordinator;
    }

    private async handleMessage(ws: WebSocket, clientInfo: ClientInfo, message: any) {
        // Handle control messages
        if (this.isControlMessage(message)) {
            await this.handleControlMessage(ws, clientInfo, message as ControlMessage);
            return;
        }

        // Handle action messages
        const action = message as PlaywrightAction;
        const source = action.source || clientInfo.source;

        // Check if this is a read-only action (screenshot, snapshot)
        if (action.type === 'getScreenshot' || action.type === 'getSnapshot') {
            await this.handleReadOnlyAction(ws, action);
            return;
        }

        // Handle voice commands
        if (action.type === 'voiceCommand') {
            await this.handleVoiceCommand(ws, action);
            return;
        }

        // Handle element finding for voice control
        if (action.type === 'findElement') {
            await this.handleFindElement(ws, action);
            return;
        }

        // Handle recording commands
        if (this.isRecordingCommand(action.type)) {
            await this.handleRecordingCommand(ws, action);
            return;
        }

        // Handle code generation commands
        if (action.type === 'generateCode' || action.type === 'generateCodeFromActions') {
            await this.handleCodeGenerationCommand(ws, action);
            return;
        }

        // Submit action through control coordinator
        const result = this.controlCoordinator.submitAction(
            source,
            action,
            {
                priority: source === 'user' ? 'normal' : 'normal',
                callback: (actionResult) => {
                    this.send(ws, {
                        type: 'actionComplete',
                        actionId: actionResult.actionId,
                        success: actionResult.success,
                        message: actionResult.error
                    });
                }
            }
        );

        if (!result.success) {
            this.sendError(ws, result.error || 'Action rejected');
        } else if (result.queued) {
            this.send(ws, {
                type: 'actionQueued',
                actionId: result.actionId,
                queued: true
            });
        }
    }

    private isControlMessage(message: any): boolean {
        return ['controlRequest', 'controlRelease', 'setControlMode', 'getControlState', 'cancelAction'].includes(message.type);
    }

    private async handleControlMessage(ws: WebSocket, clientInfo: ClientInfo, message: ControlMessage) {
        const source = message.source || clientInfo.source;

        switch (message.type) {
            case 'controlRequest': {
                const result = this.controlCoordinator.requestLock(source, message.timeout);
                if (result.success) {
                    // Notify all clients
                    this.broadcast({
                        type: 'controlGrant',
                        to: source
                    });
                } else {
                    this.sendError(ws, result.error || 'Lock request denied');
                }
                break;
            }

            case 'controlRelease': {
                const result = this.controlCoordinator.releaseLock(source);
                if (!result.success) {
                    this.sendError(ws, result.error || 'Lock release failed');
                }
                break;
            }

            case 'setControlMode': {
                if (message.mode) {
                    const result = this.controlCoordinator.setMode(message.mode, source);
                    if (!result.success) {
                        this.sendError(ws, result.error || 'Mode change denied');
                    }
                } else {
                    this.sendError(ws, 'Mode not specified');
                }
                break;
            }

            case 'getControlState': {
                this.sendControlState(ws);
                break;
            }

            case 'cancelAction': {
                if (message.actionId) {
                    const result = this.controlCoordinator.cancelAction(message.actionId, source);
                    if (!result.success) {
                        this.sendError(ws, result.error || 'Cancel failed');
                    }
                } else {
                    this.sendError(ws, 'Action ID not specified');
                }
                break;
            }
        }
    }

    private async handleReadOnlyAction(ws: WebSocket, action: PlaywrightAction) {
        try {
            switch (action.type) {
                case 'getScreenshot': {
                    const image = await this.mcpClient.takeScreenshot();
                    this.send(ws, { type: 'screenshot', image });
                    break;
                }
                case 'getSnapshot': {
                    const content = await this.mcpClient.getSnapshot();
                    this.send(ws, { type: 'snapshot', content });
                    break;
                }
            }
        } catch (error) {
            this.sendError(ws, `Read action failed: ${error}`);
        }
    }

    /**
     * Handle voice commands from the frontend
     */
    private async handleVoiceCommand(ws: WebSocket, action: PlaywrightAction) {
        try {
            const snapshotContent = await this.mcpClient.getSnapshot();
            this.updateVoiceSnapshot(snapshotContent);

            const voiceCmd: VoiceCommand = {
                type: 'voiceCommand',
                text: action.text,
                action: action.action,
                target: action.target,
                value: action.value,
                needsInterpretation: action.needsInterpretation
            };

            const result = await voiceCommandHandler.processCommand(
                voiceCmd,
                (browserAction) => this.executeVoiceAction(browserAction)
            );

            this.send(ws, {
                type: 'voiceCommandResult',
                success: result.success,
                action: result.action,
                message: result.message,
                interpretation: result.interpretation,
                speak: result.speak
            });
        } catch (error) {
            console.error('[Relay] Voice command error:', error);
            this.send(ws, {
                type: 'voiceCommandResult',
                success: false,
                action: 'error',
                message: error instanceof Error ? error.message : 'Voice command failed'
            });
        }
    }

    /**
     * Handle element finding requests
     */
    private async handleFindElement(ws: WebSocket, action: PlaywrightAction) {
        try {
            if (!action.description) {
                this.send(ws, { type: 'elementFound', found: false, description: '' });
                return;
            }
            const snapshotContent = await this.mcpClient.getSnapshot();
            this.updateVoiceSnapshot(snapshotContent);
            const result = voiceCommandHandler.findElement(action.description);
            this.send(ws, result as any);
        } catch (error) {
            console.error('[Relay] Find element error:', error);
            this.send(ws, { type: 'elementFound', found: false, description: action.description || '' });
        }
    }

    /**
     * Update voice command handler's accessibility snapshot
     */
    private updateVoiceSnapshot(snapshotContent: string) {
        try {
            const lines = snapshotContent.split('\n');
            const nodes: AccessibilityNode[] = [];
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const refMatch = trimmed.match(/^\[([^\]]+)\]\s*(.+)$/);
                const ref = refMatch ? refMatch[1] : undefined;
                const content = refMatch ? refMatch[2] : trimmed;
                const roleMatch = content.match(/^(\w+):\s*"?([^"]*)"?$/);
                if (roleMatch) {
                    nodes.push({ role: roleMatch[1], name: roleMatch[2], ref });
                } else {
                    nodes.push({ role: 'text', name: content, ref });
                }
            }
            voiceCommandHandler.updateSnapshot(nodes);
        } catch (error) {
            voiceCommandHandler.updateSnapshot([{ role: 'document', name: snapshotContent }]);
        }
    }

    /**
     * Execute voice command browser action
     */
    private async executeVoiceAction(action: any) {
        try {
            switch (action.type) {
                case 'click':
                    if (action.x !== undefined && action.y !== undefined) {
                        await this.mcpClient.click(action.x, action.y);
                    }
                    break;
                case 'type':
                    if (action.text) await this.mcpClient.type(action.text);
                    break;
                case 'navigate':
                    if (action.url) await this.mcpClient.navigate(action.url);
                    break;
                case 'scroll':
                    await this.mcpClient.scroll(action.deltaX || 0, action.deltaY || 0);
                    break;
                case 'back':
                    await this.mcpClient.back();
                    break;
                case 'forward':
                    await this.mcpClient.press('Alt+Right');
                    break;
                case 'reload':
                    await this.mcpClient.reload();
                    break;
                case 'press':
                    if (action.key) await this.mcpClient.press(action.key);
                    break;
                case 'newTab':
                    await this.mcpClient.press('Control+t');
                    break;
                case 'closeTab':
                    await this.mcpClient.press('Control+w');
                    break;
                case 'screenshot':
                    const image = await this.mcpClient.takeScreenshot();
                    this.broadcast({ type: 'screenshot', image });
                    break;
            }
        } catch (error) {
            console.error('[Voice] Action error:', error);
        }
    }

    private isRecordingCommand(type: string): boolean {
        return [
            'startRecording', 'stopRecording', 'listRecordings', 'deleteRecording',
            'playRecording', 'pausePlayback', 'resumePlayback', 'stopPlayback',
            'setPlaybackSpeed', 'stepForward', 'exportRecording', 'getRecordingStatus'
        ].includes(type);
    }

    private async handleRecordingCommand(ws: WebSocket, action: PlaywrightAction) {
        let response: PlaywrightResponse;

        try {
            switch (action.type) {
                case 'startRecording': {
                    const currentUrl = this.mcpClient.getBrowserContext().url || '';
                    const recordingId = this.recorder.startRecording(
                        action.name || `Recording ${Date.now()}`,
                        currentUrl
                    );
                    response = {
                        type: 'recordingStatus',
                        success: true,
                        isRecording: true,
                        recordingId,
                        message: 'Recording started'
                    };
                    break;
                }

                case 'stopRecording': {
                    const recording = this.recorder.stopRecording();
                    response = {
                        type: 'recordingStatus',
                        success: !!recording,
                        isRecording: false,
                        recordingId: recording?.id,
                        message: recording ? 'Recording stopped' : 'No recording in progress'
                    };
                    break;
                }

                case 'listRecordings': {
                    const recordings = this.recorder.listRecordings();
                    response = {
                        type: 'recordingsList',
                        recordings
                    };
                    break;
                }

                case 'deleteRecording': {
                    if (action.recordingId) {
                        const deleted = this.recorder.deleteRecording(action.recordingId);
                        response = {
                            type: 'actionResult',
                            success: deleted,
                            message: deleted ? 'Recording deleted' : 'Recording not found'
                        };
                    } else {
                        response = { type: 'error', message: 'Missing recordingId' };
                    }
                    break;
                }

                case 'playRecording': {
                    if (action.recordingId) {
                        const started = await this.recorder.startPlayback(
                            action.recordingId,
                            action.speed || 1
                        );
                        response = {
                            type: 'playbackEvent',
                            success: started,
                            isPlaying: started,
                            recordingId: action.recordingId,
                            message: started ? 'Playback started' : 'Failed to start playback'
                        };
                    } else {
                        response = { type: 'error', message: 'Missing recordingId' };
                    }
                    break;
                }

                case 'pausePlayback': {
                    const paused = this.recorder.pausePlayback();
                    response = {
                        type: 'playbackEvent',
                        success: paused,
                        isPlaying: true,
                        isPaused: true,
                        message: paused ? 'Playback paused' : 'No playback to pause'
                    };
                    break;
                }

                case 'resumePlayback': {
                    const resumed = this.recorder.resumePlayback();
                    response = {
                        type: 'playbackEvent',
                        success: resumed,
                        isPlaying: true,
                        isPaused: false,
                        message: resumed ? 'Playback resumed' : 'No paused playback to resume'
                    };
                    break;
                }

                case 'stopPlayback': {
                    const stopped = this.recorder.stopPlayback();
                    response = {
                        type: 'playbackEvent',
                        success: stopped,
                        isPlaying: false,
                        message: stopped ? 'Playback stopped' : 'No playback to stop'
                    };
                    break;
                }

                case 'setPlaybackSpeed': {
                    const speedSet = this.recorder.setPlaybackSpeed(action.speed || 1);
                    response = {
                        type: 'actionResult',
                        success: speedSet,
                        message: speedSet ? `Speed set to ${action.speed}x` : 'No active playback'
                    };
                    break;
                }

                case 'stepForward': {
                    const stepped = this.recorder.stepForward();
                    response = {
                        type: 'actionResult',
                        success: stepped,
                        message: stepped ? 'Stepped forward' : 'Cannot step (not paused or no playback)'
                    };
                    break;
                }

                case 'exportRecording': {
                    if (action.recordingId && action.format) {
                        const exported = this.recorder.exportRecording(action.recordingId, action.format);
                        response = {
                            type: 'exportResult',
                            success: !!exported,
                            exportedCode: exported || undefined,
                            exportFormat: action.format,
                            message: exported ? 'Export successful' : 'Export failed'
                        };
                    } else {
                        response = { type: 'error', message: 'Missing recordingId or format' };
                    }
                    break;
                }

                case 'getRecordingStatus': {
                    this.sendRecordingStatus(ws);
                    return;
                }

                default:
                    response = { type: 'error', message: `Unknown recording command: ${action.type}` };
            }

            this.send(ws, response);
        } catch (error) {
            console.error('Error handling recording command:', error);
            this.sendError(ws, `Recording command failed: ${error}`);
        }
    }

    /**
     * Handle code generation commands
     */
    private async handleCodeGenerationCommand(ws: WebSocket, action: PlaywrightAction) {
        try {
            const codeGenerator = new CodeGenerator({
                format: action.codeFormat || 'playwright',
                language: action.codeLanguage || 'typescript',
                includeComments: action.includeComments ?? true,
                includeWaits: action.includeWaits ?? true,
                useLocators: action.useLocators ?? true
            });

            let generatedCode: { code: string; language: CodeLanguage; format: CodeFormat; filename: string };

            if (action.type === 'generateCode' && action.recordingId) {
                // Generate code from a recording
                const recording = this.recorder.loadRecording(action.recordingId);
                if (!recording) {
                    this.sendError(ws, `Recording not found: ${action.recordingId}`);
                    return;
                }

                // Convert recorded actions to code generator format
                const codeGenActions = this.convertRecordedActionsToCodeGenFormat(recording.actions);
                generatedCode = codeGenerator.generateFromActions(codeGenActions, recording.startUrl);

            } else if (action.type === 'generateCodeFromActions' && action.actions) {
                // Generate code from provided actions
                generatedCode = codeGenerator.generateFromActions(action.actions, action.startUrl);
            } else {
                this.sendError(ws, 'Missing recordingId or actions for code generation');
                return;
            }

            const response: PlaywrightResponse = {
                type: 'generatedCode',
                success: true,
                generatedCode: generatedCode.code,
                codeLanguage: generatedCode.language,
                codeFormat: generatedCode.format,
                filename: generatedCode.filename,
                message: 'Code generated successfully'
            };

            this.send(ws, response);
        } catch (error) {
            console.error('Error generating code:', error);
            this.sendError(ws, `Code generation failed: ${error}`);
        }
    }

    /**
     * Convert recorded actions from session recorder format to code generator format
     */
    private convertRecordedActionsToCodeGenFormat(actions: SessionRecordedAction[]): CodeGenAction[] {
        return actions.map(action => ({
            id: action.id,
            type: action.type as any,
            timestamp: action.timestamp,
            url: action.params?.url,
            x: action.params?.x,
            y: action.params?.y,
            deltaX: action.params?.deltaX,
            deltaY: action.params?.deltaY,
            text: action.params?.text,
            key: action.params?.key,
            element: action.params?.element
        }));
    }

    private async executeAction(queuedAction: QueuedAction): Promise<ActionResult> {
        const action = queuedAction.action as PlaywrightAction;

        try {
            let success = false;
            let recordedAction: SessionRecordedAction | null = null;
            const shouldTakeScreenshot = ['click', 'dblclick', 'type', 'navigate', 'reload', 'back'].includes(action.type);

            switch (action.type) {
                case 'click':
                    if (action.x !== undefined && action.y !== undefined) {
                        success = await this.mcpClient.click(action.x, action.y);
                        if (this.recorder.isRecording()) {
                            recordedAction = this.recorder.recordAction('click', { x: action.x, y: action.y }, { success });
                        }
                    } else {
                        return { success: false, actionId: queuedAction.id, error: 'Missing coordinates' };
                    }
                    break;

                case 'dblclick':
                    if (action.x !== undefined && action.y !== undefined) {
                        success = await this.mcpClient.dblclick(action.x, action.y);
                        if (this.recorder.isRecording()) {
                            recordedAction = this.recorder.recordAction('dblclick', { x: action.x, y: action.y }, { success });
                        }
                    } else {
                        return { success: false, actionId: queuedAction.id, error: 'Missing coordinates' };
                    }
                    break;

                case 'hover':
                    if (action.x !== undefined && action.y !== undefined) {
                        success = await this.mcpClient.hover(action.x, action.y);
                        // Don't record hover to avoid noise
                    } else {
                        return { success: false, actionId: queuedAction.id, error: 'Missing coordinates' };
                    }
                    break;

                case 'scroll':
                    success = await this.mcpClient.scroll(action.deltaX ?? 0, action.deltaY ?? 0);
                    if (this.recorder.isRecording()) {
                        this.recorder.recordAction('scroll', { deltaX: action.deltaX ?? 0, deltaY: action.deltaY ?? 0 }, { success });
                    }
                    break;

                case 'type':
                    if (action.text) {
                        success = await this.mcpClient.type(action.text);
                        if (this.recorder.isRecording()) {
                            recordedAction = this.recorder.recordAction('type', { text: action.text }, { success });
                        }
                    } else {
                        return { success: false, actionId: queuedAction.id, error: 'Missing text' };
                    }
                    break;

                case 'press':
                    if (action.key) {
                        success = await this.mcpClient.press(action.key);
                        if (this.recorder.isRecording()) {
                            this.recorder.recordAction('press', { key: action.key }, { success });
                        }
                    } else {
                        return { success: false, actionId: queuedAction.id, error: 'Missing key' };
                    }
                    break;

                case 'navigate':
                    if (action.url) {
                        success = await this.mcpClient.navigate(action.url);
                        if (this.recorder.isRecording()) {
                            recordedAction = this.recorder.recordAction('navigate', { url: action.url }, { success });
                        }
                    } else {
                        return { success: false, actionId: queuedAction.id, error: 'Missing URL' };
                    }
                    break;

                case 'reload':
                    success = await this.mcpClient.reload();
                    if (this.recorder.isRecording()) {
                        recordedAction = this.recorder.recordAction('reload', {}, { success });
                    }
                    break;

                case 'back':
                    success = await this.mcpClient.back();
                    if (this.recorder.isRecording()) {
                        recordedAction = this.recorder.recordAction('back', {}, { success });
                    }
                    break;

                default:
                    return { success: false, actionId: queuedAction.id, error: `Unknown action: ${action.type}` };
            }

            // Take screenshot after key actions if recording
            if (this.recorder.isRecording() && recordedAction && shouldTakeScreenshot) {
                setTimeout(async () => {
                    try {
                        const screenshot = await this.mcpClient.takeScreenshot();
                        this.recorder.recordScreenshot(screenshot, recordedAction?.id);
                    } catch (e) {
                        console.error('[Recorder] Failed to capture screenshot:', e);
                    }
                }, action.type === 'navigate' ? 500 : 100);
            }

            // Broadcast action result to all clients
            this.broadcast({
                type: 'actionResult',
                success,
                message: `${action.type} by ${queuedAction.source}`
            });

            return { success, actionId: queuedAction.id };
        } catch (error) {
            return {
                success: false,
                actionId: queuedAction.id,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private notifyActionQueued(action: QueuedAction) {
        // Notify the source client that their action is queued
        for (const [ws, info] of this.clients) {
            if (info.source === action.source) {
                this.send(ws, {
                    type: 'actionQueued',
                    actionId: action.id,
                    queued: true
                });
            }
        }
    }

    private sendControlState(ws: WebSocket) {
        this.send(ws, {
            type: 'controlState',
            state: this.controlCoordinator.getState()
        });
    }

    private broadcastControlState(state: ControlState) {
        this.broadcast({
            type: 'controlState',
            state
        });
    }

    /**
     * Broadcast MCP connection status to all clients
     */
    private broadcastMCPStatus(connected: boolean) {
        const message = JSON.stringify({
            type: 'mcpStatus',
            connected,
            mode: USE_REAL_MCP ? 'real' : 'mock'
        });
        this.clients.forEach((info, client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
        console.log(`[Relay] MCP status broadcast: connected=${connected}, mode=${USE_REAL_MCP ? 'real' : 'mock'}`);
    }

    /**
     * Check if MCP is connected
     */
    isMCPConnected(): boolean {
        return this.mcpClient.isConnected();
    }

    private startScreenshotStream() {
        if (this.screenshotInterval) {
            return; // Already streaming
        }

        this.screenshotInterval = setInterval(async () => {
            try {
                const image = await this.mcpClient.takeScreenshot();
                this.broadcast({ type: 'screenshot', image });
            } catch (error) {
                console.error('Error streaming screenshot:', error);
            }
        }, SCREENSHOT_INTERVAL);
    }

    private stopScreenshotStream() {
        if (this.screenshotInterval) {
            clearInterval(this.screenshotInterval);
            this.screenshotInterval = null;
        }
    }

    private send(ws: WebSocket, data: PlaywrightResponse) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    private sendError(ws: WebSocket, message: string) {
        this.send(ws, { type: 'error', message });
    }

    private broadcast(data: PlaywrightResponse) {
        const message = JSON.stringify(data);
        this.clients.forEach((info, client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    // Method to update screenshot from external source (e.g., MCP polling)
    updateScreenshot(base64Image: string) {
        this.mcpClient.setScreenshot(base64Image);
    }
}

// HTTP server for chat API with Claude integration
class ChatServer {
    private server: ReturnType<typeof createServer>;
    private claudeClient: ClaudeClient;
    private playwrightRelay: PlaywrightRelayServer | null = null;

    constructor(port: number) {
        this.claudeClient = new ClaudeClient();

        this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            // CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            // Health check endpoint
            if (req.method === 'GET' && req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'ok',
                    claudeConfigured: this.claudeClient.isConfigured(),
                    mcpConnected: this.playwrightRelay?.isMCPConnected() || false,
                    mcpMode: USE_REAL_MCP ? 'real' : 'mock'
                }));
                return;
            }

            // Clear history endpoint
            if (req.method === 'POST' && req.url === '/chat/clear') {
                this.claudeClient.clearHistory();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
                return;
            }

            // Get conversation history endpoint
            if (req.method === 'GET' && req.url === '/chat/history') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ history: this.claudeClient.getHistory() }));
                return;
            }

            // Control state endpoint
            if (req.method === 'GET' && req.url === '/control/state') {
                if (this.playwrightRelay) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(this.playwrightRelay.getControlCoordinator().getState()));
                } else {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Playwright relay not available' }));
                }
                return;
            }

            // Set control mode endpoint
            if (req.method === 'POST' && req.url === '/control/mode') {
                let body = '';
                req.on('data', (chunk) => { body += chunk.toString(); });
                req.on('end', () => {
                    try {
                        const { mode, source } = JSON.parse(body);
                        if (this.playwrightRelay && mode) {
                            const result = this.playwrightRelay.getControlCoordinator().setMode(mode, source || 'user');
                            res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(result));
                        } else {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Missing mode or relay not available' }));
                        }
                    } catch (error) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid request body' }));
                    }
                });
                return;
            }

            // Main chat endpoint
            if (req.method === 'POST' && req.url === '/chat') {
                let body = '';
                req.on('data', (chunk) => {
                    body += chunk.toString();
                });

                req.on('end', async () => {
                    try {
                        const request: ChatRequest = JSON.parse(body);

                        // Clear history if requested
                        if (request.clearHistory) {
                            this.claudeClient.clearHistory();
                        }

                        // Get browser context from Playwright relay if available
                        let context = request.context;
                        if (!context && this.playwrightRelay) {
                            context = this.playwrightRelay.getMCPClient().getBrowserContext();
                        }

                        if (request.stream) {
                            // Streaming response
                            await this.handleStreamingChat(res, request.message, context);
                        } else {
                            // Non-streaming response
                            await this.handleNonStreamingChat(res, request.message, context);
                        }
                    } catch (error) {
                        console.error('Chat error:', error);
                        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: errorMessage }));
                    }
                });
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        });

        this.server.listen(port, () => {
            console.log(`Chat server running on http://localhost:${port}`);
            if (!this.claudeClient.isConfigured()) {
                console.log('  Warning: ANTHROPIC_API_KEY not set - Claude API calls will fail');
            }
        });
    }

    setPlaywrightRelay(relay: PlaywrightRelayServer) {
        this.playwrightRelay = relay;
    }

    private async handleNonStreamingChat(
        res: ServerResponse,
        message: string,
        context?: BrowserContext
    ): Promise<void> {
        try {
            const response = await this.claudeClient.sendMessage(message, context);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ response }));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to get response';
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errorMessage }));
        }
    }

    private async handleStreamingChat(
        res: ServerResponse,
        message: string,
        context?: BrowserContext
    ): Promise<void> {
        // Set up SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        try {
            await this.claudeClient.streamMessage(
                message,
                (chunk) => {
                    // Send chunk as SSE event
                    res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
                },
                context
            );

            // Send completion event
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Stream error';
            res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
            res.end();
        }
    }
}

// Main entry point
function main() {
    console.log('='.repeat(60));
    console.log('Starting Playwright Assistant backend servers...');
    console.log('='.repeat(60));
    console.log('');

    // MCP mode info
    console.log(`MCP Mode: ${USE_REAL_MCP ? 'REAL (connecting to Playwright MCP server)' : 'MOCK (simulated responses)'}`);
    console.log('  Set USE_REAL_MCP=false to run in mock mode');
    console.log('');

    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
        console.log('Note: ANTHROPIC_API_KEY environment variable not set.');
        console.log('      Set it to enable Claude API integration:');
        console.log('      export ANTHROPIC_API_KEY=your-api-key');
        console.log('');
    }

    const playwrightRelay = new PlaywrightRelayServer(PLAYWRIGHT_WS_PORT);
    const chatServer = new ChatServer(CHAT_HTTP_PORT);

    // Connect chat server to playwright relay for browser context
    chatServer.setPlaywrightRelay(playwrightRelay);

    console.log('\nServers started:');
    console.log(`  - Playwright WebSocket: ws://localhost:${PLAYWRIGHT_WS_PORT}`);
    console.log(`  - Chat HTTP API: http://localhost:${CHAT_HTTP_PORT}/chat`);
    console.log(`  - Screenshot interval: ${SCREENSHOT_INTERVAL}ms`);
    console.log(`  - Recordings directory: ${RECORDINGS_DIR}`);
    console.log('');
    console.log('API Endpoints:');
    console.log('  POST /chat          - Send chat message (supports streaming)');
    console.log('  POST /chat/clear    - Clear conversation history');
    console.log('  GET  /chat/history  - Get conversation history');
    console.log('  GET  /health        - Health check (includes MCP status)');
    console.log('  GET  /control/state - Get current control state');
    console.log('  POST /control/mode  - Set control mode');
    console.log('');
    console.log('Recording Commands (WebSocket):');
    console.log('  { type: "startRecording", name: "..." }');
    console.log('  { type: "stopRecording" }');
    console.log('  { type: "listRecordings" }');
    console.log('  { type: "playRecording", recordingId: "...", speed: 1 }');
    console.log('  { type: "pausePlayback" }');
    console.log('  { type: "resumePlayback" }');
    console.log('  { type: "stopPlayback" }');
    console.log('  { type: "exportRecording", recordingId: "...", format: "playwright" }');
    console.log('');
    console.log('Control modes: shared, user-only, ai-only, locked');
    console.log('Connect WebSocket with ?source=user or ?source=ai query param');
    console.log('\nPress Ctrl+C to stop.');

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nShutting down gracefully...');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\nReceived SIGTERM, shutting down...');
        process.exit(0);
    });

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
        console.error('Uncaught exception:', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled rejection at:', promise, 'reason:', reason);
    });
}

main();
