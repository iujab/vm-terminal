/**
 * MCP Client for Playwright Browser Automation
 *
 * This module provides a client interface to communicate with the Playwright MCP server.
 * It wraps MCP tool calls for browser automation including screenshots, clicks, typing,
 * navigation, and accessibility snapshots.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// MCP Protocol Types
interface MCPRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

interface MCPResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

interface MCPNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}

// Browser action types
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
 * MCP Client for Playwright integration
 *
 * Communicates with the Playwright MCP server via stdio JSON-RPC protocol.
 */
export class PlaywrightMCPClient extends EventEmitter {
    private mcpProcess: ChildProcess | null = null;
    private requestId = 0;
    private pendingRequests: Map<number, {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }> = new Map();
    private responseBuffer = '';
    private connected = false;
    private lastSnapshot: SnapshotResult | null = null;
    private tempDir: string;

    // Configuration
    private readonly requestTimeout = 30000; // 30 seconds
    private readonly mcpServerPath: string;

    constructor(options: { mcpServerPath?: string } = {}) {
        super();
        this.mcpServerPath = options.mcpServerPath || 'npx';
        this.tempDir = path.join(os.tmpdir(), 'playwright-mcp-screenshots');

        // Ensure temp directory exists
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Connect to the MCP server
     */
    async connect(): Promise<void> {
        if (this.connected) {
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                // Spawn the Playwright MCP server
                // The server uses stdio for communication
                this.mcpProcess = spawn(this.mcpServerPath, ['@anthropic/mcp-server-playwright'], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env },
                });

                this.mcpProcess.stdout?.on('data', (data: Buffer) => {
                    this.handleStdout(data);
                });

                this.mcpProcess.stderr?.on('data', (data: Buffer) => {
                    const message = data.toString();
                    console.error('[MCP stderr]', message);
                    this.emit('error', new Error(message));
                });

                this.mcpProcess.on('error', (error) => {
                    console.error('[MCP process error]', error);
                    this.connected = false;
                    this.emit('error', error);
                    reject(error);
                });

                this.mcpProcess.on('close', (code) => {
                    console.log('[MCP] Process closed with code:', code);
                    this.connected = false;
                    this.emit('disconnected', code);
                });

                // Initialize MCP session
                this.initializeSession()
                    .then(() => {
                        this.connected = true;
                        this.emit('connected');
                        resolve();
                    })
                    .catch(reject);

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Initialize the MCP session with handshake
     */
    private async initializeSession(): Promise<void> {
        // Send initialize request
        const initResult = await this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {
                roots: { listChanged: true }
            },
            clientInfo: {
                name: 'playwright-assistant',
                version: '1.0.0'
            }
        });

        console.log('[MCP] Initialize result:', initResult);

