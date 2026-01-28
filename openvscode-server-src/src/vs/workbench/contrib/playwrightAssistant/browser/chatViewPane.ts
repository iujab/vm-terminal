/*---------------------------------------------------------------------------------------------
 *  Playwright Chat View Pane - Chat interface for AI assistant
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IAnnotation } from '../common/playwrightAssistant.js';

interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: number;
	isError?: boolean;
	imageData?: string;
}

interface StreamingMessage {
	type: 'chunk' | 'done' | 'error';
	content?: string;
	error?: string;
}

export class PlaywrightChatViewPane extends ViewPane {

	static readonly ID = 'playwrightAssistant.chat';

	private _container?: HTMLElement;
	private _messagesContainer?: HTMLElement;
	private _inputArea?: HTMLElement;
	private _messageInput?: HTMLTextAreaElement;
	private _sendButton?: HTMLButtonElement;

	private readonly _viewDisposables = this._register(new DisposableStore());
	private _messages: ChatMessage[] = [];
	private _abortController?: AbortController;
	private _isStreaming = false;
	private _currentStreamingMessage?: HTMLElement;

	// Events
	private readonly _onMessageSent = this._register(new Emitter<string>());
	readonly onMessageSent = this._onMessageSent.event;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService override readonly configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = container;
		this._container.classList.add('playwright-chat');

		// Messages container
		this._messagesContainer = $('div.chat-messages');
		this._container.appendChild(this._messagesContainer);

		// Input area
		this._inputArea = $('div.chat-input-area');

		this._messageInput = $('textarea.chat-input') as HTMLTextAreaElement;
		this._messageInput.placeholder = 'Type a message...';
		this._messageInput.rows = 1;

		this._viewDisposables.add(addDisposableListener(this._messageInput, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this._sendMessage();
			}
		}));

		this._viewDisposables.add(addDisposableListener(this._messageInput, 'input', () => {
			this._autoResizeInput();
		}));

		this._inputArea.appendChild(this._messageInput);

		this._sendButton = $('button.chat-send-btn') as HTMLButtonElement;
		this._sendButton.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
		</svg>`;
		this._sendButton.title = 'Send message';

		this._viewDisposables.add(addDisposableListener(this._sendButton, EventType.CLICK, () => {
			this._sendMessage();
		}));

		this._inputArea.appendChild(this._sendButton);
		this._container.appendChild(this._inputArea);

		// Add welcome message
		this._addMessage({
			role: 'assistant',
			content: 'Hello! I\'m your Playwright assistant. I can help you navigate and interact with the browser. Ask me anything!',
			timestamp: Date.now()
		});
	}

	private _autoResizeInput(): void {
		if (this._messageInput) {
			this._messageInput.style.height = 'auto';
			this._messageInput.style.height = Math.min(this._messageInput.scrollHeight, 150) + 'px';
		}
	}

	private async _sendMessage(): Promise<void> {
		if (!this._messageInput || this._isStreaming) {
			return;
		}

		const text = this._messageInput.value.trim();
		if (!text) {
			return;
		}

		// Add user message
		this._addMessage({
			role: 'user',
			content: text,
			timestamp: Date.now()
		});

		this._messageInput.value = '';
		this._autoResizeInput();
		this._onMessageSent.fire(text);

		// Send to API
		await this._handleStreamingMessage(text);
	}

	private _getChatApiUrl(): string {
		return this.configurationService.getValue<string>('playwrightAssistant.chatApiUrl') || 'http://localhost:8766/chat';
	}

	private async _handleStreamingMessage(text: string): Promise<void> {
		this._isStreaming = true;
		this._abortController = new AbortController();

		// Create streaming message placeholder
		this._currentStreamingMessage = this._createMessageElement('assistant', '');
		this._messagesContainer?.appendChild(this._currentStreamingMessage);
		this._scrollToBottom();

		try {
			const response = await fetch(this._getChatApiUrl(), {
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
			let fullContent = '';

			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });

				// Process complete SSE events
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const jsonStr = line.slice(6);
						try {
							const event: StreamingMessage = JSON.parse(jsonStr);

							if (event.type === 'chunk' && event.content) {
								fullContent += event.content;
								this._updateStreamingMessage(fullContent);
							} else if (event.type === 'done') {
								this._finishStreamingMessage(fullContent);
							} else if (event.type === 'error') {
								this._showError(event.error || 'Unknown error');
							}
						} catch {
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
						fullContent += event.content;
						this._updateStreamingMessage(fullContent);
					}
				} catch {
					// Skip malformed JSON
				}
			}

			this._finishStreamingMessage(fullContent);

		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				// Stream was cancelled by user
				return;
			}

			console.error('Chat API streaming error:', error);
			this._showError(`Could not connect to chat server. ${error}`);
		} finally {
			this._isStreaming = false;
			this._abortController = undefined;
		}
	}

	private _updateStreamingMessage(content: string): void {
		if (this._currentStreamingMessage) {
			const contentEl = this._currentStreamingMessage.querySelector('.message-content');
			if (contentEl) {
				contentEl.textContent = content;
			}
			this._scrollToBottom();
		}
	}

	private _finishStreamingMessage(content: string): void {
		if (this._currentStreamingMessage) {
			const contentEl = this._currentStreamingMessage.querySelector('.message-content');
			if (contentEl) {
				contentEl.innerHTML = this._formatMessage(content);
			}
			this._currentStreamingMessage = undefined;
		}

		// Add to messages array
		this._messages.push({
			role: 'assistant',
			content,
			timestamp: Date.now()
		});
	}

	private _showError(message: string): void {
		if (this._currentStreamingMessage) {
			this._currentStreamingMessage.remove();
			this._currentStreamingMessage = undefined;
		}

		this._addMessage({
			role: 'assistant',
			content: `Error: ${message}`,
			timestamp: Date.now(),
			isError: true
		});
	}

	private _addMessage(message: ChatMessage): void {
		this._messages.push(message);

		const messageEl = this._createMessageElement(message.role, message.content, message.isError, message.imageData);
		this._messagesContainer?.appendChild(messageEl);
		this._scrollToBottom();
	}

	private _createMessageElement(role: string, content: string, isError?: boolean, imageData?: string): HTMLElement {
		const messageEl = $(`div.chat-message.${role}${isError ? '.error' : ''}`);

		if (imageData) {
			const img = $('img.message-image') as HTMLImageElement;
			img.src = `data:image/png;base64,${imageData}`;
			img.alt = 'Screenshot';
			messageEl.appendChild(img);
		}

		const contentEl = $('div.message-content');
		contentEl.innerHTML = content ? this._formatMessage(content) : '';
		messageEl.appendChild(contentEl);

		return messageEl;
	}

	private _formatMessage(content: string): string {
		// Basic markdown-like formatting
		return content
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.*?)\*/g, '<em>$1</em>')
			.replace(/`([^`]+)`/g, '<code>$1</code>')
			.replace(/\n/g, '<br>');
	}

	private _scrollToBottom(): void {
		if (this._messagesContainer) {
			this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
		}
	}

	cancelStream(): void {
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = undefined;
		}
	}

	async clearHistory(): Promise<void> {
		const chatApiUrl = this._getChatApiUrl();
		const clearUrl = chatApiUrl.replace(/\/chat$/, '/chat/clear');

		try {
			await fetch(clearUrl, { method: 'POST' });
		} catch (error) {
			console.error('Failed to clear history:', error);
		}

		this._messages = [];
		if (this._messagesContainer) {
			this._messagesContainer.innerHTML = '';
		}
	}

	receiveAnnotatedScreenshot(imageData: string, annotations: IAnnotation[]): void {
		this._addMessage({
			role: 'user',
			content: `[Annotated screenshot with ${annotations.length} annotation(s)]`,
			timestamp: Date.now(),
			imageData
		});
	}

	addImageMessage(imageData: string, caption?: string): void {
		this._addMessage({
			role: 'user',
			content: caption || 'Screenshot',
			timestamp: Date.now(),
			imageData
		});
	}
}
