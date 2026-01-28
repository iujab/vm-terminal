/**
 * Playwright Server - Runs inside the VM container
 * Connects to the Chrome instance and exposes control via WebSocket
 * Supports multi-tab browser management
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { WebSocketServer, WebSocket } from 'ws';

const WS_PORT = 8765;
const CDP_URL = 'http://localhost:9222';

// Tab interface
interface Tab {
    id: string;
    title: string;
    url: string;
    favicon?: string;
    isActive: boolean;
    createdAt: number;
}

interface ActionMessage {
    id?: string;
    type: 'click' | 'dblclick' | 'scroll' | 'type' | 'press' | 'navigate' | 'screenshot' | 'snapshot' | 'evaluate' | 'hover' | 'select' | 'back' | 'forward' | 'reload' | 'inspect' | 'setInspectorMode' | 'listTabs' | 'switchTab' | 'newTab' | 'closeTab';
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

interface ElementInfo {
    tagName: string;
    id?: string;
    classes: string[];
    attributes: Record<string, string>;
    boundingBox: { x: number; y: number; width: number; height: number };
    selectors: {
        css: string;
        xpath: string;
        text?: string;
        testId?: string;
        role?: string;
        ariaLabel?: string;
    };
    bestSelector?: string;
    innerText?: string;
    computedStyles?: Record<string, string>;
}

interface ResponseMessage {
    id?: string;
    type: 'screenshot' | 'snapshot' | 'result' | 'error' | 'event' | 'inspectResult' | 'inspectorMode' | 'tabs' | 'tabChanged' | 'tabCreated' | 'tabClosed';
    success?: boolean;
    image?: string;
    content?: string;
    message?: string;
    data?: any;
    event?: string;
    element?: ElementInfo | null;
    enabled?: boolean;
    tabs?: Tab[];
    tab?: Tab | null;
    tabId?: string;
    activeTabId?: string;
}

class PlaywrightServer {
    private wss: WebSocketServer;
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private pages: Map<string, Page> = new Map();
    private activePageId: string | null = null;
    private clients: Set<WebSocket> = new Set();
    private screenshotInterval: NodeJS.Timeout | null = null;
    private isConnecting = false;
    private inspectorModeEnabled = false;
    private tabIdCounter = 0;

    constructor(port: number) {
        this.wss = new WebSocketServer({ port });
        this.setupWebSocket();
        this.connectToBrowser();
    }

    private generateTabId(): string {
        return `tab-${++this.tabIdCounter}-${Date.now()}`;
    }

    private setupWebSocket() {
        this.wss.on('connection', (ws) => {
            console.log('Client connected');
            this.clients.add(ws);

            ws.on('message', async (data) => {
                try {
                    const message: ActionMessage = JSON.parse(data.toString());
                    await this.handleMessage(ws, message);
                } catch (error) {
                    this.sendError(ws, `Invalid message: ${error}`);
                }
            });

            ws.on('close', () => {
                console.log('Client disconnected');
                this.clients.delete(ws);
                if (this.clients.size === 0) {
                    this.stopScreenshotStream();
                }
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.clients.delete(ws);
            });

            // Start screenshot stream for this client
            this.startScreenshotStream();

            // Send initial screenshot and tab list
            this.sendScreenshot(ws);
            this.sendTabList(ws);
        });

        console.log(`Playwright WebSocket server running on port ${WS_PORT}`);
    }

    private async connectToBrowser() {
        if (this.isConnecting) return;
        this.isConnecting = true;

        console.log('Connecting to Chrome via CDP...');

        const maxRetries = 30;
        let retries = 0;

        while (retries < maxRetries) {
            try {
                this.browser = await chromium.connectOverCDP(CDP_URL);
                console.log('Connected to Chrome');

                // Get existing contexts or create one
                const contexts = this.browser.contexts();
                if (contexts.length > 0) {
                    this.context = contexts[0];
                } else {
                    this.context = await this.browser.newContext({
                        viewport: {
                            width: parseInt(process.env.SCREEN_WIDTH || '1280'),
                            height: parseInt(process.env.SCREEN_HEIGHT || '720')
                        }
                    });
                }

                // Register existing pages
                const existingPages = this.context.pages();
                for (const page of existingPages) {
                    const tabId = this.generateTabId();
                    this.pages.set(tabId, page);
                    this.setupPageEvents(page, tabId);
                    if (!this.activePageId) {
                        this.activePageId = tabId;
                    }
                }

                // If no pages exist, create one
                if (this.pages.size === 0) {
                    await this.createNewTab();
                }

                // Listen for new pages created externally (e.g., target="_blank" links)
                this.context.on('page', (page) => {
                    const tabId = this.generateTabId();
                    this.pages.set(tabId, page);
                    this.setupPageEvents(page, tabId);

                    // Switch to the new tab
                    this.activePageId = tabId;

                    this.getTabInfo(tabId).then(tab => {
                        this.broadcast({ type: 'tabCreated', tab });
                        this.broadcastTabList();
                    });
                });

                this.isConnecting = false;
                this.broadcast({ type: 'event', event: 'connected' });
                return;
            } catch (error) {
                retries++;
                console.log(`Connection attempt ${retries}/${maxRetries} failed, retrying...`);
                await this.sleep(1000);
            }
        }

        console.error('Failed to connect to Chrome after maximum retries');
        this.isConnecting = false;
    }

    private setupPageEvents(page: Page, tabId: string) {
        page.on('load', () => {
            this.broadcast({
                type: 'event',
                event: 'load',
                data: { url: page.url(), tabId },
                tabId
            });
            this.broadcastTabList();
        });

        page.on('domcontentloaded', () => {
            this.broadcast({ type: 'event', event: 'domcontentloaded', tabId });
            this.broadcastTabList();
        });

        page.on('console', (msg) => {
            this.broadcast({
                type: 'event',
                event: 'console',
                data: { type: msg.type(), text: msg.text() },
                tabId
            });
        });

        page.on('dialog', async (dialog) => {
            this.broadcast({
                type: 'event',
                event: 'dialog',
                data: { type: dialog.type(), message: dialog.message() },
                tabId
            });
            // Auto-accept dialogs for now
            await dialog.accept();
        });

        page.on('close', () => {
            this.pages.delete(tabId);

            // If the closed page was active, switch to another page
            if (this.activePageId === tabId) {
                const remainingIds = Array.from(this.pages.keys());
                this.activePageId = remainingIds.length > 0 ? remainingIds[0] : null;
            }

            this.broadcast({ type: 'tabClosed', tabId });
            this.broadcastTabList();
        });
    }

    private getActivePage(): Page | null {
        if (!this.activePageId) return null;
        return this.pages.get(this.activePageId) || null;
    }

    private async getTabInfo(tabId: string): Promise<Tab | null> {
        const page = this.pages.get(tabId);
        if (!page) return null;

        let title = 'New Tab';
        try {
            title = await page.title() || this.getPageTitleFromUrl(page.url());
        } catch {
            title = this.getPageTitleFromUrl(page.url());
        }

        return {
            id: tabId,
            title: title,
            url: page.url() || 'about:blank',
            favicon: this.getFaviconUrl(page.url()),
            isActive: tabId === this.activePageId,
            createdAt: Date.now()
        };
    }

    private getPageTitleFromUrl(url: string): string {
        if (!url || url === 'about:blank') return 'New Tab';
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return url.substring(0, 30);
        }
    }

    private getFaviconUrl(pageUrl: string): string | undefined {
        if (!pageUrl || pageUrl === 'about:blank') return undefined;
        try {
            const url = new URL(pageUrl);
            return `${url.origin}/favicon.ico`;
        } catch {
            return undefined;
        }
    }

    private async getAllTabs(): Promise<Tab[]> {
        const tabs: Tab[] = [];
        for (const [tabId] of this.pages) {
            const tab = await this.getTabInfo(tabId);
            if (tab) {
                tabs.push(tab);
            }
        }
        return tabs;
    }

    private async createNewTab(url?: string): Promise<Tab | null> {
        if (!this.context) return null;

        try {
            const page = await this.context.newPage();
            const tabId = this.generateTabId();
            this.pages.set(tabId, page);
            this.setupPageEvents(page, tabId);

            // Make the new tab active
            this.activePageId = tabId;

            if (url) {
                await page.goto(url, { waitUntil: 'domcontentloaded' });
            }

            return await this.getTabInfo(tabId);
        } catch (error) {
            console.error('Failed to create new tab:', error);
            return null;
        }
    }

    private async switchToTab(tabId: string): Promise<boolean> {
        if (!this.pages.has(tabId)) {
            return false;
        }

        this.activePageId = tabId;
        const page = this.pages.get(tabId);
        if (page) {
            try {
                await page.bringToFront();
            } catch (error) {
                console.error('Failed to bring tab to front:', error);
            }
        }

        return true;
    }

    private async closeTab(tabId: string): Promise<boolean> {
        const page = this.pages.get(tabId);
        if (!page) return false;

        // Don't close the last tab
        if (this.pages.size <= 1) {
            console.log('Cannot close the last tab');
            return false;
        }

        try {
            await page.close();
            // The 'close' event handler will update the state
            return true;
        } catch (error) {
            console.error('Failed to close tab:', error);
            return false;
        }
    }

    private async handleMessage(ws: WebSocket, message: ActionMessage) {
        try {
            let response: ResponseMessage = { id: message.id, type: 'result', success: true };

            // Handle tab management messages first (these don't require an active page)
            switch (message.type) {
                case 'listTabs':
                    response = {
                        id: message.id,
                        type: 'tabs',
                        tabs: await this.getAllTabs(),
                        activeTabId: this.activePageId || undefined
                    };
                    this.send(ws, response);
                    return;

                case 'switchTab':
                    if (message.tabId) {
                        const success = await this.switchToTab(message.tabId);
                        if (success) {
                            const tab = await this.getTabInfo(message.tabId);
                            this.broadcast({ type: 'tabChanged', tab, activeTabId: message.tabId });
                            this.broadcastTabList();
                        }
                        response = { id: message.id, type: 'result', success };
                    } else {
                        response = { id: message.id, type: 'error', message: 'Missing tabId' };
                    }
                    this.send(ws, response);
                    return;

                case 'newTab':
                    const newTab = await this.createNewTab(message.url);
                    if (newTab) {
                        this.broadcast({ type: 'tabCreated', tab: newTab });
                        this.broadcastTabList();
                        response = { id: message.id, type: 'result', success: true, tab: newTab };
                    } else {
                        response = { id: message.id, type: 'error', message: 'Failed to create tab' };
                    }
                    this.send(ws, response);
                    return;

                case 'closeTab':
                    if (message.tabId) {
                        const success = await this.closeTab(message.tabId);
                        response = { id: message.id, type: 'result', success };
                    } else {
                        response = { id: message.id, type: 'error', message: 'Missing tabId' };
                    }
                    this.send(ws, response);
                    return;
            }

            // Handle page action messages - these require an active page
            const page = this.getActivePage();
            if (!page) {
                this.sendError(ws, 'No active page', message.id);
                return;
            }

            switch (message.type) {
                case 'click':
                    if (message.x !== undefined && message.y !== undefined) {
                        await page.mouse.click(message.x, message.y);
                    } else if (message.selector) {
                        await page.click(message.selector);
                    }
                    break;

                case 'dblclick':
                    if (message.x !== undefined && message.y !== undefined) {
                        await page.mouse.dblclick(message.x, message.y);
                    } else if (message.selector) {
                        await page.dblclick(message.selector);
                    }
                    break;

                case 'hover':
                    if (message.x !== undefined && message.y !== undefined) {
                        await page.mouse.move(message.x, message.y);
                    } else if (message.selector) {
                        await page.hover(message.selector);
                    }
                    break;

                case 'scroll':
                    const deltaX = message.deltaX || 0;
                    const deltaY = message.deltaY || 0;
                    await page.mouse.wheel(deltaX, deltaY);
                    break;

                case 'type':
                    if (message.text) {
                        if (message.selector) {
                            await page.fill(message.selector, message.text);
                        } else {
                            await page.keyboard.type(message.text);
                        }
                    }
                    break;

                case 'press':
                    if (message.key) {
                        await page.keyboard.press(message.key);
                    }
                    break;

                case 'select':
                    if (message.selector && message.value) {
                        await page.selectOption(message.selector, message.value);
                    }
                    break;

                case 'navigate':
                    if (message.url) {
                        await page.goto(message.url, { waitUntil: 'domcontentloaded' });
                        this.broadcastTabList();
                    }
                    break;

                case 'back':
                    await page.goBack();
                    this.broadcastTabList();
                    break;

                case 'forward':
                    await page.goForward();
                    this.broadcastTabList();
                    break;

                case 'reload':
                    await page.reload();
                    break;

                case 'screenshot':
                    const buffer = await page.screenshot({ type: 'png' });
                    response = {
                        id: message.id,
                        type: 'screenshot',
                        image: buffer.toString('base64'),
                        tabId: this.activePageId || undefined
                    };
                    break;

                case 'snapshot':
                    const snapshot = await (page as any).accessibility.snapshot();
                    response = {
                        id: message.id,
                        type: 'snapshot',
                        content: JSON.stringify(snapshot, null, 2),
                        tabId: this.activePageId || undefined
                    };
                    break;

                case 'evaluate':
                    if (message.script) {
                        const result = await page.evaluate(message.script);
                        response = {
                            id: message.id,
                            type: 'result',
                            success: true,
                            data: result
                        };
                    }
                    break;

                case 'inspect':
                    if (message.x !== undefined && message.y !== undefined) {
                        const elementInfo = await this.inspectElementAt(message.x, message.y);
                        response = {
                            id: message.id,
                            type: 'inspectResult',
                            element: elementInfo
                        };
                    } else {
                        response = {
                            id: message.id,
                            type: 'error',
                            message: 'Missing coordinates for inspect'
                        };
                    }
                    break;

                case 'setInspectorMode':
                    this.inspectorModeEnabled = message.enabled ?? false;
                    response = {
                        id: message.id,
                        type: 'inspectorMode',
                        enabled: this.inspectorModeEnabled
                    };
                    this.broadcast({
                        type: 'inspectorMode',
                        enabled: this.inspectorModeEnabled
                    });
                    break;

                default:
                    response = {
                        id: message.id,
                        type: 'error',
                        message: `Unknown action: ${message.type}`
                    };
            }

            this.send(ws, response);
        } catch (error) {
            this.sendError(ws, `Action failed: ${error}`, message.id);
        }
    }

    private async sendScreenshot(ws: WebSocket) {
        const page = this.getActivePage();
        if (!page) return;

        try {
            const buffer = await page.screenshot({ type: 'png' });
            this.send(ws, {
                type: 'screenshot',
                image: buffer.toString('base64'),
                tabId: this.activePageId || undefined
            });
        } catch (error) {
            console.error('Screenshot error:', error);
        }
    }

    private async sendTabList(ws: WebSocket) {
        this.send(ws, {
            type: 'tabs',
            tabs: await this.getAllTabs(),
            activeTabId: this.activePageId || undefined
        });
    }

    private async broadcastTabList() {
        this.broadcast({
            type: 'tabs',
            tabs: await this.getAllTabs(),
            activeTabId: this.activePageId || undefined
        });
    }

    private startScreenshotStream() {
        if (this.screenshotInterval) return;

        const interval = parseInt(process.env.SCREENSHOT_INTERVAL || '200');
        this.screenshotInterval = setInterval(async () => {
            const page = this.getActivePage();
            if (!page || this.clients.size === 0) return;

            try {
                const buffer = await page.screenshot({ type: 'png' });
                const message: ResponseMessage = {
                    type: 'screenshot',
                    image: buffer.toString('base64'),
                    tabId: this.activePageId || undefined
                };
                this.broadcast(message);
            } catch (error) {
                // Ignore screenshot errors during streaming
            }
        }, interval);
    }

    private stopScreenshotStream() {
        if (this.screenshotInterval) {
            clearInterval(this.screenshotInterval);
            this.screenshotInterval = null;
        }
    }

    private send(ws: WebSocket, message: ResponseMessage) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    private sendError(ws: WebSocket, message: string, id?: string) {
        this.send(ws, { id, type: 'error', message });
    }

    private broadcast(message: ResponseMessage) {
        const data = JSON.stringify(message);
        this.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async inspectElementAt(x: number, y: number): Promise<ElementInfo | null> {
        const page = this.getActivePage();
        if (!page) return null;

        try {
            const elementInfo = await page.evaluate(([px, py]) => {
                const element = document.elementFromPoint(px, py);
                if (!element) {
                    return null;
                }

                // Get bounding box
                const rect = element.getBoundingClientRect();
                const boundingBox = {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height
                };

                // Get attributes
                const attributes: Record<string, string> = {};
                for (const attr of element.attributes) {
                    attributes[attr.name] = attr.value;
                }

                // Get classes
                const classes = Array.from(element.classList);

                // Generate CSS selector
                function getCssSelector(el: Element): string {
                    if (el.id) {
                        return '#' + CSS.escape(el.id);
                    }

                    let selector = el.tagName.toLowerCase();

                    if (el.className && typeof el.className === 'string') {
                        const clsList = el.className.trim().split(/\s+/).filter(c => c);
                        if (clsList.length > 0) {
                            selector += '.' + clsList.map(c => CSS.escape(c)).join('.');
                        }
                    }

                    const parent = el.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children).filter(
                            child => child.tagName === el.tagName
                        );
                        if (siblings.length > 1) {
                            const index = siblings.indexOf(el) + 1;
                            selector += ':nth-child(' + index + ')';
                        }
                    }

                    return selector;
                }

                function getFullCssSelector(el: Element): string {
                    const parts: string[] = [];
                    let current: Element | null = el;

                    while (current && current !== document.body && current !== document.documentElement) {
                        parts.unshift(getCssSelector(current));
                        current = current.parentElement;

                        if (parts[0].startsWith('#')) {
                            break;
                        }
                    }

                    return parts.join(' > ');
                }

                // Generate XPath
                function getXPath(el: Element): string {
                    if (el.id) {
                        return '//*[@id="' + el.id + '"]';
                    }

                    const parts: string[] = [];
                    let current: Element | null = el;

                    while (current && current.nodeType === Node.ELEMENT_NODE) {
                        let index = 1;
                        let sibling = current.previousSibling;

                        while (sibling) {
                            if (sibling.nodeType === Node.ELEMENT_NODE &&
                                (sibling as Element).tagName === current.tagName) {
                                index++;
                            }
                            sibling = sibling.previousSibling;
                        }

                        const tagName = current.tagName.toLowerCase();
                        const part = tagName + '[' + index + ']';
                        parts.unshift(part);
                        current = current.parentElement;
                    }

                    return '/' + parts.join('/');
                }

                // Get text content (truncated)
                function getInnerText(el: Element): string {
                    const text = (el as HTMLElement).innerText || el.textContent || '';
                    const trimmed = text.trim();
                    if (trimmed.length > 100) {
                        return trimmed.substring(0, 100) + '...';
                    }
                    return trimmed;
                }

                // Get computed styles (key ones)
                function getComputedStyles(el: Element): Record<string, string> {
                    const computed = window.getComputedStyle(el);
                    return {
                        display: computed.display,
                        position: computed.position,
                        visibility: computed.visibility,
                        opacity: computed.opacity,
                        color: computed.color,
                        backgroundColor: computed.backgroundColor,
                        fontSize: computed.fontSize,
                        fontFamily: computed.fontFamily,
                        fontWeight: computed.fontWeight,
                        padding: computed.padding,
                        margin: computed.margin,
                        border: computed.border,
                        width: computed.width,
                        height: computed.height,
                        zIndex: computed.zIndex,
                        overflow: computed.overflow,
                        cursor: computed.cursor
                    };
                }

                // Get text selector if element has unique visible text
                function getTextSelector(el: Element): string | undefined {
                    const text = ((el as HTMLElement).innerText || el.textContent || '').trim();
                    if (text && text.length < 50 && !text.includes('\n')) {
                        return text;
                    }
                    return undefined;
                }

                // Get test ID if present
                function getTestId(el: Element): string | undefined {
                    return el.getAttribute('data-testid') ||
                           el.getAttribute('data-test-id') ||
                           el.getAttribute('data-test') ||
                           el.getAttribute('data-cy') ||
                           undefined;
                }

                // Get ARIA role
                function getRole(el: Element): string | undefined {
                    return el.getAttribute('role') || undefined;
                }

                // Get ARIA label
                function getAriaLabel(el: Element): string | undefined {
                    return el.getAttribute('aria-label') ||
                           el.getAttribute('aria-labelledby') ||
                           undefined;
                }

                const cssSelector = getFullCssSelector(element);
                const xpathSelector = getXPath(element);
                const textSelector = getTextSelector(element);
                const testId = getTestId(element);
                const role = getRole(element);
                const ariaLabel = getAriaLabel(element);

                const selectors = {
                    css: cssSelector,
                    xpath: xpathSelector,
                    text: textSelector,
                    testId: testId,
                    role: role,
                    ariaLabel: ariaLabel
                };

                // Determine best selector to use
                function getBestSelector(el: Element, sels: typeof selectors): string {
                    if (sels.testId) {
                        return '[data-testid="' + sels.testId + '"]';
                    }
                    if (el.id) {
                        return '#' + CSS.escape(el.id);
                    }
                    if (sels.role && sels.ariaLabel) {
                        return 'role=' + sels.role + '[name="' + sels.ariaLabel + '"]';
                    }
                    if (sels.role && sels.text && sels.text.length < 30) {
                        return 'role=' + sels.role + '[name="' + sels.text + '"]';
                    }
                    if (sels.text && sels.text.length < 30) {
                        return 'text=' + sels.text;
                    }
                    return sels.css;
                }

                return {
                    tagName: element.tagName.toLowerCase(),
                    id: element.id || undefined,
                    classes: classes,
                    attributes: attributes,
                    boundingBox: boundingBox,
                    selectors: selectors,
                    bestSelector: getBestSelector(element, selectors),
                    innerText: getInnerText(element),
                    computedStyles: getComputedStyles(element)
                };
            }, [x, y] as [number, number]);

            return elementInfo;
        } catch (error) {
            console.error('Error inspecting element:', error);
            return null;
        }
    }
}

// Start server
console.log('Starting Playwright server with multi-tab support...');
new PlaywrightServer(WS_PORT);