        // Send initialized notification
        this.sendNotification('notifications/initialized', {});
    }

    /**
     * Handle stdout data from MCP process
     */
    private handleStdout(data: Buffer): void {
        this.responseBuffer += data.toString();

        // Process complete JSON-RPC messages (delimited by newlines)
        const lines = this.responseBuffer.split('\n');
        this.responseBuffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const message = JSON.parse(line) as MCPResponse | MCPNotification;
                    this.handleMessage(message);
                } catch (error) {
                    console.error('[MCP] Failed to parse message:', line, error);
                }
            }
        }
    }

    /**
     * Handle incoming MCP message
     */
    private handleMessage(message: MCPResponse | MCPNotification): void {
        if ('id' in message) {
            // This is a response to a request
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(message.id);

                if (message.error) {
                    pending.reject(new Error(message.error.message));
                } else {
                    pending.resolve(message.result);
                }
            }
        } else {
            // This is a notification
            this.emit('notification', message);
        }
    }

    /**
     * Send a JSON-RPC request and wait for response
     */
    private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!this.mcpProcess?.stdin) {
                reject(new Error('MCP process not connected'));
                return;
            }

            const id = ++this.requestId;
            const request: MCPRequest = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };

            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request ${method} timed out`));
            }, this.requestTimeout);

            this.pendingRequests.set(id, { resolve, reject, timeout });

            const message = JSON.stringify(request) + '\n';
            this.mcpProcess.stdin.write(message);
        });
    }

    /**
     * Send a JSON-RPC notification (no response expected)
     */
    private sendNotification(method: string, params?: Record<string, unknown>): void {
        if (!this.mcpProcess?.stdin) {
            console.error('MCP process not connected');
            return;
        }

        const notification: MCPNotification = {
            jsonrpc: '2.0',
            method,
            params
        };

        const message = JSON.stringify(notification) + '\n';
        this.mcpProcess.stdin.write(message);
    }

    /**
     * Call an MCP tool
     */
    private async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
        const result = await this.sendRequest('tools/call', {
            name: toolName,
            arguments: args
        });
        return result;
    }

    /**
     * Take a screenshot of the current page
     * @returns Base64 encoded image data
     */
    async takeScreenshot(options: ScreenshotOptions = {}): Promise<string> {
        try {
            // Generate temporary filename for screenshot
            const filename = options.filename || path.join(this.tempDir, `screenshot-${Date.now()}.png`);

            const result = await this.callTool('browser_take_screenshot', {
                type: options.type || 'png',
                fullPage: options.fullPage || false,
                filename: filename,
                ...(options.ref && { ref: options.ref }),
                ...(options.element && { element: options.element })
            }) as { content?: Array<{ type: string; data?: string; text?: string }> };

            // If the result contains base64 image data directly
            if (result?.content) {
                for (const item of result.content) {
                    if (item.type === 'image' && item.data) {
                        return item.data;
                    }
                }
            }

            // Otherwise, read from the file
            if (fs.existsSync(filename)) {
                const imageData = fs.readFileSync(filename);
                // Clean up temp file
                fs.unlinkSync(filename);
                return imageData.toString('base64');
            }

            throw new Error('Screenshot failed: no image data returned');
        } catch (error) {
            console.error('[MCP] Screenshot error:', error);
            throw error;
        }
    }

    /**
     * Get accessibility snapshot of the current page
     */
    async getSnapshot(): Promise<SnapshotResult> {
        try {
            const result = await this.callTool('browser_snapshot', {}) as {
                content?: Array<{ type: string; text?: string }>
            };

            let content = '';
            if (result?.content) {
                for (const item of result.content) {
                    if (item.type === 'text' && item.text) {
                        content += item.text;
                    }
                }
            }

            // Parse the snapshot to extract element references
            const elements = this.parseSnapshotElements(content);

            this.lastSnapshot = { content, elements };
            return this.lastSnapshot;
        } catch (error) {
            console.error('[MCP] Snapshot error:', error);
            throw error;
        }
    }

    /**
     * Parse accessibility snapshot to extract element references
     */
    private parseSnapshotElements(content: string): Map<string, ElementInfo> {
        const elements = new Map<string, ElementInfo>();

        // Parse lines that contain element references (format: [ref] role "name")
        const lines = content.split('\n');
        const refPattern = /^\s*-?\s*\[([^\]]+)\]\s+(\w+)(?:\s+"([^"]*)")?/;

        for (const line of lines) {
            const match = line.match(refPattern);
            if (match) {
                const [, ref, role, name] = match;
                elements.set(ref, { ref, role, name });
            }
        }

        return elements;
    }

    /**
     * Click on an element or coordinate
     */
    async click(options: ClickOptions): Promise<boolean> {
        try {
            // If we have coordinates, we need to use a different approach
            // The Playwright MCP uses refs from snapshots, not raw coordinates
            if (options.ref) {
                await this.callTool('browser_click', {
                    ref: options.ref,
                    ...(options.element && { element: options.element }),
                    ...(options.button && { button: options.button }),
                    ...(options.doubleClick && { doubleClick: options.doubleClick }),
                    ...(options.modifiers && { modifiers: options.modifiers })
                });
                return true;
            } else if (options.x !== undefined && options.y !== undefined) {
                // For coordinate-based clicking, we need to use browser_evaluate
                // to execute JavaScript that clicks at the coordinates
                await this.callTool('browser_evaluate', {
                    function: `() => {
                        const x = ${options.x};
                        const y = ${options.y};
                        const element = document.elementFromPoint(x, y);
                        if (element) {
                            const event = new MouseEvent('click', {
                                bubbles: true,
                                cancelable: true,
                                clientX: x,
                                clientY: y
                            });
                            element.dispatchEvent(event);
                        }
                    }`
                });
                return true;
            }
            return false;
        } catch (error) {
            console.error('[MCP] Click error:', error);
            return false;
        }
    }

    /**
     * Type text into an element
     */
    async type(options: TypeOptions): Promise<boolean> {
        try {
            if (options.ref) {
                await this.callTool('browser_type', {
                    ref: options.ref,
                    text: options.text,
                    ...(options.element && { element: options.element }),
                    ...(options.submit && { submit: options.submit }),
                    ...(options.slowly && { slowly: options.slowly })
                });
            } else {
                // Type into currently focused element using keyboard
                await this.callTool('browser_press_key', {
                    key: options.text
                });
            }
            return true;
        } catch (error) {
            console.error('[MCP] Type error:', error);
            return false;
        }
    }

    /**
     * Press a key or key combination
     */
    async pressKey(key: string): Promise<boolean> {
        try {
            await this.callTool('browser_press_key', { key });
            return true;
        } catch (error) {
            console.error('[MCP] Press key error:', error);
            return false;
        }
    }

    /**
     * Navigate to a URL
     */
    async navigate(options: NavigateOptions): Promise<boolean> {
        try {
            await this.callTool('browser_navigate', {
                url: options.url
            });
            return true;
        } catch (error) {
            console.error('[MCP] Navigate error:', error);
            return false;
        }
    }

    /**
     * Navigate back in history
     */
    async navigateBack(): Promise<boolean> {
        try {
            await this.callTool('browser_navigate_back', {});
            return true;
        } catch (error) {
            console.error('[MCP] Navigate back error:', error);
            return false;
        }
    }

    /**
     * Scroll the page
     */
    async scroll(options: ScrollOptions): Promise<boolean> {
        try {
            // Use browser_evaluate to scroll
            const deltaX = options.deltaX || 0;
            const deltaY = options.deltaY || 0;

            await this.callTool('browser_evaluate', {
                function: `() => {
                    window.scrollBy(${deltaX}, ${deltaY});
                }`
            });
            return true;
        } catch (error) {
            console.error('[MCP] Scroll error:', error);
            return false;
        }
    }

    /**
     * Hover over an element
     */
    async hover(ref: string, element?: string): Promise<boolean> {
        try {
            await this.callTool('browser_hover', {
                ref,
                ...(element && { element })
            });
            return true;
        } catch (error) {
            console.error('[MCP] Hover error:', error);
            return false;
        }
    }

    /**
     * Fill a form with multiple fields
     */
    async fillForm(fields: Array<{
        ref: string;
        name: string;
        type: 'textbox' | 'checkbox' | 'radio' | 'combobox' | 'slider';
        value: string;
    }>): Promise<boolean> {
        try {
            await this.callTool('browser_fill_form', { fields });
            return true;
        } catch (error) {
            console.error('[MCP] Fill form error:', error);
            return false;
        }
    }

    /**
     * Select option in a dropdown
     */
    async selectOption(ref: string, values: string[], element?: string): Promise<boolean> {
        try {
            await this.callTool('browser_select_option', {
                ref,
                values,
                ...(element && { element })
            });
            return true;
        } catch (error) {
            console.error('[MCP] Select option error:', error);
            return false;
        }
    }

    /**
     * Wait for text to appear on the page
     */
    async waitForText(text: string, timeout?: number): Promise<boolean> {
        try {
            await this.callTool('browser_wait_for', {
                text,
                ...(timeout && { time: timeout / 1000 }) // Convert to seconds
            });
            return true;
        } catch (error) {
            console.error('[MCP] Wait for text error:', error);
            return false;
        }
    }

    /**
     * Get the last accessibility snapshot
     */
    getLastSnapshot(): SnapshotResult | null {
        return this.lastSnapshot;
    }

    /**
     * Find element reference by text content
     */
    findElementByText(text: string): string | null {
        if (!this.lastSnapshot?.elements) {
            return null;
        }

        for (const [ref, info] of this.lastSnapshot.elements) {
            if (info.name?.toLowerCase().includes(text.toLowerCase())) {
                return ref;
            }
        }
        return null;
    }

    /**
     * Find element reference by role
     */
    findElementByRole(role: string, name?: string): string | null {
        if (!this.lastSnapshot?.elements) {
            return null;
        }

        for (const [ref, info] of this.lastSnapshot.elements) {
            if (info.role.toLowerCase() === role.toLowerCase()) {
                if (!name || info.name?.toLowerCase().includes(name.toLowerCase())) {
                    return ref;
                }
            }
        }
        return null;
    }

    /**
     * Check if connected to MCP server
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Disconnect from MCP server
     */
    async disconnect(): Promise<void> {
        if (this.mcpProcess) {
            // Clear all pending requests
            for (const [id, pending] of this.pendingRequests) {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Client disconnecting'));
            }
            this.pendingRequests.clear();

            // Kill the process
            this.mcpProcess.kill();
            this.mcpProcess = null;
            this.connected = false;
            this.emit('disconnected', 0);
        }
    }
}

/**
 * Alternative MCP Client that uses HTTP/SSE transport
 * for when the MCP server is running as a separate service
 */
export class PlaywrightMCPHttpClient extends EventEmitter {
    private baseUrl: string;
    private connected = false;
    private lastSnapshot: SnapshotResult | null = null;
    private tempDir: string;

    constructor(options: { baseUrl?: string } = {}) {
        super();
        this.baseUrl = options.baseUrl || 'http://localhost:3000';
        this.tempDir = path.join(os.tmpdir(), 'playwright-mcp-screenshots');

        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    async connect(): Promise<void> {
        // Test connection by making a simple request
        try {
            const response = await fetch(`${this.baseUrl}/health`);
            if (response.ok) {
                this.connected = true;
                this.emit('connected');
            } else {
                throw new Error('Health check failed');
            }
        } catch (error) {
            // Server might not have a health endpoint, try to list tools
            try {
                await this.callTool('browser_snapshot', {});
                this.connected = true;
                this.emit('connected');
            } catch {
                throw new Error('Failed to connect to MCP server');
            }
        }
    }

    private async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
        const response = await fetch(`${this.baseUrl}/tools/${toolName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args)
        });

        if (!response.ok) {
            throw new Error(`Tool call failed: ${response.statusText}`);
        }

        return response.json();
    }

    async takeScreenshot(options: ScreenshotOptions = {}): Promise<string> {
        const result = await this.callTool('browser_take_screenshot', {
            type: options.type || 'png',
            fullPage: options.fullPage || false
        }) as { image?: string };

        if (result?.image) {
            return result.image;
        }
        throw new Error('No screenshot data returned');
    }

    async getSnapshot(): Promise<SnapshotResult> {
        const result = await this.callTool('browser_snapshot', {}) as { content?: string };
        const content = result?.content || '';
        this.lastSnapshot = { content };
        return this.lastSnapshot;
    }

    async click(options: ClickOptions): Promise<boolean> {
        if (options.ref) {
            await this.callTool('browser_click', { ref: options.ref });
            return true;
        }
        return false;
    }

    async type(options: TypeOptions): Promise<boolean> {
        if (options.ref) {
            await this.callTool('browser_type', { ref: options.ref, text: options.text });
            return true;
        }
        return false;
    }

    async navigate(options: NavigateOptions): Promise<boolean> {
        await this.callTool('browser_navigate', { url: options.url });
        return true;
    }

    async scroll(options: ScrollOptions): Promise<boolean> {
        // HTTP client might not support direct scroll, use evaluate
        return false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.emit('disconnected', 0);
    }
}

// Export a singleton instance for convenience
export const mcpClient = new PlaywrightMCPClient();
