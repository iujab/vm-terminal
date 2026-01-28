/**
 * Docker Playwright WebSocket Client
 *
 * Connects to the Playwright server running inside the Docker container
 * via WebSocket on port 8765.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

// Types matching the Docker container's playwright-server.ts
interface ActionMessage {
    id?: string;
    type: string;
    x?: number;
    y?: number;
    deltaX?: number;
    deltaY?: number;
    text?: string;
    key?: string;
    url?: string;
    selector?: string;
    script?: string;
    value?: string;
    enabled?: boolean;
    tabId?: string;
}

interface ResponseMessage {
    id?: string;
    type: string;
    success?: boolean;
    image?: string;
    content?: string;
    message?: string;
    data?: any;
    event?: string;
    element?: any;
    enabled?: boolean;
    tabs?: any[];
    tab?: any;
    tabId?: string;
    activeTabId?: string;
}

export interface ClickOptions {
    x?: number;
    y?: number;
    ref?: string;
    element?: string;
    button?: 'left' | 'right' | 'middle';
    doubleClick?: boolean;
    modifiers?: ('Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift')[];
}

export interface TypeOptions {
    ref?: string;
    text: string;
    element?: string;
    submit?: boolean;
    slowly?: boolean;
}

export interface NavigateOptions {
    url: string;
}

export interface ScrollOptions {
    deltaX?: number;
    deltaY?: number;
}

export interface ScreenshotOptions {
    type?: 'png' | 'jpeg';
    fullPage?: boolean;
    filename?: string;
    ref?: string;
    element?: string;
}

export interface SnapshotResult {
    content: string;
    elements?: Map<string, ElementInfo>;
}

export interface ElementInfo {
    ref: string;
    role: string;
    name?: string;
    bounds?: { x: number; y: number; width: number; height: number };
}

/**
 * WebSocket client for Docker Playwright server
 */
