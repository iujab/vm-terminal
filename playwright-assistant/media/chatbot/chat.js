(function() {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    let isWaitingForResponse = false;
    let currentStreamingMessage = null;
    let streamingText = '';

    // Restore previous state if any
    const previousState = vscode.getState();
    if (previousState && previousState.messages) {
        previousState.messages.forEach(msg => {
            addMessageToUI(msg.text, msg.isUser, msg.isError, false);
        });
    } else {
        // Show welcome message
        showWelcomeMessage();
    }

    function showWelcomeMessage() {
        const welcome = document.createElement('div');
        welcome.className = 'welcome-message';
        welcome.innerHTML = `
            <h3>Browser Automation Assistant</h3>
            <p>Ask questions about the page or request browser automation help.</p>
        `;
        messagesContainer.appendChild(welcome);
    }

    function addMessageToUI(text, isUser, isError = false, save = true) {
        // Remove welcome message if present
        const welcome = messagesContainer.querySelector('.welcome-message');
        if (welcome) {
            welcome.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user' : 'assistant'}${isError ? ' error' : ''}`;

        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.textContent = text;
        messageDiv.appendChild(textDiv);

        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageDiv.appendChild(timeDiv);

        messagesContainer.appendChild(messageDiv);
        scrollToBottom();

        // Save state
        if (save) {
            saveState();
        }

        return messageDiv;
    }

    function createStreamingMessage() {
        // Remove welcome message if present
        const welcome = messagesContainer.querySelector('.welcome-message');
        if (welcome) {
            welcome.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant streaming';

        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.textContent = '';
        messageDiv.appendChild(textDiv);

        // Add cursor indicator for streaming
        const cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        cursor.textContent = '|';
        textDiv.appendChild(cursor);

        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageDiv.appendChild(timeDiv);

        messagesContainer.appendChild(messageDiv);
        scrollToBottom();

        return messageDiv;
    }

    function updateStreamingMessage(messageDiv, text) {
        const textDiv = messageDiv.querySelector('.message-text');
        if (textDiv) {
            // Preserve the cursor
            const cursor = textDiv.querySelector('.streaming-cursor');
            textDiv.textContent = text;
            if (cursor) {
                textDiv.appendChild(cursor);
            }
        }
        scrollToBottom();
    }

    function finalizeStreamingMessage(messageDiv, text) {
        const textDiv = messageDiv.querySelector('.message-text');
        if (textDiv) {
            // Remove cursor and set final text
            textDiv.textContent = text;
        }
        messageDiv.classList.remove('streaming');
        saveState();
    }

    function showTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.id = 'typing-indicator';
        indicator.innerHTML = '<span></span><span></span><span></span>';
        messagesContainer.appendChild(indicator);
        scrollToBottom();
    }

    function hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function saveState() {
        const messages = [];
        messagesContainer.querySelectorAll('.message').forEach(msg => {
            const textEl = msg.querySelector('.message-text');
            if (textEl) {
                messages.push({
                    text: textEl.textContent,
                    isUser: msg.classList.contains('user'),
                    isError: msg.classList.contains('error')
                });
            }
        });
        vscode.setState({ messages });
    }

    function sendMessage() {
        const text = messageInput.value.trim();
        if (!text || isWaitingForResponse) {
            return;
        }

        // Add user message to UI
        addMessageToUI(text, true);
        messageInput.value = '';
        autoResizeInput();

        // Show typing indicator (will be replaced by streaming message)
        showTypingIndicator();
        isWaitingForResponse = true;
        sendBtn.disabled = true;

        // Send to extension with streaming enabled
        vscode.postMessage({
            type: 'sendMessage',
            text: text,
            useStreaming: CONFIG.enableStreaming !== false
        });
    }

    function cancelStream() {
        vscode.postMessage({
            type: 'cancelStream'
        });
    }

    function autoResizeInput() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    }

    // Event listeners
    sendBtn.addEventListener('click', sendMessage);

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
        // Allow Escape to cancel streaming
        if (e.key === 'Escape' && isWaitingForResponse) {
            cancelStream();
        }
    });

    messageInput.addEventListener('input', autoResizeInput);

    // Handle messages from the extension
    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'streamStart':
                // Start streaming - replace typing indicator with streaming message
                hideTypingIndicator();
                streamingText = '';
                currentStreamingMessage = createStreamingMessage();
                break;

            case 'streamChunk':
                // Add chunk to streaming message
                if (currentStreamingMessage && message.content) {
                    streamingText += message.content;
                    updateStreamingMessage(currentStreamingMessage, streamingText);
                }
                break;

            case 'streamEnd':
                // Finalize streaming message
                if (currentStreamingMessage) {
                    finalizeStreamingMessage(currentStreamingMessage, streamingText);
                    currentStreamingMessage = null;
                    streamingText = '';
                }
                hideTypingIndicator();
                isWaitingForResponse = false;
                sendBtn.disabled = false;

                if (message.cancelled) {
                    // Optionally show that streaming was cancelled
                    console.log('Stream cancelled by user');
                }
                break;

            case 'receiveMessage':
                // Non-streaming or error message
                hideTypingIndicator();

                // If we have a streaming message in progress, finalize it first
                if (currentStreamingMessage) {
                    finalizeStreamingMessage(currentStreamingMessage, streamingText);
                    currentStreamingMessage = null;
                    streamingText = '';
                }

                isWaitingForResponse = false;
                sendBtn.disabled = false;
                addMessageToUI(message.text, message.isUser, message.isError);
                break;

            case 'clearChat':
                messagesContainer.innerHTML = '';
                vscode.setState({ messages: [] });
                currentStreamingMessage = null;
                streamingText = '';
                isWaitingForResponse = false;
                sendBtn.disabled = false;
                showWelcomeMessage();

                // Also clear server-side history
                vscode.postMessage({ type: 'clearHistory' });
                break;

            case 'receiveAnnotatedScreenshot':
                // Receive an annotated screenshot from the Playwright viewer
                addAnnotatedScreenshotToUI(message.image, message.annotationCount);
                break;

            case 'addImageMessage':
                // Add an image message to the chat
                addImageMessageToUI(message.image, message.caption);
                break;
        }
    });

    /**
     * Add an annotated screenshot to the chat UI
     * @param {string} imageData Base64 encoded image data
     * @param {number} annotationCount Number of annotations
     */
    function addAnnotatedScreenshotToUI(imageData, annotationCount) {
        // Remove welcome message if present
        const welcome = messagesContainer.querySelector('.welcome-message');
        if (welcome) {
            welcome.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user image-message';

        // Create image container
        const imageContainer = document.createElement('div');
        imageContainer.className = 'message-image-container';

        const img = document.createElement('img');
        img.src = imageData;
        img.alt = 'Annotated Screenshot';
        img.className = 'message-image';
        img.onclick = () => {
            // Open image in a new window or expand view
            const newWindow = window.open();
            if (newWindow) {
                newWindow.document.write('<img src="' + imageData + '" style="max-width: 100%; height: auto;">');
                newWindow.document.title = 'Annotated Screenshot';
            }
        };
        imageContainer.appendChild(img);

        // Add annotation count badge
        if (annotationCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'annotation-badge';
            badge.textContent = annotationCount + ' annotation' + (annotationCount !== 1 ? 's' : '');
            imageContainer.appendChild(badge);
        }

        messageDiv.appendChild(imageContainer);

        // Add caption
        const captionDiv = document.createElement('div');
        captionDiv.className = 'message-text';
        captionDiv.textContent = 'Annotated Screenshot';
        messageDiv.appendChild(captionDiv);

        // Add timestamp
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageDiv.appendChild(timeDiv);

        messagesContainer.appendChild(messageDiv);
        scrollToBottom();
        saveState();

        // Automatically ask AI about the screenshot
        const promptText = 'I\'ve shared an annotated screenshot. Please analyze the highlighted areas and help me understand what I\'m pointing at or how to interact with these elements.';
        vscode.postMessage({
            type: 'sendMessage',
            text: promptText,
            useStreaming: CONFIG.enableStreaming !== false
        });

        // Show typing indicator
        showTypingIndicator();
        isWaitingForResponse = true;
        sendBtn.disabled = true;
    }

    /**
     * Add an image message to the chat UI
     * @param {string} imageData Base64 encoded image data
     * @param {string} caption Caption for the image
     */
    function addImageMessageToUI(imageData, caption) {
        // Remove welcome message if present
        const welcome = messagesContainer.querySelector('.welcome-message');
        if (welcome) {
            welcome.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user image-message';

        // Create image container
        const imageContainer = document.createElement('div');
        imageContainer.className = 'message-image-container';

        const img = document.createElement('img');
        img.src = imageData;
        img.alt = caption || 'Screenshot';
        img.className = 'message-image';
        imageContainer.appendChild(img);
        messageDiv.appendChild(imageContainer);

        // Add caption if provided
        if (caption) {
            const captionDiv = document.createElement('div');
            captionDiv.className = 'message-text';
            captionDiv.textContent = caption;
            messageDiv.appendChild(captionDiv);
        }

        // Add timestamp
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageDiv.appendChild(timeDiv);

        messagesContainer.appendChild(messageDiv);
        scrollToBottom();
        saveState();
    }

    // Initialize
    vscode.postMessage({ type: 'ready' });
})();
