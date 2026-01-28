/**
 * Collaboration Module for Playwright Assistant
 * Enables multi-user viewing and control of browser sessions
 */
(function() {
    'use strict';

    // ================== Collaboration State ==================
    const collaborationState = {
        enabled: false,
        sessionId: null,
        participantId: null,
        participants: new Map(),
        isHost: false,
        role: 'viewer',
        chatOpen: false,
        participantListOpen: false,
        inviteCode: null
    };

    // UI Elements
    let remoteCursorsContainer = null;
    let participantListPanel = null;
    let chatPanel = null;
    let collaborationToolbar = null;

    // Throttle timeout for cursor updates
    let cursorThrottleTimeout = null;
    const CURSOR_THROTTLE_MS = 50;

    // Get references to existing elements
    function getElements() {
        return {
            screenshot: document.getElementById('screenshot'),
            clickOverlay: document.getElementById('click-overlay'),
            container: document.getElementById('container'),
            statusBar: document.getElementById('status-bar')
        };
    }

    // ================== WebSocket Integration ==================

    // Hook into existing WebSocket message handling
    function handleCollaborationMessage(data) {
        switch (data.type) {
            case 'welcome':
                console.log('Collaboration server:', data.message);
                return true;

            case 'sessionCreated':
                handleSessionCreated(data);
                return true;

            case 'sessionJoined':
                handleSessionJoined(data);
                return true;

            case 'sessionLeft':
                handleSessionLeft();
                return true;

            case 'participantJoined':
                handleParticipantJoined(data.participant);
                return true;

            case 'participantLeft':
                handleParticipantLeft(data.participantId, data.participantName);
                return true;

            case 'remoteCursor':
                handleRemoteCursor(data);
                return true;

            case 'chatMessage':
                handleChatMessage(data);
                return true;

            case 'chatHistory':
                handleChatHistory(data.messages);
                return true;

            case 'roleChanged':
                handleRoleChanged(data);
                return true;

            case 'hostChanged':
                handleHostChanged(data);
                return true;

            case 'kicked':
                handleKicked(data.reason);
                return true;

            case 'participantKicked':
                handleParticipantKicked(data);
                return true;

            case 'actionPerformed':
                handleActionPerformed(data);
                return true;

            case 'settingsUpdated':
                handleSettingsUpdated(data);
                return true;

            case 'sessionInfo':
                handleSessionInfo(data);
                return true;

            case 'sessionList':
                handleSessionList(data.sessions);
                return true;

            default:
                return false; // Not a collaboration message
        }
    }

    // ================== Session Handlers ==================

    function handleSessionCreated(data) {
        collaborationState.enabled = true;
        collaborationState.sessionId = data.session.id;
        collaborationState.participantId = data.participantId;
        collaborationState.isHost = true;
        collaborationState.role = 'admin';
        collaborationState.inviteCode = data.inviteCode;

        // Initialize participants
        collaborationState.participants.clear();
        data.session.participants.forEach(function(p) {
            collaborationState.participants.set(p.id, p);
        });

        initializeCollaborationUI();
        updateParticipantList();
        showCollaborationNotification('Session created! Invite code: ' + data.inviteCode);

        // Notify extension
        if (window.vscode) {
            window.vscode.postMessage({
                type: 'collaborationSessionCreated',
                session: data.session,
                inviteCode: data.inviteCode
            });
        }
    }

    function handleSessionJoined(data) {
        collaborationState.enabled = true;
        collaborationState.sessionId = data.session.id;
        collaborationState.participantId = data.participantId;
        collaborationState.isHost = data.session.hostId === data.participantId;
        collaborationState.inviteCode = data.session.inviteCode;

        // Find our role
        const me = data.session.participants.find(function(p) { return p.id === data.participantId; });
        collaborationState.role = me ? me.role : 'viewer';

        // Initialize participants
        collaborationState.participants.clear();
        data.session.participants.forEach(function(p) {
            collaborationState.participants.set(p.id, p);
        });

        initializeCollaborationUI();
        updateParticipantList();
        showCollaborationNotification('Joined session: ' + data.session.name);

        // Notify extension
        if (window.vscode) {
            window.vscode.postMessage({
                type: 'collaborationSessionJoined',
                session: data.session
            });
        }
    }

    function handleSessionLeft() {
        collaborationState.enabled = false;
        collaborationState.sessionId = null;
        collaborationState.participantId = null;
        collaborationState.participants.clear();
        collaborationState.isHost = false;
        collaborationState.role = 'viewer';
        collaborationState.inviteCode = null;

        cleanupCollaborationUI();
        showCollaborationNotification('Left collaboration session');

        if (window.vscode) {
            window.vscode.postMessage({ type: 'collaborationSessionLeft' });
        }
    }

    function handleParticipantJoined(participant) {
        collaborationState.participants.set(participant.id, participant);
        updateParticipantList();
        showCollaborationNotification(participant.name + ' joined the session');
        addChatSystemMessage(participant.name + ' joined the session');
    }

    function handleParticipantLeft(participantId, participantName) {
        collaborationState.participants.delete(participantId);
        removeRemoteCursor(participantId);
        updateParticipantList();
        showCollaborationNotification(participantName + ' left the session');
        addChatSystemMessage(participantName + ' left the session');
    }

    function handleRemoteCursor(data) {
        if (data.participantId === collaborationState.participantId) return;
        updateRemoteCursor(data.participantId, data.participantName, data.color, data.x, data.y);
    }

    function handleChatMessage(data) {
        addChatMessage(data.participantId, data.participantName, data.message, data.color, data.timestamp);
    }

    function handleChatHistory(messages) {
        if (!chatPanel) return;

        const chatMessages = chatPanel.querySelector('.chat-messages');
        if (!chatMessages) return;

        chatMessages.innerHTML = '';
        messages.forEach(function(msg) {
            const participant = collaborationState.participants.get(msg.participantId);
            const color = participant ? participant.color : '#888';
            addChatMessage(msg.participantId, msg.participantName, msg.message, color, msg.timestamp, false);
        });
    }

    function handleRoleChanged(data) {
        const participant = collaborationState.participants.get(data.participantId);
        if (participant) {
            participant.role = data.newRole;
        }

        if (data.participantId === collaborationState.participantId) {
            collaborationState.role = data.newRole;
            updateCollaborationToolbar();
            showCollaborationNotification('Your role was changed to ' + data.newRole + ' by ' + data.changedBy);
        }

        updateParticipantList();
        addChatSystemMessage(data.participantName + "'s role changed to " + data.newRole);
    }

    function handleHostChanged(data) {
        if (data.newHostId === collaborationState.participantId) {
            collaborationState.isHost = true;
            showCollaborationNotification('You are now the session host');
        }

        const participant = collaborationState.participants.get(data.newHostId);
        if (participant) {
            participant.role = 'admin';
        }

        updateParticipantList();
        updateCollaborationToolbar();
        addChatSystemMessage(data.participant.name + ' is now the session host');
    }

    function handleKicked(reason) {
        collaborationState.enabled = false;
        collaborationState.sessionId = null;
        collaborationState.participantId = null;
        collaborationState.participants.clear();

        cleanupCollaborationUI();
        showCollaborationNotification(reason);

        if (window.vscode) {
            window.vscode.postMessage({ type: 'collaborationKicked', reason: reason });
        }
    }

    function handleParticipantKicked(data) {
        collaborationState.participants.delete(data.participantId);
        removeRemoteCursor(data.participantId);
        updateParticipantList();
        addChatSystemMessage(data.participantName + ' was removed by ' + data.kickedBy);
    }

    function handleActionPerformed(data) {
        if (data.participantId === collaborationState.participantId) return;
        showActionIndicator(data);
    }

    function handleSettingsUpdated(data) {
        showCollaborationNotification('Settings updated by ' + data.updatedBy);
    }

    function handleSessionInfo(data) {
        if (data.session) {
            collaborationState.participants.clear();
            data.session.participants.forEach(function(p) {
                collaborationState.participants.set(p.id, p);
            });
            updateParticipantList();
        }
    }

    function handleSessionList(sessions) {
        if (window.vscode) {
            window.vscode.postMessage({ type: 'collaborationSessionList', sessions: sessions });
        }
    }

    // ================== Collaboration UI ==================

    function initializeCollaborationUI() {
        const elements = getElements();
        if (!elements.clickOverlay || !elements.container) return;

        // Create remote cursors container
        if (!remoteCursorsContainer) {
            remoteCursorsContainer = document.createElement('div');
            remoteCursorsContainer.id = 'remote-cursors';
            remoteCursorsContainer.className = 'remote-cursors-container';
            elements.clickOverlay.appendChild(remoteCursorsContainer);
        }

        // Create collaboration toolbar
        if (!collaborationToolbar) {
            collaborationToolbar = document.createElement('div');
            collaborationToolbar.id = 'collaboration-toolbar';
            collaborationToolbar.className = 'collaboration-toolbar';
            if (elements.statusBar && elements.statusBar.nextSibling) {
                elements.container.insertBefore(collaborationToolbar, elements.statusBar.nextSibling);
            } else {
                elements.container.appendChild(collaborationToolbar);
            }
        }
        updateCollaborationToolbar();

        // Create participant list panel
        if (!participantListPanel) {
            participantListPanel = document.createElement('div');
            participantListPanel.id = 'participant-list-panel';
            participantListPanel.className = 'collaboration-panel participant-list-panel';
            participantListPanel.innerHTML =
                '<div class="panel-header">' +
                    '<span>Participants</span>' +
                    '<button class="panel-close-btn" title="Close">&times;</button>' +
                '</div>' +
                '<div class="participant-list"></div>';
            elements.container.appendChild(participantListPanel);

            participantListPanel.querySelector('.panel-close-btn').addEventListener('click', function() {
                toggleParticipantList();
            });
        }

        // Create chat panel
        if (!chatPanel) {
            chatPanel = document.createElement('div');
            chatPanel.id = 'chat-panel';
            chatPanel.className = 'collaboration-panel chat-panel';
            chatPanel.innerHTML =
                '<div class="panel-header">' +
                    '<span>Session Chat</span>' +
                    '<button class="panel-close-btn" title="Close">&times;</button>' +
                '</div>' +
                '<div class="chat-messages"></div>' +
                '<div class="chat-input-container">' +
                    '<input type="text" class="chat-input" placeholder="Type a message..." />' +
                    '<button class="chat-send-btn">Send</button>' +
                '</div>';
            elements.container.appendChild(chatPanel);

            chatPanel.querySelector('.panel-close-btn').addEventListener('click', function() {
                toggleChat();
            });

            const chatInput = chatPanel.querySelector('.chat-input');
            const sendBtn = chatPanel.querySelector('.chat-send-btn');

            chatInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage();
                }
            });

            sendBtn.addEventListener('click', sendChatMessage);
        }
    }

    function updateCollaborationToolbar() {
        if (!collaborationToolbar) return;

        const participantCount = collaborationState.participants.size;
        const roleLabel = collaborationState.role.charAt(0).toUpperCase() + collaborationState.role.slice(1);

        let html = '<div class="collab-info">' +
                '<span class="collab-badge">LIVE</span>' +
                '<span class="collab-participant-count">' + participantCount + ' participant' + (participantCount !== 1 ? 's' : '') + '</span>' +
                '<span class="collab-role">' + roleLabel + '</span>' +
            '</div>' +
            '<div class="collab-actions">' +
                '<button class="collab-btn" id="toggle-participants-btn" title="Participants">' +
                    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">' +
                        '<path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/>' +
                    '</svg>' +
                '</button>' +
                '<button class="collab-btn" id="toggle-chat-btn" title="Chat">' +
                    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">' +
                        '<path d="M2.678 11.894a1 1 0 0 1 .287.801 10.97 10.97 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8.06 8.06 0 0 0 8 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 0 1-2.347-.306c-.52.263-1.639.742-3.468 1.105z"/>' +
                    '</svg>' +
                '</button>' +
                '<button class="collab-btn" id="copy-invite-btn" title="Copy Invite Code">' +
                    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">' +
                        '<path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>' +
                        '<path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>' +
                    '</svg>' +
                '</button>';

        if (collaborationState.isHost) {
            html += '<button class="collab-btn collab-btn-danger" id="end-session-btn" title="End Session">End</button>';
        } else {
            html += '<button class="collab-btn" id="leave-session-btn" title="Leave Session">Leave</button>';
        }

        html += '</div>';

        collaborationToolbar.innerHTML = html;

        // Add event listeners
        document.getElementById('toggle-participants-btn').addEventListener('click', toggleParticipantList);
        document.getElementById('toggle-chat-btn').addEventListener('click', toggleChat);
        document.getElementById('copy-invite-btn').addEventListener('click', copyInviteCode);

        if (collaborationState.isHost) {
            document.getElementById('end-session-btn').addEventListener('click', function() {
                if (confirm('Are you sure you want to end the session for everyone?')) {
                    sendCollaborationMessage({ type: 'leaveSession' });
                }
            });
        } else {
            document.getElementById('leave-session-btn').addEventListener('click', function() {
                sendCollaborationMessage({ type: 'leaveSession' });
            });
        }
    }

    function cleanupCollaborationUI() {
        if (remoteCursorsContainer) {
            remoteCursorsContainer.innerHTML = '';
        }

        if (collaborationToolbar) {
            collaborationToolbar.remove();
            collaborationToolbar = null;
        }

        if (participantListPanel) {
            participantListPanel.remove();
            participantListPanel = null;
        }

        if (chatPanel) {
            chatPanel.remove();
            chatPanel = null;
        }
    }

    function toggleParticipantList() {
        if (!participantListPanel) return;

        collaborationState.participantListOpen = !collaborationState.participantListOpen;
        participantListPanel.classList.toggle('open', collaborationState.participantListOpen);
    }

    function toggleChat() {
        if (!chatPanel) return;

        collaborationState.chatOpen = !collaborationState.chatOpen;
        chatPanel.classList.toggle('open', collaborationState.chatOpen);

        if (collaborationState.chatOpen) {
            const chatInput = chatPanel.querySelector('.chat-input');
            if (chatInput) chatInput.focus();
        }
    }

    function copyInviteCode() {
        if (!collaborationState.inviteCode) return;

        navigator.clipboard.writeText(collaborationState.inviteCode).then(function() {
            showCollaborationNotification('Invite code copied: ' + collaborationState.inviteCode);
        }).catch(function(err) {
            console.error('Failed to copy invite code:', err);
        });
    }

    function updateParticipantList() {
        if (!participantListPanel) return;

        const listContainer = participantListPanel.querySelector('.participant-list');
        if (!listContainer) return;

        listContainer.innerHTML = '';

        collaborationState.participants.forEach(function(participant, id) {
            const isMe = id === collaborationState.participantId;
            const canManage = collaborationState.role === 'admin' && !isMe;

            const item = document.createElement('div');
            item.className = 'participant-item';

            let html = '<div class="participant-color" style="background-color: ' + participant.color + '"></div>' +
                '<div class="participant-info">' +
                    '<span class="participant-name">' + escapeHtml(participant.name) + (isMe ? ' (You)' : '') + '</span>' +
                    '<span class="participant-role">' + participant.role + '</span>' +
                '</div>';

            if (canManage) {
                html += '<div class="participant-actions">' +
                    '<select class="role-select" data-participant-id="' + id + '">' +
                        '<option value="viewer"' + (participant.role === 'viewer' ? ' selected' : '') + '>Viewer</option>' +
                        '<option value="controller"' + (participant.role === 'controller' ? ' selected' : '') + '>Controller</option>' +
                        '<option value="admin"' + (participant.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
                    '</select>' +
                    '<button class="kick-btn" data-participant-id="' + id + '" title="Remove">&times;</button>' +
                '</div>';
            }

            item.innerHTML = html;
            listContainer.appendChild(item);
        });

        // Add event listeners for role changes and kicks
        listContainer.querySelectorAll('.role-select').forEach(function(select) {
            select.addEventListener('change', function(e) {
                const participantId = e.target.dataset.participantId;
                const newRole = e.target.value;
                sendCollaborationMessage({
                    type: 'setParticipantRole',
                    participantId: participantId,
                    role: newRole
                });
            });
        });

        listContainer.querySelectorAll('.kick-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                const participantId = e.target.dataset.participantId;
                const participant = collaborationState.participants.get(participantId);
                if (confirm('Remove ' + participant.name + ' from the session?')) {
                    sendCollaborationMessage({
                        type: 'kickParticipant',
                        participantId: participantId
                    });
                }
            });
        });
    }

    function addChatMessage(participantId, participantName, message, color, timestamp, scroll) {
        if (scroll === undefined) scroll = true;
        if (!chatPanel) return;

        const chatMessages = chatPanel.querySelector('.chat-messages');
        if (!chatMessages) return;

        const isMe = participantId === collaborationState.participantId;
        const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const msgEl = document.createElement('div');
        msgEl.className = 'chat-message' + (isMe ? ' chat-message-me' : '');
        msgEl.innerHTML = '<div class="chat-message-header">' +
                '<span class="chat-message-name" style="color: ' + color + '">' + escapeHtml(participantName) + '</span>' +
                '<span class="chat-message-time">' + time + '</span>' +
            '</div>' +
            '<div class="chat-message-content">' + escapeHtml(message) + '</div>';

        chatMessages.appendChild(msgEl);

        if (scroll) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    function addChatSystemMessage(message) {
        if (!chatPanel) return;

        const chatMessages = chatPanel.querySelector('.chat-messages');
        if (!chatMessages) return;

        const msgEl = document.createElement('div');
        msgEl.className = 'chat-message chat-message-system';
        msgEl.textContent = message;

        chatMessages.appendChild(msgEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function sendChatMessage() {
        if (!chatPanel) return;

        const chatInput = chatPanel.querySelector('.chat-input');
        if (!chatInput) return;

        const message = chatInput.value.trim();
        if (!message) return;

        sendCollaborationMessage({
            type: 'sessionChat',
            message: message
        });

        chatInput.value = '';
    }

    // ================== Remote Cursors ==================

    function updateRemoteCursor(participantId, name, color, x, y) {
        if (!remoteCursorsContainer) return;

        const elements = getElements();
        if (!elements.screenshot) return;

        let cursor = remoteCursorsContainer.querySelector('[data-participant-id="' + participantId + '"]');

        if (!cursor) {
            cursor = document.createElement('div');
            cursor.className = 'remote-cursor';
            cursor.dataset.participantId = participantId;
            cursor.innerHTML = '<svg class="cursor-pointer" width="24" height="24" viewBox="0 0 24 24" fill="' + color + '">' +
                    '<path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L6.35 2.76a.5.5 0 0 0-.85.45z"/>' +
                '</svg>' +
                '<span class="cursor-label" style="background-color: ' + color + '">' + escapeHtml(name) + '</span>';
            remoteCursorsContainer.appendChild(cursor);
        }

        // Scale coordinates to match current screenshot display
        const rect = elements.screenshot.getBoundingClientRect();
        const naturalWidth = elements.screenshot.naturalWidth || 1;
        const naturalHeight = elements.screenshot.naturalHeight || 1;
        const scaleX = rect.width / naturalWidth;
        const scaleY = rect.height / naturalHeight;

        const displayX = x * scaleX;
        const displayY = y * scaleY;

        cursor.style.transform = 'translate(' + displayX + 'px, ' + displayY + 'px)';
        cursor.classList.add('active');

        // Hide cursor after 3 seconds of inactivity
        clearTimeout(cursor.hideTimeout);
        cursor.hideTimeout = setTimeout(function() {
            cursor.classList.remove('active');
        }, 3000);
    }

    function removeRemoteCursor(participantId) {
        if (!remoteCursorsContainer) return;

        const cursor = remoteCursorsContainer.querySelector('[data-participant-id="' + participantId + '"]');
        if (cursor) {
            cursor.remove();
        }
    }

    function showActionIndicator(data) {
        const elements = getElements();
        if (!elements.clickOverlay) return;

        const indicator = document.createElement('div');
        indicator.className = 'action-indicator-collab';
        indicator.style.setProperty('--indicator-color', data.color);

        // Position based on action data
        let x = 0, y = 0;
        if (data.data && data.data.x !== undefined && data.data.y !== undefined) {
            const rect = elements.screenshot.getBoundingClientRect();
            const naturalWidth = elements.screenshot.naturalWidth || 1;
            const naturalHeight = elements.screenshot.naturalHeight || 1;
            const scaleX = rect.width / naturalWidth;
            const scaleY = rect.height / naturalHeight;
            x = data.data.x * scaleX;
            y = data.data.y * scaleY;
        }

        indicator.style.left = x + 'px';
        indicator.style.top = y + 'px';

        indicator.innerHTML = '<span class="action-indicator-label" style="background-color: ' + data.color + '">' +
                escapeHtml(data.participantName) + ': ' + data.action +
            '</span>';

        elements.clickOverlay.appendChild(indicator);

        setTimeout(function() { indicator.remove(); }, 2000);
    }

    function showCollaborationNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'collaboration-notification';
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(function() {
            notification.classList.add('fade-out');
            setTimeout(function() { notification.remove(); }, 300);
        }, 3000);
    }

    // ================== WebSocket Helper ==================

    function sendCollaborationMessage(message) {
        // Use global WebSocket or sendPlaywrightAction function if available
        if (window._playwrightWs && window._playwrightWs.readyState === WebSocket.OPEN) {
            window._playwrightWs.send(JSON.stringify(message));
        } else if (window.sendPlaywrightAction) {
            window.sendPlaywrightAction(message);
        }
    }

    // Track cursor position for sharing
    function trackCursor(x, y) {
        if (!collaborationState.enabled || !collaborationState.sessionId) return;

        if (cursorThrottleTimeout) return;

        cursorThrottleTimeout = setTimeout(function() {
            sendCollaborationMessage({
                type: 'cursorMove',
                x: x,
                y: y
            });
            cursorThrottleTimeout = null;
        }, CURSOR_THROTTLE_MS);
    }

    // Wrap action for collaboration mode
    function wrapActionForCollaboration(action) {
        if (collaborationState.enabled && collaborationState.sessionId) {
            return {
                type: 'browserAction',
                action: action.type,
                data: action
            };
        }
        return action;
    }

    // ================== Utility Functions ==================

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ================== Public API ==================

    // Handle extension messages for collaboration
    function handleExtensionMessage(message) {
        switch (message.type) {
            case 'createSession':
            case 'createCollaborationSession':
                sendCollaborationMessage({
                    type: 'createSession',
                    name: message.sessionName || message.name || 'Collaboration Session',
                    participantName: message.participantName || 'Host'
                });
                return true;

            case 'joinSession':
            case 'joinCollaborationSession':
                sendCollaborationMessage({
                    type: 'joinSession',
                    sessionId: message.sessionId,
                    inviteCode: message.inviteCode,
                    participantName: message.participantName || 'Guest'
                });
                return true;

            case 'leaveSession':
            case 'leaveCollaborationSession':
                sendCollaborationMessage({ type: 'leaveSession' });
                return true;

            case 'getSessionInfo':
            case 'showSessionInfo':
                sendCollaborationMessage({ type: 'getSessionInfo' });
                return true;

            case 'listSessions':
                sendCollaborationMessage({ type: 'listSessions' });
                return true;

            default:
                return false;
        }
    }

    // Expose collaboration module
    window.PlaywrightCollaboration = {
        handleMessage: handleCollaborationMessage,
        handleExtensionMessage: handleExtensionMessage,
        trackCursor: trackCursor,
        wrapAction: wrapActionForCollaboration,
        getState: function() { return collaborationState; },
        isEnabled: function() { return collaborationState.enabled; },
        isViewer: function() { return collaborationState.role === 'viewer'; },
        canControl: function() { return collaborationState.role === 'controller' || collaborationState.role === 'admin'; }
    };
})();
