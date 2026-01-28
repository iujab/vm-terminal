(function() {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const screenshot = document.getElementById('screenshot');
    const clickOverlay = document.getElementById('click-overlay');
    const loading = document.getElementById('loading');
    const connectionStatus = document.getElementById('connection-status');
    const reconnectBtn = document.getElementById('reconnect-btn');
    const typeInput = document.getElementById('type-input');
    const vncContainer = document.getElementById('vnc-container');
    const modeToggle = document.getElementById('mode-toggle');
    const inspectorToggle = document.getElementById('inspector-toggle');
    const inspectorHighlight = document.getElementById('inspector-highlight');
    const inspectorTooltip = document.getElementById('inspector-tooltip');

    // Annotation elements
    const annotationCanvas = document.getElementById('annotation-canvas');
    const annotationToolbar = document.getElementById('annotation-toolbar');
    const annotateBtn = document.getElementById('annotate-btn');

    // Tab bar elements
    const tabBar = document.getElementById('tab-bar');
    const tabsContainer = document.getElementById('tabs-container');
    const newTabBtn = document.getElementById('new-tab-btn');
    const tabContextMenu = document.getElementById('tab-context-menu');

    // Control bar elements
    const controlIndicator = document.getElementById('control-indicator');
    const activeController = document.getElementById('active-controller');
    const lockIndicator = document.getElementById('lock-indicator');
    const queueIndicator = document.getElementById('queue-indicator');
    const controlModeSelect = document.getElementById('control-mode-select');
    const requestControlBtn = document.getElementById('request-control-btn');
    const releaseControlBtn = document.getElementById('release-control-btn');
    const actionIndicator = document.getElementById('action-indicator');
    const lastActionInfo = document.getElementById('last-action-info');

    let ws = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const reconnectDelay = 2000;

    // Mode: 'screenshot' or 'vnc'
    let currentMode = 'screenshot';

    // Inspector mode
    let inspectorMode = false;
    let lastInspectTime = 0;
    const INSPECT_THROTTLE_MS = 100;
    let currentElementInfo = null;

    // Annotation mode
    let annotationMode = false;

    // noVNC integration (if available)
    let rfb = null;

    // Tab management state
    let tabs = [];
    let activeTabId = null;
    let contextMenuTabId = null;

    // Bidirectional control state
    let controlState = {
        mode: 'shared',
        lockedBy: null,
        lockExpiry: null,
        activeController: null,
        queueLength: 0,
        lastAction: null
    };
    let userCanControl = true;
    let actionIndicatorTimeout = null;

    // Recording state
    let recordingState = {
        isRecording: false,
        isPlaying: false,
        isPaused: false,
        recordingId: null,
        recordingStartTime: null,
        selectedRecordingId: null,
        recordings: []
    };
    let recordingTimerInterval = null;

    // Recording elements
    const recordBtn = document.getElementById('record-btn');
    const recordingPanel = document.getElementById('recording-panel');
    const recordingPanelClose = document.getElementById('recording-panel-close');
    const recordingIndicator = document.getElementById('recording-indicator');
    const recordingTime = document.getElementById('recording-time');
    const recordingNameInput = document.getElementById('recording-name');
    const startRecordingBtn = document.getElementById('start-recording-btn');
    const stopRecordingBtn = document.getElementById('stop-recording-btn');
    const playbackControls = document.getElementById('playback-controls');
    const playbackProgressBar = document.getElementById('playback-progress-bar');
    const playbackAction = document.getElementById('playback-action');
    const playbackTotal = document.getElementById('playback-total');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const stopPlaybackBtn = document.getElementById('stop-playback-btn');
    const stepBtn = document.getElementById('step-btn');
    const playbackSpeedSelect = document.getElementById('playback-speed');
    const refreshRecordingsBtn = document.getElementById('refresh-recordings-btn');
    const recordingsList = document.getElementById('recordings-list');
    const exportOptions = document.getElementById('export-options');
    const exportFormat = document.getElementById('export-format');
    const exportBtn = document.getElementById('export-btn');
    const exportOutput = document.getElementById('export-output');
    const copyExportBtn = document.getElementById('copy-export-btn');

    function setConnectionStatus(status) {
        connectionStatus.className = status;
        connectionStatus.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }

    function connect() {
        if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
            return;
        }

        setConnectionStatus('connecting');

        try {
            ws = new WebSocket(CONFIG.relayServerUrl);

            ws.onopen = () => {
                console.log('Connected to Playwright server');
                setConnectionStatus('connected');
                loading.classList.add('hidden');
                reconnectAttempts = 0;

                // Expose WebSocket globally for collaboration module
                window._playwrightWs = ws;
                // Expose vscode for collaboration module
                window.vscode = vscode;

                // Request initial screenshot and tab list
                ws.send(JSON.stringify({ type: 'screenshot' }));
                ws.send(JSON.stringify({ type: 'listTabs' }));
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                } catch (e) {
                    console.error('Failed to parse message:', e);
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                vscode.postMessage({ type: 'error', message: 'Connection error' });
            };

            ws.onclose = () => {
                console.log('Disconnected from Playwright server');
                setConnectionStatus('disconnected');
                loading.classList.remove('hidden');
                loading.querySelector('span').textContent = 'Disconnected. Reconnecting...';

                // Auto-reconnect
                if (reconnectAttempts < maxReconnectAttempts) {
                    reconnectAttempts++;
                    setTimeout(connect, reconnectDelay);
                } else {
                    loading.querySelector('span').textContent = 'Connection failed. Click Reconnect.';
                }
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            setConnectionStatus('disconnected');
        }
    }

    function handleMessage(data) {
        switch (data.type) {
            case 'screenshot':
                if (currentMode === 'screenshot' && data.image) {
                    // Only update if from active tab or no tabId specified
                    if (!data.tabId || data.tabId === activeTabId) {
                        screenshot.src = 'data:image/png;base64,' + data.image;
                    }
                }
                break;

            case 'snapshot':
                console.log('Received snapshot:', data.content);
                vscode.postMessage({ type: 'snapshot', content: data.content, tabId: data.tabId });
                break;

            case 'tabs':
                updateTabs(data.tabs, data.activeTabId);
                break;

            case 'tabCreated':
                if (data.tab) {
                    tabs.push(data.tab);
                    activeTabId = data.tab.id;
                    renderTabs();
                    vscode.postMessage({ type: 'tabCreated', tab: data.tab });
                }
                break;

            case 'tabClosed':
                if (data.tabId) {
                    tabs = tabs.filter(t => t.id !== data.tabId);
                    if (activeTabId === data.tabId && tabs.length > 0) {
                        activeTabId = tabs[0].id;
                    }
                    renderTabs();
                    vscode.postMessage({ type: 'tabClosed', tabId: data.tabId });
                }
                break;

            case 'tabChanged':
                if (data.activeTabId) {
                    activeTabId = data.activeTabId;
                    tabs = tabs.map(t => ({
                        ...t,
                        isActive: t.id === activeTabId
                    }));
                    renderTabs();
                    vscode.postMessage({ type: 'tabChanged', tabId: data.activeTabId });
                }
                break;

            case 'event':
                console.log('Browser event:', data.event, data.data);
                vscode.postMessage({ type: 'browserEvent', event: data.event, data: data.data, tabId: data.tabId });
                break;

            case 'result':
                console.log('Action result:', data);
                break;

            case 'error':
                console.error('Server error:', data.message);
                vscode.postMessage({ type: 'error', message: data.message });
                break;

            case 'inspectResult':
                if (data.element) {
                    currentElementInfo = data.element;
                    showInspectorHighlight(data.element);
                    showInspectorTooltip(data.element);
                } else {
                    hideInspectorOverlay();
                }
                break;

            case 'inspectorMode':
                inspectorMode = data.enabled;
                updateInspectorModeUI();
                break;

            case 'voiceCommandResult':
                // Forward voice command result to voice control module
                if (window.VoiceControl && window.VoiceControl.handleResult) {
                    window.VoiceControl.handleResult(data);
                }
                break;

            case 'elementFound':
                // Forward element found result to voice control module
                if (window.VoiceControl && window.VoiceControl.handleElementFound) {
                    window.VoiceControl.handleElementFound(data);
                }
                break;

            // Bidirectional control messages
            case 'controlState':
                if (data.state) {
                    updateControlState(data.state);
                }
                break;

            case 'controlGrant':
                showControlNotification('Control granted to ' + data.to, 'info');
                break;

            case 'actionQueued':
                showControlNotification('Action queued (ID: ' + data.actionId + ')', 'info');
                break;

            case 'actionComplete':
                if (!data.success && data.message) {
                    showControlNotification('Action failed: ' + data.message, 'error');
                }
                break;

            case 'actionResult':
                if (data.message) {
                    var source = data.message.toLowerCase().includes('ai') ? 'ai' : 'user';
                    showActionIndicator(data.message, source);
                }
                break;

            // Recording messages
            case 'recordingStatus':
                handleRecordingStatus(data);
                break;

            case 'recordingsList':
                handleRecordingsList(data.recordings || []);
                break;

            case 'recordingEvent':
                handleRecordingEvent(data);
                break;

            case 'playbackEvent':
                handlePlaybackEvent(data);
                break;

            case 'exportResult':
                handleExportResult(data);
                break;

            default:
                // Check if this is a collaboration message
                if (window.PlaywrightCollaboration && window.PlaywrightCollaboration.handleMessage) {
                    window.PlaywrightCollaboration.handleMessage(data);
                }
                break;
        }
    }

    // ========================================
    // Session Recording Functions
    // ========================================

    function handleRecordingStatus(data) {
        recordingState.isRecording = data.isRecording || false;
        recordingState.isPlaying = data.isPlaying || false;
        recordingState.isPaused = data.isPaused || false;
        recordingState.recordingId = data.recordingId || null;
        updateRecordingUI();
    }

    function handleRecordingEvent(data) {
        if (data.message && data.message.includes('recordingStarted')) {
            recordingState.isRecording = true;
            recordingState.recordingId = data.recordingId;
            recordingState.recordingStartTime = Date.now();
            startRecordingTimer();
        } else if (data.message && data.message.includes('recordingStopped')) {
            recordingState.isRecording = false;
            stopRecordingTimer();
            refreshRecordings();
        }
        updateRecordingUI();
    }

    function handlePlaybackEvent(data) {
        recordingState.isPlaying = data.isPlaying || false;
        recordingState.isPaused = data.isPaused || false;

        if (data.playbackProgress !== undefined && playbackProgressBar) {
            playbackProgressBar.style.width = data.playbackProgress + '%';
        }
        if (data.currentAction !== undefined && playbackAction) {
            playbackAction.textContent = data.currentAction;
        }
        if (data.totalActions !== undefined && playbackTotal) {
            playbackTotal.textContent = data.totalActions;
        }

        updatePlaybackUI();
    }

    function handleRecordingsList(recordings) {
        recordingState.recordings = recordings;
        renderRecordingsList(recordings);
    }

    function handleExportResult(data) {
        if (data.success && data.exportedCode && exportOutput) {
            exportOutput.value = data.exportedCode;
            if (exportOptions) exportOptions.classList.remove('hidden');
        } else if (!data.success) {
            vscode.postMessage({ type: 'error', message: 'Export failed: ' + (data.message || 'Unknown error') });
        }
    }

    function updateRecordingUI() {
        if (recordBtn) {
            recordBtn.classList.toggle('recording', recordingState.isRecording);
        }
        if (recordingIndicator) {
            recordingIndicator.classList.toggle('hidden', !recordingState.isRecording);
        }
        if (startRecordingBtn) {
            startRecordingBtn.classList.toggle('hidden', recordingState.isRecording);
        }
        if (stopRecordingBtn) {
            stopRecordingBtn.classList.toggle('hidden', !recordingState.isRecording);
        }
        if (playbackControls) {
            playbackControls.classList.toggle('hidden', !recordingState.selectedRecordingId && !recordingState.isPlaying);
        }
    }

    function updatePlaybackUI() {
        if (playBtn) playBtn.classList.toggle('hidden', recordingState.isPlaying && !recordingState.isPaused);
        if (pauseBtn) pauseBtn.classList.toggle('hidden', !recordingState.isPlaying || recordingState.isPaused);
        document.body.classList.toggle('playback-active', recordingState.isPlaying && !recordingState.isPaused);
    }

    function startRecordingTimer() {
        if (recordingTimerInterval) clearInterval(recordingTimerInterval);
        recordingState.recordingStartTime = Date.now();
        updateRecordingTime();
        recordingTimerInterval = setInterval(updateRecordingTime, 1000);
    }

    function stopRecordingTimer() {
        if (recordingTimerInterval) {
            clearInterval(recordingTimerInterval);
            recordingTimerInterval = null;
        }
        if (recordingTime) recordingTime.textContent = '00:00';
    }

    function updateRecordingTime() {
        if (!recordingState.recordingStartTime || !recordingTime) return;
        var elapsed = Math.floor((Date.now() - recordingState.recordingStartTime) / 1000);
        var minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        var seconds = (elapsed % 60).toString().padStart(2, '0');
        recordingTime.textContent = minutes + ':' + seconds;
    }

    function renderRecordingsList(recordings) {
        if (!recordingsList) return;
        if (!recordings || recordings.length === 0) {
            recordingsList.innerHTML = '<div class="no-recordings">No recordings yet</div>';
            return;
        }
        recordingsList.innerHTML = recordings.map(function(rec) {
            var date = new Date(rec.startTime).toLocaleDateString();
            var duration = rec.duration ? formatDuration(rec.duration) : 'Unknown';
            var isSelected = rec.id === recordingState.selectedRecordingId;
            return '<div class="recording-item' + (isSelected ? ' selected' : '') + '" data-id="' + rec.id + '">' +
                '<div class="recording-info">' +
                '<div class="recording-name">' + escapeHtml(rec.name) + '</div>' +
                '<div class="recording-meta">' +
                '<span>' + date + '</span>' +
                '<span>' + rec.actionCount + ' actions</span>' +
                '<span>' + duration + '</span>' +
                '</div></div>' +
                '<div class="recording-actions">' +
                '<button class="play-rec-btn" title="Play">&#9654;</button>' +
                '<button class="export-rec-btn" title="Export">&#128190;</button>' +
                '<button class="delete-btn" title="Delete">&#10005;</button>' +
                '</div></div>';
        }).join('');

        recordingsList.querySelectorAll('.recording-item').forEach(function(item) {
            var id = item.getAttribute('data-id');
            item.addEventListener('click', function(e) {
                if (!e.target.closest('button')) selectRecording(id);
            });
            var playRecBtn = item.querySelector('.play-rec-btn');
            if (playRecBtn) playRecBtn.addEventListener('click', function(e) { e.stopPropagation(); playRecording(id); });
            var exportRecBtn = item.querySelector('.export-rec-btn');
            if (exportRecBtn) exportRecBtn.addEventListener('click', function(e) { e.stopPropagation(); selectRecording(id); if (exportOptions) exportOptions.classList.remove('hidden'); });
            var deleteRecBtn = item.querySelector('.delete-btn');
            if (deleteRecBtn) deleteRecBtn.addEventListener('click', function(e) { e.stopPropagation(); deleteRecording(id); });
        });
    }

    function selectRecording(id) {
        recordingState.selectedRecordingId = id;
        renderRecordingsList(recordingState.recordings);
        if (playbackControls) playbackControls.classList.remove('hidden');
    }

    function startRecording() {
        var name = (recordingNameInput && recordingNameInput.value.trim()) || 'Recording ' + new Date().toLocaleString();
        sendAction({ type: 'startRecording', name: name });
    }

    function stopRecording() {
        sendAction({ type: 'stopRecording' });
    }

    function playRecording(id) {
        var speed = playbackSpeedSelect ? parseFloat(playbackSpeedSelect.value) : 1;
        sendAction({ type: 'playRecording', recordingId: id || recordingState.selectedRecordingId, speed: speed });
    }

    function pausePlayback() { sendAction({ type: 'pausePlayback' }); }
    function resumePlayback() { sendAction({ type: 'resumePlayback' }); }
    function stopPlayback() { sendAction({ type: 'stopPlayback' }); }
    function stepForward() { sendAction({ type: 'stepForward' }); }

    function deleteRecording(id) {
        if (confirm('Delete this recording?')) {
            sendAction({ type: 'deleteRecording', recordingId: id });
            setTimeout(refreshRecordings, 300);
        }
    }

    function exportRecording() {
        if (!recordingState.selectedRecordingId || !exportFormat) return;
        sendAction({ type: 'exportRecording', recordingId: recordingState.selectedRecordingId, format: exportFormat.value });
    }

    function refreshRecordings() { sendAction({ type: 'listRecordings' }); }

    function formatDuration(ms) {
        var seconds = Math.floor(ms / 1000);
        var minutes = Math.floor(seconds / 60);
        seconds = seconds % 60;
        return minutes + ':' + seconds.toString().padStart(2, '0');
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ========================================
    // Bidirectional Control Functions
    // ========================================

    function updateControlState(state) {
        controlState = state;

        // Update mode indicator
        if (controlIndicator) {
            controlIndicator.className = 'mode-' + state.mode;
            controlIndicator.textContent = formatModeName(state.mode);
        }

        // Update active controller badge
        if (activeController) {
            if (state.activeController) {
                activeController.className = 'controller-' + state.activeController;
                activeController.textContent = state.activeController.toUpperCase() + ' active';
            } else {
                activeController.className = 'controller-none';
                activeController.textContent = 'Idle';
            }
        }

        // Update lock indicator
        if (lockIndicator) {
            if (state.lockedBy) {
                lockIndicator.classList.add('locked');
                lockIndicator.textContent = 'Locked by ' + state.lockedBy;
            } else {
                lockIndicator.classList.remove('locked');
            }
        }

        // Update queue indicator
        if (queueIndicator) {
            if (state.queueLength > 0) {
                queueIndicator.classList.add('has-queue');
                queueIndicator.textContent = state.queueLength + ' queued';
            } else {
                queueIndicator.classList.remove('has-queue');
            }
        }

        // Update mode selector
        if (controlModeSelect && controlModeSelect.value !== state.mode) {
            controlModeSelect.value = state.mode;
        }

        // Update last action info
        if (lastActionInfo && state.lastAction) {
            var time = formatTime(state.lastAction.timestamp);
            lastActionInfo.innerHTML =
                '<span class="action-source ' + state.lastAction.source + '">' +
                state.lastAction.source + '</span>: ' +
                state.lastAction.type + ' <span class="action-time">(' + time + ')</span>';
        }

        // Check if user can control
        userCanControl = canUserControl(state);
        updateControlOverlay();

        // Update control buttons
        updateControlButtons(state);
    }

    function formatModeName(mode) {
        var names = {
            'shared': 'Shared',
            'user-only': 'User Only',
            'ai-only': 'AI Only',
            'locked': 'Locked'
        };
        return names[mode] || mode;
    }

    function formatTime(timestamp) {
        var now = Date.now();
        var diff = now - timestamp;
        if (diff < 1000) return 'just now';
        if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        return new Date(timestamp).toLocaleTimeString();
    }

    function canUserControl(state) {
        if (state.mode === 'locked') return false;
        if (state.mode === 'ai-only') return false;
        if (state.lockedBy === 'ai') return false;
        return true;
    }

    function updateControlOverlay() {
        if (clickOverlay) {
            if (userCanControl) {
                clickOverlay.classList.remove('control-disabled');
            } else {
                clickOverlay.classList.add('control-disabled');
            }
        }
    }

    function updateControlButtons(state) {
        if (requestControlBtn) {
            requestControlBtn.disabled = state.lockedBy === 'user';
        }
        if (releaseControlBtn) {
            releaseControlBtn.disabled = state.lockedBy !== 'user';
        }
    }

    function showActionIndicator(message, source) {
        if (!actionIndicator) return;

        // Clear any existing timeout
        if (actionIndicatorTimeout) {
            clearTimeout(actionIndicatorTimeout);
        }

        actionIndicator.textContent = message;
        actionIndicator.className = 'visible source-' + source;

        // Auto-hide after 2 seconds
        actionIndicatorTimeout = setTimeout(function() {
            actionIndicator.classList.remove('visible');
        }, 2000);
    }

    function showControlNotification(message, type) {
        // Create notification element
        var notification = document.createElement('div');
        notification.className = 'control-notification ' + type;
        notification.textContent = message;
        document.body.appendChild(notification);

        // Auto-remove after 3 seconds
        setTimeout(function() {
            notification.style.opacity = '0';
            setTimeout(function() { notification.remove(); }, 300);
        }, 3000);
    }

    function requestControlLock() {
        sendAction({ type: 'controlRequest', source: 'user' });
    }

    function releaseControlLock() {
        sendAction({ type: 'controlRelease', source: 'user' });
    }

    function setControlMode(mode) {
        sendAction({ type: 'setControlMode', mode: mode, source: 'user' });
    }

    function showClickRippleWithSource(x, y, source) {
        var ripple = document.createElement('div');
        ripple.className = 'click-ripple ' + source + '-action';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        clickOverlay.appendChild(ripple);
        setTimeout(function() { ripple.remove(); }, 400);
    }

    // Expose control functions globally
    window.requestControlLock = requestControlLock;
    window.releaseControlLock = releaseControlLock;
    window.setControlMode = setControlMode;

    // Set up control bar event listeners
    if (controlModeSelect) {
        controlModeSelect.addEventListener('change', function(e) {
            setControlMode(e.target.value);
        });
    }

    if (requestControlBtn) {
        requestControlBtn.addEventListener('click', requestControlLock);
    }

    if (releaseControlBtn) {
        releaseControlBtn.addEventListener('click', releaseControlLock);
    }

    // ========================================
    // Tab Management Functions
    // ========================================

    function updateTabs(newTabs, newActiveTabId) {
        tabs = newTabs || [];
        activeTabId = newActiveTabId || (tabs.length > 0 ? tabs[0].id : null);
        renderTabs();
        vscode.postMessage({ type: 'tabsUpdated', tabs: tabs, activeTabId: activeTabId });
    }

    function renderTabs() {
        if (!tabsContainer) return;

        tabsContainer.innerHTML = '';

        tabs.forEach(tab => {
            const tabEl = document.createElement('div');
            tabEl.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
            tabEl.dataset.tabId = tab.id;

            // Favicon
            const favicon = document.createElement('img');
            favicon.className = 'tab-favicon';
            if (tab.favicon) {
                favicon.src = tab.favicon;
                favicon.onerror = () => {
                    favicon.classList.add('default');
                    favicon.src = '';
                };
            } else {
                favicon.classList.add('default');
            }
            tabEl.appendChild(favicon);

            // Title
            const title = document.createElement('span');
            title.className = 'tab-title';
            title.textContent = tab.title || 'New Tab';
            title.title = tab.url || '';
            tabEl.appendChild(title);

            // Close button
            const closeBtn = document.createElement('button');
            closeBtn.className = 'tab-close';
            closeBtn.title = 'Close tab';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(tab.id);
            });
            tabEl.appendChild(closeBtn);

            // Click to switch tab
            tabEl.addEventListener('click', () => {
                switchToTab(tab.id);
            });

            // Right-click for context menu
            tabEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showTabContextMenu(e.clientX, e.clientY, tab.id);
            });

            // Middle-click to close
            tabEl.addEventListener('auxclick', (e) => {
                if (e.button === 1) { // Middle click
                    e.preventDefault();
                    closeTab(tab.id);
                }
            });

            tabsContainer.appendChild(tabEl);
        });
    }

    function switchToTab(tabId) {
        if (tabId === activeTabId) return;
        sendAction({ type: 'switchTab', tabId });
    }

    function createNewTab(url) {
        sendAction({ type: 'newTab', url });
    }

    function closeTab(tabId) {
        if (tabs.length <= 1) {
            vscode.postMessage({ type: 'info', message: 'Cannot close the last tab' });
            return;
        }
        sendAction({ type: 'closeTab', tabId });
    }

    function duplicateTab(tabId) {
        const tab = tabs.find(t => t.id === tabId);
        if (tab && tab.url) {
            createNewTab(tab.url);
        }
    }

    function closeOtherTabs(keepTabId) {
        tabs.forEach(tab => {
            if (tab.id !== keepTabId) {
                sendAction({ type: 'closeTab', tabId: tab.id });
            }
        });
    }

    function closeTabsToRight(tabId) {
        const index = tabs.findIndex(t => t.id === tabId);
        if (index === -1) return;

        for (let i = tabs.length - 1; i > index; i--) {
            sendAction({ type: 'closeTab', tabId: tabs[i].id });
        }
    }

    // Tab context menu
    function showTabContextMenu(x, y, tabId) {
        if (!tabContextMenu) return;

        contextMenuTabId = tabId;

        // Position the context menu
        tabContextMenu.style.left = x + 'px';
        tabContextMenu.style.top = y + 'px';
        tabContextMenu.classList.add('visible');

        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!tabContextMenu.contains(e.target)) {
                tabContextMenu.classList.remove('visible');
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    }

    function hideTabContextMenu() {
        if (tabContextMenu) {
            tabContextMenu.classList.remove('visible');
        }
    }

    // New tab button
    if (newTabBtn) {
        newTabBtn.addEventListener('click', () => {
            createNewTab();
        });
    }

    // Tab context menu items
    if (tabContextMenu) {
        tabContextMenu.addEventListener('click', (e) => {
            const target = e.target;
            if (!target.classList.contains('context-menu-item')) return;

            const action = target.dataset.action;
            if (!action || !contextMenuTabId) return;

            switch (action) {
                case 'close':
                    closeTab(contextMenuTabId);
                    break;
                case 'close-others':
                    closeOtherTabs(contextMenuTabId);
                    break;
                case 'close-right':
                    closeTabsToRight(contextMenuTabId);
                    break;
                case 'duplicate':
                    duplicateTab(contextMenuTabId);
                    break;
                case 'reload':
                    if (contextMenuTabId === activeTabId) {
                        sendAction({ type: 'reload' });
                    }
                    break;
            }

            hideTabContextMenu();
        });
    }

    // Expose tab functions globally
    window.tabManager = {
        getTabs: () => tabs,
        getActiveTab: () => tabs.find(t => t.id === activeTabId),
        getActiveTabId: () => activeTabId,
        switchToTab,
        createNewTab,
        closeTab,
        duplicateTab,
        closeOtherTabs
    };

    function sendAction(action) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(action));
        } else {
            vscode.postMessage({ type: 'error', message: 'Not connected to server' });
        }
    }

    // Expose sendAction globally for voice control module
    window.sendPlaywrightAction = sendAction;

    // Click handling with coordinate translation
    clickOverlay.addEventListener('click', (e) => {
        if (currentMode !== 'screenshot') return;

        const rect = screenshot.getBoundingClientRect();
        const overlayRect = clickOverlay.getBoundingClientRect();

        // Calculate position relative to the screenshot
        const imgX = e.clientX - rect.left;
        const imgY = e.clientY - rect.top;

        // Only process clicks that are on the screenshot
        if (imgX < 0 || imgY < 0 || imgX > rect.width || imgY > rect.height) {
            return;
        }

        // Scale to actual screenshot dimensions
        const scaleX = screenshot.naturalWidth / rect.width;
        const scaleY = screenshot.naturalHeight / rect.height;
        const x = Math.round(imgX * scaleX);
        const y = Math.round(imgY * scaleY);

        // In inspector mode, copy selector instead of clicking
        if (inspectorMode && currentElementInfo) {
            copySelector(currentElementInfo.bestSelector || currentElementInfo.selectors.css);
            return;
        }

        // Visual feedback - ripple effect
        showClickRipple(e.clientX - overlayRect.left, e.clientY - overlayRect.top);

        // Record action if recording is active
        if (window.recordBrowserAction && window.isRecordingActive && window.isRecordingActive()) {
            window.recordBrowserAction({
                type: 'click',
                x,
                y,
                element: currentElementInfo || null
            });
        }

        // Send click to server
        sendAction({ type: 'click', x, y });
        vscode.postMessage({ type: 'click', x, y });
    });

    // Double-click handling
    clickOverlay.addEventListener('dblclick', (e) => {
        if (currentMode !== 'screenshot') return;

        const rect = screenshot.getBoundingClientRect();
        const imgX = e.clientX - rect.left;
        const imgY = e.clientY - rect.top;

        if (imgX < 0 || imgY < 0 || imgX > rect.width || imgY > rect.height) {
            return;
        }

        const scaleX = screenshot.naturalWidth / rect.width;
        const scaleY = screenshot.naturalHeight / rect.height;
        const x = Math.round(imgX * scaleX);
        const y = Math.round(imgY * scaleY);

        // Record action if recording is active
        if (window.recordBrowserAction && window.isRecordingActive && window.isRecordingActive()) {
            window.recordBrowserAction({
                type: 'dblclick',
                x,
                y,
                element: currentElementInfo || null
            });
        }

        sendAction({ type: 'dblclick', x, y });
    });

    // Hover handling (for DOM inspector feature)
    clickOverlay.addEventListener('mousemove', (e) => {
        if (currentMode !== 'screenshot') return;

        const rect = screenshot.getBoundingClientRect();
        const imgX = e.clientX - rect.left;
        const imgY = e.clientY - rect.top;

        if (imgX < 0 || imgY < 0 || imgX > rect.width || imgY > rect.height) {
            if (inspectorMode) {
                hideInspectorOverlay();
            }
            return;
        }

        const scaleX = screenshot.naturalWidth / rect.width;
        const scaleY = screenshot.naturalHeight / rect.height;
        const x = Math.round(imgX * scaleX);
        const y = Math.round(imgY * scaleY);

        // Inspector mode: request element info
        if (inspectorMode) {
            throttledInspect(x, y, e.clientX, e.clientY);
            return;
        }

        // Regular hover tracking
        if (CONFIG.enableHoverTracking) {
            throttledHover(x, y);
        }

        // Track cursor for collaboration
        if (window.PlaywrightCollaboration && window.PlaywrightCollaboration.trackCursor) {
            window.PlaywrightCollaboration.trackCursor(x, y);
        }
    });

    // Mouse leave - hide inspector overlay
    clickOverlay.addEventListener('mouseleave', () => {
        if (inspectorMode) {
            hideInspectorOverlay();
        }
    });

    // Throttle hover events
    let hoverTimeout = null;
    function throttledHover(x, y) {
        if (hoverTimeout) return;
        hoverTimeout = setTimeout(() => {
            sendAction({ type: 'hover', x, y });
            hoverTimeout = null;
        }, 100);
    }

    // Throttled inspect for inspector mode
    function throttledInspect(x, y, clientX, clientY) {
        const now = Date.now();
        if (now - lastInspectTime < INSPECT_THROTTLE_MS) {
            return;
        }
        lastInspectTime = now;

        // Store mouse position for tooltip placement
        window._lastInspectClientX = clientX;
        window._lastInspectClientY = clientY;

        sendAction({ type: 'inspect', x, y });
    }

    // Scroll handling
    clickOverlay.addEventListener('wheel', (e) => {
        e.preventDefault();
        const deltaX = e.deltaX;
        const deltaY = e.deltaY;

        // Record action if recording is active (throttled to avoid too many scroll events)
        if (window.recordBrowserAction && window.isRecordingActive && window.isRecordingActive()) {
            if (!window._lastScrollRecordTime || Date.now() - window._lastScrollRecordTime > 300) {
                window.recordBrowserAction({
                    type: 'scroll',
                    deltaX,
                    deltaY
                });
                window._lastScrollRecordTime = Date.now();
            }
        }

        sendAction({ type: 'scroll', deltaX, deltaY });
        vscode.postMessage({ type: 'scroll', deltaX, deltaY });
    }, { passive: false });

    // Type input handling
    typeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = typeInput.value.trim();
            if (text) {
                // Record action if recording is active
                if (window.recordBrowserAction && window.isRecordingActive && window.isRecordingActive()) {
                    window.recordBrowserAction({
                        type: 'fill',
                        text
                    });
                }

                sendAction({ type: 'type', text });
                vscode.postMessage({ type: 'type', text });
                typeInput.value = '';
            }
        }
    });

    // Special key handling in input
    typeInput.addEventListener('keydown', (e) => {
        // Forward special keys
        const specialKeys = ['Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'];
        if (e.ctrlKey || e.altKey || e.metaKey || specialKeys.includes(e.key)) {
            if (e.key !== 'Enter') {
                let key = e.key;
                if (e.ctrlKey) key = 'Control+' + key;
                if (e.altKey) key = 'Alt+' + key;
                if (e.shiftKey) key = 'Shift+' + key;
                if (e.metaKey) key = 'Meta+' + key;
                sendAction({ type: 'press', key });
            }
        }
    });

    // Reconnect button
    reconnectBtn.addEventListener('click', () => {
        reconnectAttempts = 0;
        if (ws) {
            ws.close();
        }
        connect();
    });

    // Mode toggle (if VNC is available)
    if (modeToggle) {
        modeToggle.addEventListener('click', () => {
            toggleMode();
        });
    }

    // Inspector mode toggle
    if (inspectorToggle) {
        inspectorToggle.addEventListener('click', () => {
            toggleInspectorMode();
        });
    }

    // Annotation mode toggle
    if (annotateBtn) {
        annotateBtn.addEventListener('click', () => {
            toggleAnnotationMode();
        });
    }

    function toggleAnnotationMode() {
        annotationMode = !annotationMode;

        if (annotateBtn) {
            annotateBtn.classList.toggle('active', annotationMode);
        }

        if (annotationToolbar) {
            annotationToolbar.classList.toggle('hidden', !annotationMode);
        }

        if (annotationCanvas) {
            annotationCanvas.classList.toggle('active', annotationMode);
        }

        if (clickOverlay) {
            clickOverlay.style.pointerEvents = annotationMode ? 'none' : 'auto';
        }

        // Initialize annotation manager if entering annotation mode
        if (annotationMode && window.annotationManager) {
            window.annotationManager.isAnnotationMode = true;
            window.annotationManager.updateCursor();
        } else if (window.annotationManager) {
            window.annotationManager.isAnnotationMode = false;
        }

        // Disable inspector mode when entering annotation mode
        if (annotationMode && inspectorMode) {
            toggleInspectorMode();
        }
    }

    // Expose sendWebSocketMessage for annotation module
    window.sendWebSocketMessage = function(message) {
        sendAction(message);
    };

    function toggleInspectorMode() {
        inspectorMode = !inspectorMode;
        sendAction({ type: 'setInspectorMode', enabled: inspectorMode });
        updateInspectorModeUI();
    }

    function updateInspectorModeUI() {
        if (inspectorToggle) {
            inspectorToggle.classList.toggle('active', inspectorMode);
            inspectorToggle.title = inspectorMode ? 'Disable Inspector' : 'Enable Inspector';
        }

        if (clickOverlay) {
            clickOverlay.classList.toggle('inspector-mode', inspectorMode);
        }

        if (!inspectorMode) {
            hideInspectorOverlay();
        }
    }

    function showInspectorHighlight(elementInfo) {
        if (!inspectorHighlight || !elementInfo || !elementInfo.boundingBox) {
            return;
        }

        const rect = screenshot.getBoundingClientRect();
        const scaleX = rect.width / screenshot.naturalWidth;
        const scaleY = rect.height / screenshot.naturalHeight;

        const box = elementInfo.boundingBox;

        // Position highlight relative to screenshot
        const left = rect.left + (box.x * scaleX);
        const top = rect.top + (box.y * scaleY);
        const width = box.width * scaleX;
        const height = box.height * scaleY;

        inspectorHighlight.style.left = left + 'px';
        inspectorHighlight.style.top = top + 'px';
        inspectorHighlight.style.width = width + 'px';
        inspectorHighlight.style.height = height + 'px';
        inspectorHighlight.style.display = 'block';
    }

    function showInspectorTooltip(elementInfo) {
        if (!inspectorTooltip || !elementInfo) {
            return;
        }

        // Build tooltip content
        let content = '<div class="inspector-tooltip-header">';
        content += '<span class="tag-name">' + elementInfo.tagName + '</span>';

        if (elementInfo.id) {
            content += '<span class="element-id">#' + elementInfo.id + '</span>';
        }

        if (elementInfo.classes && elementInfo.classes.length > 0) {
            content += '<span class="element-classes">.' + elementInfo.classes.slice(0, 3).join('.') + '</span>';
        }

        content += '</div>';

        // Dimensions
        if (elementInfo.boundingBox) {
            content += '<div class="inspector-tooltip-row">';
            content += '<span class="label">Size:</span>';
            content += '<span class="value">' + Math.round(elementInfo.boundingBox.width) + ' x ' + Math.round(elementInfo.boundingBox.height) + '</span>';
            content += '</div>';
        }

        // Best selector
        const bestSelector = elementInfo.bestSelector || elementInfo.selectors.css;
        content += '<div class="inspector-tooltip-row selector-row">';
        content += '<span class="label">Selector:</span>';
        content += '<span class="value selector-value" title="' + escapeHtml(bestSelector) + '">' + truncate(bestSelector, 40) + '</span>';
        content += '<button class="copy-btn" onclick="window._copyInspectorSelector()" title="Copy selector">Copy</button>';
        content += '</div>';

        // Inner text (truncated)
        if (elementInfo.innerText && elementInfo.innerText.trim()) {
            content += '<div class="inspector-tooltip-row">';
            content += '<span class="label">Text:</span>';
            content += '<span class="value text-value">"' + truncate(elementInfo.innerText, 30) + '"</span>';
            content += '</div>';
        }

        inspectorTooltip.innerHTML = content;

        // Position tooltip near mouse
        const clientX = window._lastInspectClientX || 0;
        const clientY = window._lastInspectClientY || 0;

        // Offset from cursor
        let tooltipX = clientX + 15;
        let tooltipY = clientY + 15;

        // Keep tooltip in viewport
        const tooltipRect = inspectorTooltip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (tooltipX + 280 > viewportWidth) {
            tooltipX = clientX - 295;
        }
        if (tooltipY + 150 > viewportHeight) {
            tooltipY = clientY - 165;
        }

        inspectorTooltip.style.left = tooltipX + 'px';
        inspectorTooltip.style.top = tooltipY + 'px';
        inspectorTooltip.style.display = 'block';
    }

    function hideInspectorOverlay() {
        if (inspectorHighlight) {
            inspectorHighlight.style.display = 'none';
        }
        if (inspectorTooltip) {
            inspectorTooltip.style.display = 'none';
        }
        currentElementInfo = null;
    }

    function copySelector(selector) {
        if (!selector) return;

        navigator.clipboard.writeText(selector).then(() => {
            // Show brief feedback
            vscode.postMessage({ type: 'info', message: 'Selector copied: ' + selector });

            // Visual feedback on tooltip
            const copyBtn = inspectorTooltip?.querySelector('.copy-btn');
            if (copyBtn) {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                }, 1000);
            }
        }).catch(err => {
            console.error('Failed to copy selector:', err);
        });
    }

    // Global function for copy button onclick
    window._copyInspectorSelector = function() {
        if (currentElementInfo) {
            copySelector(currentElementInfo.bestSelector || currentElementInfo.selectors.css);
        }
    };

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function truncate(str, maxLen) {
        if (!str) return '';
        if (str.length <= maxLen) return str;
        return str.substring(0, maxLen) + '...';
    }

    function toggleMode() {
        if (currentMode === 'screenshot') {
            currentMode = 'vnc';
            if (vncContainer) {
                vncContainer.style.display = 'block';
                screenshot.style.display = 'none';
                clickOverlay.style.display = 'none';
                initVNC();
            }
        } else {
            currentMode = 'screenshot';
            if (vncContainer) {
                vncContainer.style.display = 'none';
                screenshot.style.display = 'block';
                clickOverlay.style.display = 'block';
                if (rfb) {
                    rfb.disconnect();
                    rfb = null;
                }
            }
        }
        if (modeToggle) {
            modeToggle.textContent = currentMode === 'screenshot' ? 'Switch to VNC' : 'Switch to Screenshot';
        }
    }

    function initVNC() {
        // noVNC integration - requires noVNC library to be loaded
        if (typeof RFB === 'undefined') {
            console.warn('noVNC not available');
            return;
        }

        const vncUrl = CONFIG.vncUrl || 'ws://localhost:6080/websockify';
        try {
            rfb = new RFB(vncContainer, vncUrl, {
                scaleViewport: true,
                resizeSession: false,
                showDotCursor: true
            });

            rfb.addEventListener('connect', () => {
                console.log('VNC connected');
                vscode.postMessage({ type: 'vncConnected' });
            });

            rfb.addEventListener('disconnect', (e) => {
                console.log('VNC disconnected:', e.detail);
                vscode.postMessage({ type: 'vncDisconnected', reason: e.detail });
            });
        } catch (error) {
            console.error('VNC initialization error:', error);
        }
    }

    function showClickRipple(x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'click-ripple';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        clickOverlay.appendChild(ripple);
        setTimeout(() => ripple.remove(), 400);
    }

    // Handle messages from the extension
    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'refresh':
                sendAction({ type: 'screenshot' });
                break;

            case 'sendAction':
                sendAction(message);
                break;

            case 'navigate':
                sendAction({ type: 'navigate', url: message.url });
                break;

            case 'setMode':
                if (message.mode !== currentMode) {
                    toggleMode();
                }
                break;

            case 'getSnapshot':
                sendAction({ type: 'snapshot' });
                break;

            case 'setInspectorMode':
                if (message.enabled !== inspectorMode) {
                    toggleInspectorMode();
                }
                break;

            case 'inspectAt':
                if (message.x !== undefined && message.y !== undefined) {
                    sendAction({ type: 'inspect', x: message.x, y: message.y });
                }
                break;

            case 'toggleAnnotationMode':
                toggleAnnotationMode();
                break;

            case 'sendAnnotatedScreenshotToChat':
                if (window.annotationManager) {
                    window.annotationManager.sendToChat();
                }
                break;

            // Tab management messages
            case 'newTab':
                createNewTab(message.url);
                break;

            case 'closeTab':
                closeTab(message.tabId || activeTabId);
                break;

            case 'switchTab':
                if (message.tabId) {
                    switchToTab(message.tabId);
                }
                break;

            case 'getTabs':
                sendAction({ type: 'listTabs' });
                break;

            // Collaboration messages - forward to collaboration module
            case 'createCollaborationSession':
            case 'joinCollaborationSession':
            case 'leaveCollaborationSession':
            case 'showSessionInfo':
                if (window.PlaywrightCollaboration && window.PlaywrightCollaboration.handleExtensionMessage) {
                    window.PlaywrightCollaboration.handleExtensionMessage(message);
                }
                break;
        }
    });

    // Keyboard shortcuts when focused
    document.addEventListener('keydown', (e) => {
        // Only handle if not in input
        if (document.activeElement === typeInput) return;

        // Ctrl/Cmd + R = Reload
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            sendAction({ type: 'reload' });
        }

        // Ctrl/Cmd + T = New tab
        if ((e.ctrlKey || e.metaKey) && e.key === 't') {
            e.preventDefault();
            createNewTab();
        }

        // Ctrl/Cmd + W = Close tab
        if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
            e.preventDefault();
            if (tabs.length > 1) {
                closeTab(activeTabId);
            }
        }

        // Ctrl/Cmd + Tab = Next tab
        if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
            e.preventDefault();
            if (tabs.length > 1) {
                const currentIndex = tabs.findIndex(t => t.id === activeTabId);
                const nextIndex = e.shiftKey
                    ? (currentIndex - 1 + tabs.length) % tabs.length
                    : (currentIndex + 1) % tabs.length;
                switchToTab(tabs[nextIndex].id);
            }
        }

        // Backspace = Back
        if (e.key === 'Backspace') {
            e.preventDefault();
            sendAction({ type: 'back' });
        }

        // Forward keyboard events
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            sendAction({ type: 'type', text: e.key });
        }
    });

    // ========================================
    // Recording Event Listeners
    // ========================================

    // Toggle recording panel
    if (recordBtn) {
        recordBtn.addEventListener('click', function() {
            if (recordingPanel) {
                recordingPanel.classList.toggle('hidden');
                if (!recordingPanel.classList.contains('hidden')) {
                    refreshRecordings();
                }
            }
        });
    }

    // Close recording panel
    if (recordingPanelClose) {
        recordingPanelClose.addEventListener('click', function() {
            if (recordingPanel) recordingPanel.classList.add('hidden');
        });
    }

    // Start recording
    if (startRecordingBtn) {
        startRecordingBtn.addEventListener('click', startRecording);
    }

    // Stop recording
    if (stopRecordingBtn) {
        stopRecordingBtn.addEventListener('click', stopRecording);
    }

    // Playback controls
    if (playBtn) {
        playBtn.addEventListener('click', function() {
            if (recordingState.isPaused) {
                resumePlayback();
            } else {
                playRecording();
            }
        });
    }

    if (pauseBtn) {
        pauseBtn.addEventListener('click', pausePlayback);
    }

    if (stopPlaybackBtn) {
        stopPlaybackBtn.addEventListener('click', stopPlayback);
    }

    if (stepBtn) {
        stepBtn.addEventListener('click', stepForward);
    }

    if (playbackSpeedSelect) {
        playbackSpeedSelect.addEventListener('change', function() {
            if (recordingState.isPlaying) {
                sendAction({ type: 'setPlaybackSpeed', speed: parseFloat(this.value) });
            }
        });
    }

    // Refresh recordings
    if (refreshRecordingsBtn) {
        refreshRecordingsBtn.addEventListener('click', refreshRecordings);
    }

    // Export
    if (exportBtn) {
        exportBtn.addEventListener('click', exportRecording);
    }

    if (copyExportBtn) {
        copyExportBtn.addEventListener('click', function() {
            if (exportOutput && exportOutput.value) {
                navigator.clipboard.writeText(exportOutput.value).then(function() {
                    vscode.postMessage({ type: 'info', message: 'Copied to clipboard' });
                });
            }
        });
    }

    // Initialize
    vscode.postMessage({ type: 'ready' });
    connect();
})();
