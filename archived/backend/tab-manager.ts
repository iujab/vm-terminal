/**
 * Tab Manager - Manages browser tabs for the Playwright Assistant
 * Provides a clean interface for tab operations and state management
 */

export interface Tab {
    id: string;
    title: string;
    url: string;
    favicon?: string;
    isActive: boolean;
    createdAt: number;
}

export type TabChangeCallback = (tabs: Tab[], activeTabId: string | null) => void;

export class TabManager {
    private tabs: Map<string, Tab> = new Map();
    private activeTabId: string | null = null;
    private callbacks: Set<TabChangeCallback> = new Set();
    private ws: WebSocket | null = null;

    constructor() {}

    /**
     * Connect to the Playwright server WebSocket
     */
    connect(wsUrl: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(wsUrl);

                this.ws.onopen = () => {
                    console.log('TabManager connected to Playwright server');
                    // Request initial tab list
                    this.sendMessage({ type: 'listTabs' });
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleMessage(data);
                    } catch (e) {
                        console.error('TabManager: Failed to parse message', e);
                    }
                };

                this.ws.onerror = (error) => {
                    console.error('TabManager WebSocket error:', error);
                    reject(error);
                };

                this.ws.onclose = () => {
                    console.log('TabManager disconnected from Playwright server');
                    this.ws = null;
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Disconnect from the Playwright server
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Handle incoming WebSocket messages
     */
    private handleMessage(data: any): void {
        switch (data.type) {
            case 'tabs':
                this.updateTabs(data.tabs, data.activeTabId);
                break;

            case 'tabCreated':
                if (data.tab) {
                    this.tabs.set(data.tab.id, data.tab);
                    this.notifyCallbacks();
                }
                break;

            case 'tabClosed':
                if (data.tabId) {
                    this.tabs.delete(data.tabId);
                    if (this.activeTabId === data.tabId) {
                        const remainingTabs = Array.from(this.tabs.keys());
                        this.activeTabId = remainingTabs.length > 0 ? remainingTabs[0] : null;
                    }
                    this.notifyCallbacks();
                }
                break;

            case 'tabChanged':
                if (data.activeTabId) {
                    this.activeTabId = data.activeTabId;
                    // Update isActive flag for all tabs
                    this.tabs.forEach((tab, id) => {
                        tab.isActive = id === this.activeTabId;
                    });
                    this.notifyCallbacks();
                }
                break;
        }
    }

    /**
     * Update tabs from server response
     */
    private updateTabs(tabs: Tab[], activeTabId: string | null): void {
        this.tabs.clear();
        for (const tab of tabs) {
            this.tabs.set(tab.id, tab);
        }
        this.activeTabId = activeTabId;
        this.notifyCallbacks();
    }

    /**
     * Send a message to the Playwright server
     */
    private sendMessage(message: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.warn('TabManager: WebSocket not connected');
        }
    }

    /**
     * Notify all registered callbacks of tab changes
     */
    private notifyCallbacks(): void {
        const tabs = this.getTabs();
        this.callbacks.forEach(callback => {
            try {
                callback(tabs, this.activeTabId);
            } catch (error) {
                console.error('TabManager callback error:', error);
            }
        });
    }

    /**
     * Get all tabs as an array
     */
    getTabs(): Tab[] {
        return Array.from(this.tabs.values());
    }

    /**
     * Get the currently active tab
     */
    getActiveTab(): Tab | null {
        if (!this.activeTabId) return null;
        return this.tabs.get(this.activeTabId) || null;
    }

    /**
     * Get the active tab ID
     */
    getActiveTabId(): string | null {
        return this.activeTabId;
    }

    /**
     * Get a tab by ID
     */
    getTab(id: string): Tab | null {
        return this.tabs.get(id) || null;
    }

    /**
     * Switch to a specific tab
     */
    async switchToTab(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.tabs.has(id)) {
                reject(new Error(`Tab ${id} not found`));
                return;
            }

