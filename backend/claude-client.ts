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
    content: string;
}

// Claude API message format
interface ClaudeMessage {
    role: 'user' | 'assistant';
    content: string;
}

// Claude API request body
interface ClaudeRequestBody {
    model: string;
    max_tokens: number;
    system: string;
    messages: ClaudeMessage[];
    stream?: boolean;
}

// Claude API response
interface ClaudeResponse {
    id: string;
    type: string;
    role: string;
    content: Array<{
        type: string;
        text: string;
    }>;
    stop_reason: string;
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
    };
    content_block?: {
        type: string;
        text: string;
    };
    message?: ClaudeResponse;
    error?: {
        type: string;
        message: string;
    };
}

const CLAUDE_API_URL = 'api.anthropic.com';
const CLAUDE_API_PATH = '/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;

// System prompt that provides context about being a browser automation assistant
const SYSTEM_PROMPT = `You are a helpful browser automation assistant integrated with Playwright. You help users interact with web pages, automate browser tasks, and answer questions about web content.

Your capabilities include:
- Answering questions about the current page content and structure
- Suggesting browser automation actions (click, type, scroll, navigate)
- Explaining web page elements and their purposes
- Helping debug browser automation issues
- Providing guidance on CSS selectors and XPath queries

When browser context is provided, use it to give context-aware responses. The context may include:
- Current URL
- Page title
- Accessibility snapshot (page structure)
- Selected element information

Be concise but helpful. When suggesting automation actions, be specific about which elements to target.`;

/**
 * Claude API client for browser automation assistance
 */
export class ClaudeClient {
    private apiKey: string;
    private conversationHistory: ConversationMessage[] = [];
    private model: string;

    constructor(apiKey?: string, model?: string) {
        this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
        this.model = model || DEFAULT_MODEL;

        if (!this.apiKey) {
            console.warn('Warning: ANTHROPIC_API_KEY not set. Claude API calls will fail.');
        }
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
        return [...this.conversationHistory];
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
     * Send a message and get a complete response
     */
    async sendMessage(message: string, context?: BrowserContext): Promise<string> {
        if (!this.apiKey) {
            throw new Error('ANTHROPIC_API_KEY not configured. Please set the environment variable.');
        }

        // Add user message to history
        this.conversationHistory.push({ role: 'user', content: message });

        const requestBody: ClaudeRequestBody = {
            model: this.model,
            max_tokens: MAX_TOKENS,
            system: this.buildSystemPrompt(context),
            messages: this.conversationHistory.map(msg => ({
                role: msg.role,
                content: msg.content
            }))
        };

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
                        // Remove the failed message from history
                        this.conversationHistory.pop();

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
                        const assistantMessage = response.content
                            .filter(block => block.type === 'text')
                            .map(block => block.text)
                            .join('');

                        // Add assistant response to history
                        this.conversationHistory.push({ role: 'assistant', content: assistantMessage });

                        resolve(assistantMessage);
                    } catch (error) {
                        this.conversationHistory.pop();
                        reject(new Error(`Failed to parse Claude response: ${error}`));
                    }
                });
            });

            req.on('error', (error) => {
                this.conversationHistory.pop();
                reject(new Error(`Network error: ${error.message}`));
            });

            req.write(JSON.stringify(requestBody));
            req.end();
        });
    }

    /**
     * Stream a message response chunk by chunk
     */
    async streamMessage(
        message: string,
        onChunk: (chunk: string) => void,
        context?: BrowserContext
    ): Promise<void> {
        if (!this.apiKey) {
            throw new Error('ANTHROPIC_API_KEY not configured. Please set the environment variable.');
        }

        // Add user message to history
        this.conversationHistory.push({ role: 'user', content: message });

        const requestBody: ClaudeRequestBody = {
            model: this.model,
            max_tokens: MAX_TOKENS,
            system: this.buildSystemPrompt(context),
            messages: this.conversationHistory.map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            stream: true
        };

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

            let fullResponse = '';
            let buffer = '';

            const req = https.request(options, (res) => {
                if (res.statusCode !== 200) {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        this.conversationHistory.pop();
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
                    });
                    return;
                }

                res.on('data', (chunk) => {
                    buffer += chunk.toString();

                    // Process complete SSE events
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const jsonStr = line.slice(6);
                            if (jsonStr === '[DONE]') {
                                continue;
                            }

                            try {
                                const event: ClaudeStreamEvent = JSON.parse(jsonStr);

                                if (event.type === 'content_block_delta' && event.delta?.text) {
                                    fullResponse += event.delta.text;
                                    onChunk(event.delta.text);
                                } else if (event.type === 'error') {
                                    this.conversationHistory.pop();
                                    reject(new Error(event.error?.message || 'Stream error'));
                                    return;
                                }
                            } catch (e) {
                                // Skip malformed JSON lines
                            }
                        }
                    }
                });

                res.on('end', () => {
                    // Process any remaining buffer
                    if (buffer.startsWith('data: ')) {
                        const jsonStr = buffer.slice(6);
                        if (jsonStr !== '[DONE]') {
                            try {
                                const event: ClaudeStreamEvent = JSON.parse(jsonStr);
                                if (event.type === 'content_block_delta' && event.delta?.text) {
                                    fullResponse += event.delta.text;
                                    onChunk(event.delta.text);
                                }
                            } catch (e) {
                                // Skip malformed JSON
                            }
                        }
                    }

                    // Add complete response to history
                    if (fullResponse) {
                        this.conversationHistory.push({ role: 'assistant', content: fullResponse });
                    }
                    resolve();
                });
            });

            req.on('error', (error) => {
                this.conversationHistory.pop();
                reject(new Error(`Network error: ${error.message}`));
            });

            req.write(JSON.stringify(requestBody));
            req.end();
        });
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