export class DockerPlaywrightClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private wsUrl: string;
    private requestId = 0;
    private pendingRequests: Map<string, {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }> = new Map();
    private connected = false;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 30;
    private reconnectDelay = 2000;
    private lastSnapshot: SnapshotResult | null = null;

    constructor(wsUrl: string = 'ws://localhost:8765') {
        super();
        this.wsUrl = wsUrl;
    }

    /**
     * Connect to the Docker Playwright server
     */
    async connect(): Promise<void> {
        if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                console.log(`[DockerPlaywright] Connecting to ${this.wsUrl}...`);
                this.ws = new WebSocket(this.wsUrl);

                const connectionTimeout = setTimeout(() => {
                    if (!this.connected) {
                        this.ws?.close();
                        reject(new Error('Connection timeout'));
                    }
                }, 10000);

                this.ws.on('open', () => {
                    clearTimeout(connectionTimeout);
                    console.log('[DockerPlaywright] Connected!');
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    this.emit('connected');
                    resolve();
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    this.handleMessage(data.toString());
                });

                this.ws.on('close', (code) => {
                    console.log(`[DockerPlaywright] Connection closed, code: ${code}`);
                    this.connected = false;
                    this.emit('disconnected', code);
                    this.scheduleReconnect();
                });

                this.ws.on('error', (error) => {
                    console.error('[DockerPlaywright] WebSocket error:', error.message);
                    clearTimeout(connectionTimeout);
                    if (!this.connected) {
                        reject(error);
                    }
                    this.emit('error', error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    private scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[DockerPlaywright] Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
        console.log(`[DockerPlaywright] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            this.connect().catch(err => {
                console.error('[DockerPlaywright] Reconnect failed:', err.message);
            });
        }, delay);
    }

    private handleMessage(data: string) {
        try {
            const message: ResponseMessage = JSON.parse(data);

            // Handle responses to requests
            if (message.id && this.pendingRequests.has(message.id)) {
                const pending = this.pendingRequests.get(message.id)!;
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(message.id);

                if (message.type === 'error') {
                    pending.reject(new Error(message.message || 'Unknown error'));
                } else {
                    pending.resolve(message);
                }
            }

            // Emit events for broadcasts
            if (message.type === 'screenshot' && message.image) {
                this.emit('screenshot', message.image);
            } else if (message.type === 'event') {
                this.emit('browserEvent', message);
            }

        } catch (error) {
            console.error('[DockerPlaywright] Failed to parse message:', error);
        }
    }

    /**
     * Send a request and wait for response
     */
    private sendRequest(action: ActionMessage, timeout = 30000): Promise<ResponseMessage> {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('Not connected to Docker Playwright server'));
                return;
            }

            const id = `req_${++this.requestId}`;
            action.id = id;

            const timeoutHandle = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request ${action.type} timed out`));
            }, timeout);

            this.pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle });

            this.ws.send(JSON.stringify(action));
        });
    }

    /**
     * Take a screenshot
     */
    async takeScreenshot(options: ScreenshotOptions = {}): Promise<string> {
        try {
            const response = await this.sendRequest({ type: 'screenshot' });
            if (response.image) {
                return response.image;
            }
            throw new Error('No screenshot data returned');
        } catch (error) {
            console.error('[DockerPlaywright] Screenshot error:', error);
            throw error;
        }
    }

    /**
     * Get accessibility snapshot
     */
    async getSnapshot(): Promise<SnapshotResult> {
        try {
            const response = await this.sendRequest({ type: 'snapshot' });
            const content = response.content || '';
            this.lastSnapshot = { content };
            return this.lastSnapshot;
        } catch (error) {
            console.error('[DockerPlaywright] Snapshot error:', error);
            throw error;
        }
    }

    /**
     * Click at coordinates
     */
    async click(options: ClickOptions): Promise<boolean> {
        try {
            const action: ActionMessage = { type: 'click' };
            if (options.x !== undefined && options.y !== undefined) {
                action.x = options.x;
                action.y = options.y;
            }
            if (options.doubleClick) {
                action.type = 'dblclick';
            }
            const response = await this.sendRequest(action);
            return response.success !== false;
        } catch (error) {
            console.error('[DockerPlaywright] Click error:', error);
            return false;
        }
    }

    /**
     * Type text
     */
    async type(options: TypeOptions): Promise<boolean> {
        try {
            const response = await this.sendRequest({
                type: 'type',
                text: options.text,
                selector: options.ref
            });
            return response.success !== false;
        } catch (error) {
            console.error('[DockerPlaywright] Type error:', error);
            return false;
        }
    }

    /**
     * Press a key
     */
    async pressKey(key: string): Promise<boolean> {
        try {
            const response = await this.sendRequest({
                type: 'press',
                key: key
            });
            return response.success !== false;
        } catch (error) {
            console.error('[DockerPlaywright] Press key error:', error);
            return false;
        }
    }

    /**
     * Navigate to URL
     */
    async navigate(options: NavigateOptions): Promise<boolean> {
        try {
            const response = await this.sendRequest({
                type: 'navigate',
                url: options.url
            });
            return response.success !== false;
        } catch (error) {
            console.error('[DockerPlaywright] Navigate error:', error);
            return false;
        }
    }

    /**
     * Navigate back
     */
    async navigateBack(): Promise<boolean> {
        try {
            const response = await this.sendRequest({ type: 'back' });
            return response.success !== false;
        } catch (error) {
            console.error('[DockerPlaywright] Navigate back error:', error);
            return false;
        }
    }

    /**
     * Navigate forward
     */
    async goForward(): Promise<boolean> {
        try {
            const response = await this.sendRequest({ type: 'forward' });
            return response.success !== false;
        } catch (error) {
            console.error('[DockerPlaywright] Navigate forward error:', error);
            return false;
        }
    }

    /**
     * Scroll the page
     */
    async scroll(options: ScrollOptions): Promise<boolean> {
        try {
            const response = await this.sendRequest({
                type: 'scroll',
                deltaX: options.deltaX || 0,
                deltaY: options.deltaY || 0
            });
            return response.success !== false;
        } catch (error) {
            console.error('[DockerPlaywright] Scroll error:', error);
            return false;
        }
    }

    /**
     * Hover at coordinates
     */
    async hover(ref: string, element?: string): Promise<boolean> {
        try {
            const response = await this.sendRequest({
                type: 'hover',
                selector: ref
            });
            return response.success !== false;
        } catch (error) {
            console.error('[DockerPlaywright] Hover error:', error);
            return false;
        }
    }

    /**
     * Reload page
     */
    async reload(): Promise<boolean> {
        try {
            const response = await this.sendRequest({ type: 'reload' });
            return response.success !== false;
        } catch (error) {
            console.error('[DockerPlaywright] Reload error:', error);
            return false;
        }
    }

    /**
     * Get last snapshot
     */
    getLastSnapshot(): SnapshotResult | null {
        return this.lastSnapshot;
    }

    /**
     * Find element by text
     */
    findElementByText(text: string): string | null {
        // This would need the snapshot to have element refs
        return null;
    }

    /**
     * Find element by role
     */
    findElementByRole(role: string, name?: string): string | null {
        // This would need the snapshot to have element refs
        return null;
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected && this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * Disconnect
     */
    async disconnect(): Promise<void> {
        if (this.ws) {
            // Clear pending requests
            for (const [id, pending] of this.pendingRequests) {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Client disconnecting'));
            }
            this.pendingRequests.clear();

            this.ws.close();
            this.ws = null;
            this.connected = false;
            this.emit('disconnected', 0);
        }
    }
}

// Export singleton
export const dockerClient = new DockerPlaywrightClient();