            const messageId = `switch-${Date.now()}`;

            const handler = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.id === messageId) {
                        this.ws?.removeEventListener('message', handler);
                        if (data.success) {
                            resolve();
                        } else {
                            reject(new Error(data.message || 'Failed to switch tab'));
                        }
                    }
                } catch (e) {
                    // Ignore parse errors for other messages
                }
            };

            this.ws?.addEventListener('message', handler);
            this.sendMessage({ id: messageId, type: 'switchTab', tabId: id });

            // Timeout after 5 seconds
            setTimeout(() => {
                this.ws?.removeEventListener('message', handler);
                reject(new Error('Switch tab timeout'));
            }, 5000);
        });
    }

    /**
     * Create a new tab
     */
    async createTab(url?: string): Promise<Tab> {
        return new Promise((resolve, reject) => {
            const messageId = `new-${Date.now()}`;

            const handler = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.id === messageId) {
                        this.ws?.removeEventListener('message', handler);
                        if (data.success && data.tab) {
                            resolve(data.tab);
                        } else {
                            reject(new Error(data.message || 'Failed to create tab'));
                        }
                    }
                } catch (e) {
                    // Ignore parse errors for other messages
                }
            };

            this.ws?.addEventListener('message', handler);
            this.sendMessage({ id: messageId, type: 'newTab', url });

            // Timeout after 10 seconds
            setTimeout(() => {
                this.ws?.removeEventListener('message', handler);
                reject(new Error('Create tab timeout'));
            }, 10000);
        });
    }

    /**
     * Close a tab
     */
    async closeTab(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.tabs.has(id)) {
                reject(new Error(`Tab ${id} not found`));
                return;
            }

            // Cannot close the last tab
            if (this.tabs.size <= 1) {
                reject(new Error('Cannot close the last tab'));
                return;
            }

            const messageId = `close-${Date.now()}`;

            const handler = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.id === messageId) {
                        this.ws?.removeEventListener('message', handler);
                        if (data.success) {
                            resolve();
                        } else {
                            reject(new Error(data.message || 'Failed to close tab'));
                        }
                    }
                } catch (e) {
                    // Ignore parse errors for other messages
                }
            };

            this.ws?.addEventListener('message', handler);
            this.sendMessage({ id: messageId, type: 'closeTab', tabId: id });

            // Timeout after 5 seconds
            setTimeout(() => {
                this.ws?.removeEventListener('message', handler);
                reject(new Error('Close tab timeout'));
            }, 5000);
        });
    }

    /**
     * Close all tabs except the specified one
     */
    async closeOtherTabs(keepId: string): Promise<void> {
        const tabsToClose = Array.from(this.tabs.keys()).filter(id => id !== keepId);
        for (const id of tabsToClose) {
            try {
                await this.closeTab(id);
            } catch (error) {
                console.error(`Failed to close tab ${id}:`, error);
            }
        }
    }

    /**
     * Duplicate a tab
     */
    async duplicateTab(id: string): Promise<Tab> {
        const tab = this.tabs.get(id);
        if (!tab) {
            throw new Error(`Tab ${id} not found`);
        }
        return this.createTab(tab.url);
    }

    /**
     * Refresh the tab list from the server
     */
    refreshTabs(): void {
        this.sendMessage({ type: 'listTabs' });
    }

    /**
     * Register a callback to be notified when tabs change
     */
    onTabChange(callback: TabChangeCallback): () => void {
        this.callbacks.add(callback);

        // Immediately call with current state
        callback(this.getTabs(), this.activeTabId);

        // Return unsubscribe function
        return () => {
            this.callbacks.delete(callback);
        };
    }

    /**
     * Get the number of tabs
     */
    getTabCount(): number {
        return this.tabs.size;
    }

    /**
     * Check if connected to the server
     */
    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}

// Export a singleton instance
export const tabManager = new TabManager();
