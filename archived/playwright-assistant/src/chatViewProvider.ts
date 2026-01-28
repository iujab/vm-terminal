import * as vscode from 'vscode';

interface StreamingMessage {
    type: 'chunk' | 'done' | 'error';
    content?: string;
    error?: string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'chatbotPanel';
    private _view?: vscode.WebviewView;
    private _abortController?: AbortController;

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
                case 'sendMessage':
                    await this._handleSendMessage(message.text, message.useStreaming !== false);
                    break;
                case 'cancelStream':
                    this._cancelStream();
                    break;
                case 'clearHistory':
                    await this._clearHistory();
                    break;
                case 'ready':
                    console.log('Chat panel ready');
                    break;
                case 'error':
                    vscode.window.showErrorMessage(`Chat: ${message.message}`);
                    break;
            }
        });
    }

    public clearChat() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'clearChat' });
        }
        this._clearHistory();
    }

    /**
     * Receive an annotated screenshot from the Playwright viewer and display it in chat
     * @param imageData Base64 encoded image data
     * @param annotations Array of annotations applied to the screenshot
     */
    public receiveAnnotatedScreenshot(imageData: string, annotations: Array<{ type: string; [key: string]: unknown }>) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'receiveAnnotatedScreenshot',
                image: imageData,
                annotationCount: annotations.length
            });
        }
    }

    /**
     * Add an image message to the chat (for display purposes)
     * @param imageData Base64 encoded image data
     * @param caption Optional caption for the image
     */
    public addImageMessage(imageData: string, caption?: string) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'addImageMessage',
                image: imageData,
                caption: caption || 'Annotated Screenshot'
            });
        }
    }

    private _cancelStream() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = undefined;
        }
    }

    private async _clearHistory() {
        const config = vscode.workspace.getConfiguration('playwrightAssistant');
        const baseUrl = config.get<string>('chatApiUrl', 'http://localhost:8766/chat');
        const clearUrl = baseUrl.replace(/\/chat$/, '/chat/clear');

        try {
            await fetch(clearUrl, { method: 'POST' });
        } catch (error) {
            console.error('Failed to clear history:', error);
        }
    }

    private async _handleSendMessage(text: string, useStreaming: boolean = true) {
        console.log(`Chat message: ${text}, streaming: ${useStreaming}`);

        const config = vscode.workspace.getConfiguration('playwrightAssistant');
        const chatApiUrl = config.get<string>('chatApiUrl', 'http://localhost:8766/chat');

        if (useStreaming) {
            await this._handleStreamingMessage(text, chatApiUrl);
        } else {
            await this._handleNonStreamingMessage(text, chatApiUrl);
        }
    }

    private async _handleStreamingMessage(text: string, chatApiUrl: string) {
        // Cancel any existing stream
        this._cancelStream();
        this._abortController = new AbortController();

        try {
            // Notify webview that streaming is starting
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'streamStart'
                });
            }

            const response = await fetch(chatApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message: text, stream: true }),
                signal: this._abortController.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            if (!response.body) {
                throw new Error('No response body for streaming');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                // Process complete SSE events
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6);
                        try {
                            const event: StreamingMessage = JSON.parse(jsonStr);

                            if (event.type === 'chunk' && event.content) {
                                if (this._view) {
                                    this._view.webview.postMessage({
                                        type: 'streamChunk',
                                        content: event.content
                                    });
                                }
                            } else if (event.type === 'done') {
                                if (this._view) {
                                    this._view.webview.postMessage({
                                        type: 'streamEnd'
                                    });
                                }
                            } else if (event.type === 'error') {
                                if (this._view) {
                                    this._view.webview.postMessage({
                                        type: 'receiveMessage',
                                        text: `Error: ${event.error}`,
                                        isUser: false,
                                        isError: true
                                    });
                                }
                            }
                        } catch (e) {
                            // Skip malformed JSON
                        }
                    }
                }
            }

            // Process any remaining buffer
            if (buffer.startsWith('data: ')) {
                const jsonStr = buffer.slice(6);
                try {
                    const event: StreamingMessage = JSON.parse(jsonStr);
                    if (event.type === 'chunk' && event.content) {
                        if (this._view) {
                            this._view.webview.postMessage({
                                type: 'streamChunk',
                                content: event.content
                            });
                        }
                    }
                } catch (e) {
                    // Skip malformed JSON
                }
            }

            // Ensure stream end is sent
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'streamEnd'
                });
            }

        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                // Stream was cancelled by user
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'streamEnd',
                        cancelled: true
                    });
                }
                return;
            }

            console.error('Chat API streaming error:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'receiveMessage',
                    text: `Error: Could not connect to chat server. ${error}`,
                    isUser: false,
                    isError: true
                });
            }
        } finally {
            this._abortController = undefined;
        }
    }

    private async _handleNonStreamingMessage(text: string, chatApiUrl: string) {
        try {
            const response = await fetch(chatApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message: text, stream: false })
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json() as { response?: string; error?: string };

            if (data.error) {
                throw new Error(data.error);
            }

            if (this._view) {
                this._view.webview.postMessage({
                    type: 'receiveMessage',
                    text: data.response || 'No response',
                    isUser: false
                });
            }
        } catch (error) {
            console.error('Chat API error:', error);
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'receiveMessage',
                    text: `Error: Could not connect to chat server. ${error}`,
                    isUser: false,
                    isError: true
                });
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const config = vscode.workspace.getConfiguration('playwrightAssistant');
        const chatApiUrl = config.get<string>('chatApiUrl', 'http://localhost:8766/chat');

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'chatbot', 'chat.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'chatbot', 'chat.js')
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src http://localhost:* https://localhost:*;">
    <link href="${styleUri}" rel="stylesheet">
    <title>Chat</title>
</head>
<body>
    <div id="chat-container">
        <div id="messages"></div>
        <div id="input-area">
            <textarea id="message-input" placeholder="Type a message..." rows="1"></textarea>
            <button id="send-btn" title="Send message">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                </svg>
            </button>
        </div>
    </div>
    <script nonce="${nonce}">
        const CONFIG = {
            chatApiUrl: "${chatApiUrl}",
            enableStreaming: true
        };
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
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
