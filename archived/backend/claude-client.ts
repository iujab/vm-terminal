import https from 'https';

// Browser context passed to Claude for context-aware responses
export interface BrowserContext {
    url?: string;
    title?: string;
    snapshot?: string;
    selectedElement?: string;
}

// Message in conversation history
export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
}

// Content block types
interface TextBlock {
    type: 'text';
    text: string;
}

interface ToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
}

interface ToolResultBlock {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
}

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

// Claude API message format
interface ClaudeMessage {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
}

// Tool definition
interface ToolDefinition {
    name: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

// Claude API request body
interface ClaudeRequestBody {
    model: string;
    max_tokens: number;
    system: string;
    messages: ClaudeMessage[];
    tools?: ToolDefinition[];
    stream?: boolean;
}

// Claude API response
interface ClaudeResponse {
    id: string;
    type: string;
    role: string;
    content: ContentBlock[];
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}

// Claude streaming event types
interface ClaudeStreamEvent {
    type: string;
    index?: number;
    delta?: {
        type: string;
        text?: string;
        partial_json?: string;
    };
    content_block?: ContentBlock;
    message?: ClaudeResponse;
    error?: {
        type: string;
        message: string;
    };
}

// Tool executor interface
export interface ToolExecutor {
    navigate(url: string): Promise<boolean>;
    click(ref: string): Promise<boolean>;
    type(ref: string, text: string): Promise<boolean>;
    scroll(direction: 'up' | 'down', amount?: number): Promise<boolean>;
    getSnapshot(): Promise<string>;
    goBack(): Promise<boolean>;
    goForward(): Promise<boolean>;
}

const CLAUDE_API_URL = 'api.anthropic.com';
const CLAUDE_API_PATH = '/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;

// Browser automation tools
const BROWSER_TOOLS: ToolDefinition[] = [
    {
        name: 'browser_navigate',
        description: 'Navigate the browser to a specific URL',
        input_schema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL to navigate to'
                }
            },
            required: ['url']
        }
    },
    {
        name: 'browser_click',
        description: 'Click on an element identified by its ref from the accessibility snapshot. The ref is shown in square brackets like [ref=123].',
        input_schema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'The element reference (ref) from the accessibility snapshot, e.g., "123"'
                }
            },
            required: ['ref']
        }
    },
    {
        name: 'browser_type',
        description: 'Type text into an input field identified by its ref from the accessibility snapshot',
        input_schema: {
            type: 'object',
            properties: {
                ref: {
                    type: 'string',
                    description: 'The element reference (ref) from the accessibility snapshot'
                },
                text: {
                    type: 'string',
                    description: 'The text to type'
                }
            },
            required: ['ref', 'text']
        }
    },
    {
        name: 'browser_scroll',
        description: 'Scroll the page up or down',
        input_schema: {
            type: 'object',
            properties: {
                direction: {
                    type: 'string',
                    enum: ['up', 'down'],
                    description: 'Direction to scroll'
                },
                amount: {
                    type: 'number',
                    description: 'Amount to scroll in pixels (default: 300)'
                }
            },
            required: ['direction']
        }
    },
    {
        name: 'browser_snapshot',
        description: 'Get a fresh accessibility snapshot of the current page to see its structure and element refs',
        input_schema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'browser_back',
        description: 'Navigate back in browser history',
        input_schema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'browser_forward',
        description: 'Navigate forward in browser history',
        input_schema: {
            type: 'object',
            properties: {}
        }
    }
];

// System prompt that provides context about being a browser automation assistant
const SYSTEM_PROMPT = `You are a browser automation assistant with direct control of a web browser through Playwright.

You have access to browser tools that let you:
- Navigate to URLs
- Click elements (using refs from the accessibility snapshot)
- Type text into input fields
- Scroll the page
- Get fresh page snapshots

IMPORTANT: When the user asks you to perform browser actions (like "go to google.com" or "click the search button"), you MUST use your browser tools to actually perform these actions. Do NOT just describe what you would do - actually do it using the tools.

When browser context is provided, it includes:
- Current URL
- Page title
- Accessibility snapshot showing page structure with element refs in [ref=X] format

To interact with elements, find the ref from the snapshot and use it with browser_click or browser_type.

Be helpful and actually execute the actions the user requests.`;

