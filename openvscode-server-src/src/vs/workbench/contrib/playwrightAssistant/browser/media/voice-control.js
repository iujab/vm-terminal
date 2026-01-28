/**
 * Voice Control Module for Playwright Assistant
 * Uses Web Speech API for voice recognition and synthesis
 */
(function() {
    'use strict';

    // Check for Web Speech API support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;

    if (!SpeechRecognition) {
        console.warn('Voice Control: Speech Recognition API not supported in this browser');
        return;
    }

    // Voice control state
    let recognition = null;
    let isListening = false;
    let isEnabled = false;
    let lastTranscript = '';
    let interimTranscript = '';
    let speechSynthesis = window.speechSynthesis;
    let audioFeedbackEnabled = true;

    // Command aliases and variations
    const commandAliases = {
        click: ['click', 'press', 'tap', 'select', 'hit'],
        type: ['type', 'write', 'enter', 'input'],
        goto: ['go to', 'navigate to', 'open', 'visit', 'load'],
        scroll: ['scroll', 'move'],
        back: ['go back', 'back', 'previous', 'previous page'],
        forward: ['go forward', 'forward', 'next', 'next page'],
        refresh: ['refresh', 'reload', 'refresh page', 'reload page'],
        newTab: ['new tab', 'open tab', 'open new tab', 'create tab'],
        closeTab: ['close tab', 'close this tab', 'close current tab'],
        screenshot: ['take screenshot', 'screenshot', 'capture', 'capture screen', 'take a screenshot'],
        startRecording: ['start recording', 'begin recording', 'record'],
        stopRecording: ['stop recording', 'end recording', 'stop record'],
        search: ['search for', 'search', 'find', 'look for'],
        stop: ['stop', 'cancel', 'stop listening', 'never mind']
    };

    // Scroll direction mappings
    const scrollDirections = {
        up: { deltaX: 0, deltaY: -300 },
        down: { deltaX: 0, deltaY: 300 },
        left: { deltaX: -300, deltaY: 0 },
        right: { deltaX: 300, deltaY: 0 },
        top: { deltaX: 0, deltaY: -99999 },
        bottom: { deltaX: 0, deltaY: 99999 }
    };

    // DOM elements (initialized in init())
    let voiceButton = null;
    let voiceIndicator = null;
    let voiceStatus = null;
    let voiceFeedback = null;
    let voiceTranscript = null;
    let voiceCommand = null;

    /**
     * Initialize the voice recognition system
     */
    function init() {
        // Get DOM elements
        voiceButton = document.getElementById('voice-control-btn');
        voiceIndicator = document.getElementById('voice-indicator');
        voiceStatus = document.getElementById('voice-status');
        voiceFeedback = document.getElementById('voice-feedback');
        voiceTranscript = document.getElementById('voice-transcript');
        voiceCommand = document.getElementById('voice-command');

        if (!voiceButton) {
            console.warn('Voice Control: UI elements not found');
            return;
        }

        // Set up recognition
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 3;

        // Set up grammar if supported
        if (SpeechGrammarList) {
            const grammarList = new SpeechGrammarList();
            const commands = Object.values(commandAliases).flat().join(' | ');
            const grammar = `#JSGF V1.0; grammar commands; public <command> = ${commands};`;
            grammarList.addFromString(grammar, 1);
            recognition.grammars = grammarList;
        }

        // Event handlers
        recognition.onstart = handleRecognitionStart;
        recognition.onend = handleRecognitionEnd;
        recognition.onresult = handleRecognitionResult;
        recognition.onerror = handleRecognitionError;
        recognition.onspeechstart = handleSpeechStart;
        recognition.onspeechend = handleSpeechEnd;

        // Button click handler
        voiceButton.addEventListener('click', toggleVoiceControl);

        // Keyboard shortcut (Ctrl+Shift+V)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'V') {
                e.preventDefault();
                toggleVoiceControl();
            }
        });

        // Update UI to show voice control is available
        voiceButton.disabled = false;
        voiceButton.title = 'Toggle voice control (Ctrl+Shift+V)';

        console.log('Voice Control: Initialized successfully');
    }

    /**
     * Toggle voice control on/off
     */
    function toggleVoiceControl() {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    }

    /**
     * Start voice recognition
     */
    function startListening() {
        if (!recognition || isListening) return;

        try {
            recognition.start();
            isEnabled = true;
        } catch (error) {
            console.error('Voice Control: Failed to start recognition', error);
            showFeedback('Failed to start voice recognition', 'error');
        }
    }

    /**
     * Stop voice recognition
     */
    function stopListening() {
        if (!recognition || !isListening) return;

        try {
            recognition.stop();
            isEnabled = false;
        } catch (error) {
            console.error('Voice Control: Failed to stop recognition', error);
        }
    }

    /**
     * Handle recognition start
     */
    function handleRecognitionStart() {
        isListening = true;
        updateUI('listening');
        showFeedback('Listening...', 'info');

        if (audioFeedbackEnabled) {
            playBeep(440, 100); // Start beep
        }
    }

    /**
     * Handle recognition end
     */
    function handleRecognitionEnd() {
        isListening = false;

        if (isEnabled) {
            // Auto-restart if still enabled
            setTimeout(() => {
                if (isEnabled && !isListening) {
                    try {
                        recognition.start();
                    } catch (e) {
                        // Ignore - might already be starting
                    }
                }
            }, 100);
        } else {
            updateUI('idle');
            showFeedback('Voice control stopped', 'info');

            if (audioFeedbackEnabled) {
                playBeep(330, 100); // Stop beep
            }
        }
    }

    /**
     * Handle speech start
     */
    function handleSpeechStart() {
        updateUI('speaking');
    }

    /**
     * Handle speech end
     */
    function handleSpeechEnd() {
        if (isListening) {
            updateUI('listening');
        }
    }

    /**
     * Handle recognition results
     */
    function handleRecognitionResult(event) {
        interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;

            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Update transcript display
        if (voiceTranscript) {
            const displayText = finalTranscript || interimTranscript;
            voiceTranscript.textContent = displayText;
        }

        // Process final transcript
        if (finalTranscript) {
            lastTranscript = finalTranscript.trim().toLowerCase();
            processVoiceCommand(lastTranscript);
        }
    }

    /**
     * Handle recognition errors
     */
    function handleRecognitionError(event) {
        console.error('Voice Control: Recognition error', event.error);

        let message = 'Voice recognition error';
        switch (event.error) {
            case 'no-speech':
                message = 'No speech detected. Try again.';
                break;
            case 'audio-capture':
                message = 'No microphone found. Please check your settings.';
                break;
            case 'not-allowed':
                message = 'Microphone access denied. Please allow microphone access.';
                isEnabled = false;
                break;
            case 'network':
                message = 'Network error. Please check your connection.';
                break;
        }

        showFeedback(message, 'error');

        if (event.error === 'not-allowed') {
            updateUI('disabled');
        }
    }

    /**
     * Process a voice command
     */
    function processVoiceCommand(text) {
        console.log('Voice Control: Processing command:', text);

        // Parse the command
        const parsed = parseCommand(text);

        if (!parsed) {
            showFeedback(`"${text}" - Command not recognized`, 'warning');
            sendToBackend({
                type: 'voiceCommand',
                text: text,
                needsInterpretation: true
            });
            return;
        }

        // Display the interpreted command
        if (voiceCommand) {
            voiceCommand.textContent = `${parsed.action}: ${parsed.target || parsed.value || ''}`;
        }

        // Execute the command
        executeCommand(parsed);
    }

    /**
     * Parse natural language command into action
     */
    function parseCommand(text) {
        const normalizedText = text.toLowerCase().trim();

        // Check for stop command first
        if (matchesCommand(normalizedText, 'stop')) {
            return { action: 'stop' };
        }

        // Click command: "click [element]" or "press [element]"
        for (const alias of commandAliases.click) {
            if (normalizedText.startsWith(alias + ' ')) {
                const target = normalizedText.slice(alias.length + 1).trim();
                return { action: 'click', target: target };
            }
            if (normalizedText === alias) {
                return { action: 'click', target: '' };
            }
        }

        // Type command: "type [text]"
        for (const alias of commandAliases.type) {
            if (normalizedText.startsWith(alias + ' ')) {
                const value = normalizedText.slice(alias.length + 1).trim();
                return { action: 'type', value: value };
            }
        }

        // Navigate command: "go to [url]"
        for (const alias of commandAliases.goto) {
            if (normalizedText.startsWith(alias + ' ')) {
                let url = normalizedText.slice(alias.length + 1).trim();
                url = normalizeUrl(url);
                return { action: 'navigate', value: url };
            }
        }

        // Scroll commands
        for (const alias of commandAliases.scroll) {
            if (normalizedText.startsWith(alias + ' ')) {
                const direction = normalizedText.slice(alias.length + 1).trim();
                const scrollData = scrollDirections[direction];
                if (scrollData) {
                    return { action: 'scroll', ...scrollData, direction: direction };
                }
            }
        }

        // Navigation commands
        if (matchesCommand(normalizedText, 'back')) {
            return { action: 'back' };
        }
        if (matchesCommand(normalizedText, 'forward')) {
            return { action: 'forward' };
        }
        if (matchesCommand(normalizedText, 'refresh')) {
            return { action: 'refresh' };
        }

        // Tab commands
        if (matchesCommand(normalizedText, 'newTab')) {
            return { action: 'newTab' };
        }
        if (matchesCommand(normalizedText, 'closeTab')) {
            return { action: 'closeTab' };
        }

        // Screenshot command
        if (matchesCommand(normalizedText, 'screenshot')) {
            return { action: 'screenshot' };
        }

        // Recording commands
        if (matchesCommand(normalizedText, 'startRecording')) {
            return { action: 'startRecording' };
        }
        if (matchesCommand(normalizedText, 'stopRecording')) {
            return { action: 'stopRecording' };
        }

        // Search command
        for (const alias of commandAliases.search) {
            if (normalizedText.startsWith(alias + ' ')) {
                const query = normalizedText.slice(alias.length + 1).trim();
                return { action: 'search', value: query };
            }
        }

        // No match found
        return null;
    }

    /**
     * Check if text matches any alias for a command
     */
    function matchesCommand(text, commandKey) {
        const aliases = commandAliases[commandKey];
        if (!aliases) return false;

        return aliases.some(alias => {
            // Exact match
            if (text === alias) return true;
            // Starts with alias (for commands that might have trailing words)
            if (text.startsWith(alias) && (text.length === alias.length || text[alias.length] === ' ')) {
                return true;
            }
            return false;
        });
    }

    /**
     * Normalize a URL from voice input
     */
    function normalizeUrl(text) {
        // Handle common spoken URL patterns
        text = text.replace(/\s+/g, '');
        text = text.replace(/dot\s*/gi, '.');
        text = text.replace(/slash\s*/gi, '/');
        text = text.replace(/colon\s*/gi, ':');

        // Add protocol if missing
        if (!text.startsWith('http://') && !text.startsWith('https://')) {
            text = 'https://' + text;
        }

        // Handle common domains
        text = text.replace(/\.com$/i, '.com');
        text = text.replace(/\.org$/i, '.org');
        text = text.replace(/\.net$/i, '.net');
        text = text.replace(/\.io$/i, '.io');

        return text;
    }

    /**
     * Execute a parsed command
     */
    function executeCommand(command) {
        console.log('Voice Control: Executing command:', command);

        switch (command.action) {
            case 'stop':
                stopListening();
                break;

            case 'click':
                if (command.target) {
                    // Send to backend to find and click element
                    sendToBackend({
                        type: 'voiceCommand',
                        action: 'click',
                        target: command.target
                    });
                    showFeedback(`Clicking "${command.target}"...`, 'info');
                } else {
                    showFeedback('Please specify what to click', 'warning');
                }
                break;

            case 'type':
                if (command.value) {
                    sendAction({ type: 'type', text: command.value });
                    showFeedback(`Typing: "${command.value}"`, 'info');
                }
                break;

            case 'navigate':
                if (command.value) {
                    sendAction({ type: 'navigate', url: command.value });
                    showFeedback(`Navigating to ${command.value}`, 'info');
                }
                break;

            case 'scroll':
                sendAction({
                    type: 'scroll',
                    deltaX: command.deltaX,
                    deltaY: command.deltaY
                });
                showFeedback(`Scrolling ${command.direction}`, 'info');
                break;

            case 'back':
                sendAction({ type: 'back' });
                showFeedback('Going back', 'info');
                break;

            case 'forward':
                sendAction({ type: 'forward' });
                showFeedback('Going forward', 'info');
                break;

            case 'refresh':
                sendAction({ type: 'reload' });
                showFeedback('Refreshing page', 'info');
                break;

            case 'newTab':
                sendAction({ type: 'newTab' });
                showFeedback('Opening new tab', 'info');
                break;

            case 'closeTab':
                sendAction({ type: 'closeTab' });
                showFeedback('Closing tab', 'info');
                break;

            case 'screenshot':
                sendAction({ type: 'screenshot', save: true });
                showFeedback('Taking screenshot', 'info');
                break;

            case 'startRecording':
                sendToBackend({ type: 'startRecording' });
                showFeedback('Starting recording', 'info');
                break;

            case 'stopRecording':
                sendToBackend({ type: 'stopRecording' });
                showFeedback('Stopping recording', 'info');
                break;

            case 'search':
                if (command.value) {
                    sendToBackend({
                        type: 'voiceCommand',
                        action: 'search',
                        value: command.value
                    });
                    showFeedback(`Searching for "${command.value}"`, 'info');
                }
                break;

            default:
                showFeedback(`Unknown action: ${command.action}`, 'error');
        }
    }

    /**
     * Send action to the Playwright relay server
     */
    function sendAction(action) {
        // Use the global sendAction from viewer.js if available
        if (typeof window.sendPlaywrightAction === 'function') {
            window.sendPlaywrightAction(action);
        } else if (typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(action));
        } else {
            console.warn('Voice Control: No connection to send action');
            showFeedback('Not connected to browser', 'error');
        }
    }

    /**
     * Send to backend for AI processing
     */
    function sendToBackend(data) {
        // Use the global sendAction with voiceCommand type
        if (typeof window.sendPlaywrightAction === 'function') {
            window.sendPlaywrightAction(data);
        } else if (typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    /**
     * Update UI based on state
     */
    function updateUI(state) {
        if (!voiceButton || !voiceIndicator) return;

        voiceButton.classList.remove('listening', 'speaking', 'disabled');
        voiceIndicator.classList.remove('active', 'speaking', 'pulse');

        switch (state) {
            case 'listening':
                voiceButton.classList.add('listening');
                voiceIndicator.classList.add('active', 'pulse');
                voiceButton.setAttribute('aria-label', 'Stop voice control');
                if (voiceStatus) voiceStatus.textContent = 'Listening';
                break;

            case 'speaking':
                voiceButton.classList.add('listening', 'speaking');
                voiceIndicator.classList.add('active', 'speaking');
                voiceButton.setAttribute('aria-label', 'Processing speech');
                if (voiceStatus) voiceStatus.textContent = 'Processing';
                break;

            case 'disabled':
                voiceButton.classList.add('disabled');
                voiceButton.disabled = true;
                voiceButton.setAttribute('aria-label', 'Voice control unavailable');
                if (voiceStatus) voiceStatus.textContent = 'Unavailable';
                break;

            default: // idle
                voiceButton.setAttribute('aria-label', 'Start voice control');
                if (voiceStatus) voiceStatus.textContent = '';
        }
    }

    /**
     * Show feedback message
     */
    function showFeedback(message, type = 'info') {
        if (!voiceFeedback) return;

        voiceFeedback.textContent = message;
        voiceFeedback.className = 'voice-feedback ' + type;
        voiceFeedback.classList.add('visible');

        // Auto-hide after delay (except for errors)
        if (type !== 'error') {
            setTimeout(() => {
                voiceFeedback.classList.remove('visible');
            }, 3000);
        }
    }

    /**
     * Speak text using text-to-speech
     */
    function speak(text) {
        if (!speechSynthesis || !audioFeedbackEnabled) return;

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.1;
        utterance.pitch = 1;
        utterance.volume = 0.8;

        speechSynthesis.speak(utterance);
    }

    /**
     * Play a simple beep sound
     */
    function playBeep(frequency, duration) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = frequency;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + duration / 1000);
        } catch (e) {
            // Audio not available, ignore
        }
    }

    /**
     * Handle voice command results from backend
     */
    function handleVoiceCommandResult(result) {
        if (result.success) {
            showFeedback(result.message || `${result.action} completed`, 'success');
            if (audioFeedbackEnabled && result.speak) {
                speak(result.speak);
            }
        } else {
            showFeedback(result.message || 'Command failed', 'error');
        }

        // Update command display
        if (voiceCommand && result.interpretation) {
            voiceCommand.textContent = result.interpretation;
        }
    }

    /**
     * Handle element found result
     */
    function handleElementFound(result) {
        if (result.found) {
            showFeedback(`Found: ${result.element}`, 'success');
        } else {
            showFeedback(`Could not find: ${result.description}`, 'warning');
            if (result.suggestions && result.suggestions.length > 0) {
                const suggestText = `Did you mean: ${result.suggestions.join(', ')}?`;
                showFeedback(suggestText, 'info');
            }
        }
    }

    // Export for external use
    window.VoiceControl = {
        init: init,
        toggle: toggleVoiceControl,
        start: startListening,
        stop: stopListening,
        isListening: () => isListening,
        handleResult: handleVoiceCommandResult,
        handleElementFound: handleElementFound,
        setAudioFeedback: (enabled) => { audioFeedbackEnabled = enabled; }
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