/**
 * Claude API client for browser automation with tool use
 */
export class ClaudeClient {
    private apiKey: string;
    private conversationHistory: ClaudeMessage[] = [];
    private model: string;
    private toolExecutor: ToolExecutor | null = null;

    constructor(apiKey?: string, model?: string) {
        this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
        this.model = model || DEFAULT_MODEL;

        if (!this.apiKey) {
            console.warn('Warning: ANTHROPIC_API_KEY not set. Claude API calls will fail.');
        }
    }

    /**
     * Set the tool executor for browser actions
     */
    setToolExecutor(executor: ToolExecutor): void {
        this.toolExecutor = executor;
    }

    /**
     * Get the API key status
     */
    isConfigured(): boolean {
        return !!this.apiKey;
    }

    /**
     * Clear conversation history
     */
    clearHistory(): void {
        this.conversationHistory = [];
    }

    /**
     * Get current conversation history
     */
    getHistory(): ConversationMessage[] {
        return this.conversationHistory.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    /**
     * Build system prompt with browser context
     */
    private buildSystemPrompt(context?: BrowserContext): string {
        let prompt = SYSTEM_PROMPT;

        if (context) {
            prompt += '\n\n--- Current Browser Context ---';
            if (context.url) {
                prompt += `\nURL: ${context.url}`;
            }
            if (context.title) {
                prompt += `\nPage Title: ${context.title}`;
            }
            if (context.selectedElement) {
                prompt += `\nSelected Element: ${context.selectedElement}`;
            }
            if (context.snapshot) {
                // Truncate snapshot if too long to avoid token limits
                const maxSnapshotLength = 8000;
                const truncatedSnapshot = context.snapshot.length > maxSnapshotLength
                    ? context.snapshot.substring(0, maxSnapshotLength) + '\n... (truncated)'
                    : context.snapshot;
                prompt += `\n\nPage Snapshot:\n${truncatedSnapshot}`;
            }
        }

        return prompt;
    }

    /**
     * Execute a tool and return the result
     */
    private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
        if (!this.toolExecutor) {
            return 'Error: No tool executor configured. Browser actions are not available.';
        }

        console.log(`[Claude] Executing tool: ${name}`, input);

        try {
            switch (name) {
                case 'browser_navigate': {
                    const url = input.url as string;
                    const success = await this.toolExecutor.navigate(url);
                    return success ? `Successfully navigated to ${url}` : `Failed to navigate to ${url}`;
                }
                case 'browser_click': {
                    const ref = input.ref as string;
                    const success = await this.toolExecutor.click(ref);
                    return success ? `Successfully clicked element [ref=${ref}]` : `Failed to click element [ref=${ref}]`;
                }
                case 'browser_type': {
                    const ref = input.ref as string;
                    const text = input.text as string;
                    const success = await this.toolExecutor.type(ref, text);
                    return success ? `Successfully typed "${text}" into element [ref=${ref}]` : `Failed to type into element [ref=${ref}]`;
                }
                case 'browser_scroll': {
                    const direction = input.direction as 'up' | 'down';
                    const amount = input.amount as number | undefined;
                    const success = await this.toolExecutor.scroll(direction, amount);
                    return success ? `Successfully scrolled ${direction}` : `Failed to scroll ${direction}`;
                }
                case 'browser_snapshot': {
                    const snapshot = await this.toolExecutor.getSnapshot();
                    return `Current page snapshot:\n${snapshot}`;
                }
                case 'browser_back': {
                    const success = await this.toolExecutor.goBack();
                    return success ? 'Successfully navigated back' : 'Failed to navigate back';
                }
                case 'browser_forward': {
                    const success = await this.toolExecutor.goForward();
                    return success ? 'Successfully navigated forward' : 'Failed to navigate forward';
                }
                default:
                    return `Unknown tool: ${name}`;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[Claude] Tool execution error:`, error);
            return `Error executing ${name}: ${errorMessage}`;
        }
    }

    /**
     * Make an API request to Claude
     */
    private async makeRequest(requestBody: ClaudeRequestBody): Promise<ClaudeResponse> {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: CLAUDE_API_URL,
                port: 443,
                path: CLAUDE_API_PATH,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        let errorMessage = `Claude API error: ${res.statusCode}`;
                        try {
                            const errorData = JSON.parse(data);
                            if (errorData.error?.message) {
                                errorMessage = errorData.error.message;
                            }
                        } catch (e) {
                            // Use default error message
                        }
                        reject(new Error(errorMessage));
                        return;
                    }

                    try {
                        const response: ClaudeResponse = JSON.parse(data);
                        resolve(response);
                    } catch (error) {
                        reject(new Error(`Failed to parse Claude response: ${error}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Network error: ${error.message}`));
            });

            req.write(JSON.stringify(requestBody));
            req.end();
        });
    }

    /**
     * Send a message and get a complete response, handling tool use automatically
     */
    async sendMessage(message: string, context?: BrowserContext): Promise<string> {
        if (!this.apiKey) {
            throw new Error('ANTHROPIC_API_KEY not configured. Please set the environment variable.');
        }

        // Add user message to history
        this.conversationHistory.push({ role: 'user', content: message });

        const systemPrompt = this.buildSystemPrompt(context);
        let finalResponse = '';
        let iterations = 0;
        const maxIterations = 10; // Prevent infinite loops

        while (iterations < maxIterations) {
            iterations++;

            const requestBody: ClaudeRequestBody = {
                model: this.model,
                max_tokens: MAX_TOKENS,
                system: systemPrompt,
                messages: this.conversationHistory,
                tools: BROWSER_TOOLS
            };

            try {
                const response = await this.makeRequest(requestBody);

                // Process the response content
                const textParts: string[] = [];
                const toolUses: ToolUseBlock[] = [];

                for (const block of response.content) {
                    if (block.type === 'text') {
                        textParts.push((block as TextBlock).text);
                    } else if (block.type === 'tool_use') {
                        toolUses.push(block as ToolUseBlock);
                    }
                }

                // Add assistant response to history
                this.conversationHistory.push({ role: 'assistant', content: response.content });

                // If stop reason is end_turn or no tool uses, we're done
                if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
                    finalResponse = textParts.join('\n');
                    break;
                }

                // Execute tools and add results
                const toolResults: ToolResultBlock[] = [];
                for (const toolUse of toolUses) {
                    const result = await this.executeTool(toolUse.name, toolUse.input);
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: result
                    });
                }

                // Add tool results as user message
                this.conversationHistory.push({ role: 'user', content: toolResults });

                // Continue the loop to get Claude's next response
                finalResponse = textParts.join('\n');

            } catch (error) {
                // Remove the failed message from history
                this.conversationHistory.pop();
                throw error;
            }
        }

        if (iterations >= maxIterations) {
            console.warn('[Claude] Max iterations reached in tool use loop');
        }

        return finalResponse;
    }

    /**
     * Stream a message response chunk by chunk (simplified - no tool use support in streaming)
     */
    async streamMessage(
        message: string,
        onChunk: (chunk: string) => void,
        context?: BrowserContext
    ): Promise<void> {
        if (!this.apiKey) {
            throw new Error('ANTHROPIC_API_KEY not configured. Please set the environment variable.');
        }

        // For streaming with tools, we use non-streaming internally and simulate streaming
        // This is simpler and still provides good UX
        const response = await this.sendMessage(message, context);

        // Simulate streaming by sending chunks
        const chunkSize = 20;
        for (let i = 0; i < response.length; i += chunkSize) {
            const chunk = response.slice(i, i + chunkSize);
            onChunk(chunk);
            // Small delay to simulate streaming
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
}

// Singleton instance for shared usage
let defaultClient: ClaudeClient | null = null;

/**
 * Get the default Claude client instance
 */
export function getClaudeClient(): ClaudeClient {
    if (!defaultClient) {
        defaultClient = new ClaudeClient();
    }
    return defaultClient;
}

/**
 * Send a message using the default client
 */
export async function sendMessage(message: string, context?: BrowserContext): Promise<string> {
    return getClaudeClient().sendMessage(message, context);
}

/**
 * Stream a message using the default client
 */
export async function streamMessage(
    message: string,
    onChunk: (chunk: string) => void,
    context?: BrowserContext
): Promise<void> {
    return getClaudeClient().streamMessage(message, onChunk, context);
}
