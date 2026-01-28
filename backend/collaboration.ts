import { WebSocketServer, WebSocket } from 'ws';
import * as crypto from 'crypto';

// ================== Types & Interfaces ==================

export type ParticipantRole = 'viewer' | 'controller' | 'admin';

export interface Participant {
    id: string;
    name: string;
    color: string;
    role: ParticipantRole;
    cursor?: { x: number; y: number };
    joinedAt: number;
    isActive: boolean;
    lastActivity: number;
}

export interface SessionSettings {
    maxParticipants: number;
    allowViewerCursors: boolean;
    requireApproval: boolean;
    autoPromoteOnHostLeave: boolean;
    cursorUpdateRate: number; // ms
}

export interface Session {
    id: string;
    name: string;
    hostId: string;
    participants: Map<string, Participant>;
    createdAt: number;
    settings: SessionSettings;
    inviteCode: string;
    chatHistory: ChatMessage[];
    actionHistory: ActionRecord[];
}

export interface ChatMessage {
    id: string;
    participantId: string;
    participantName: string;
    message: string;
    timestamp: number;
}

export interface ActionRecord {
    id: string;
    participantId: string;
    participantName: string;
    action: string;
    data: any;
    timestamp: number;
}

// WebSocket message types
export interface WSMessage {
    type: string;
    [key: string]: any;
}

export interface CreateSessionMessage extends WSMessage {
    type: 'createSession';
    name: string;
    participantName: string;
    settings?: Partial<SessionSettings>;
}

export interface JoinSessionMessage extends WSMessage {
    type: 'joinSession';
    sessionId?: string;
    inviteCode?: string;
    participantName: string;
}

export interface LeaveSessionMessage extends WSMessage {
    type: 'leaveSession';
}

export interface CursorMoveMessage extends WSMessage {
    type: 'cursorMove';
    x: number;
    y: number;
}

export interface SetParticipantRoleMessage extends WSMessage {
    type: 'setParticipantRole';
    participantId: string;
    role: ParticipantRole;
}

export interface KickParticipantMessage extends WSMessage {
    type: 'kickParticipant';
    participantId: string;
}

export interface SessionChatMessage extends WSMessage {
    type: 'sessionChat';
    message: string;
}

export interface BrowserActionMessage extends WSMessage {
    type: 'browserAction';
    action: string;
    data: any;
}

export interface UpdateSettingsMessage extends WSMessage {
    type: 'updateSettings';
    settings: Partial<SessionSettings>;
}

// ================== Utility Functions ==================

const CURSOR_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F8B500', '#7DCEA0', '#F1948A', '#85929E', '#D7BDE2'
];

function generateSecureId(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
}

function generateInviteCode(): string {
    // Generate a human-readable invite code (6 characters)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
        code += chars[bytes[i] % chars.length];
    }
    return code;
}

function getNextColor(existingColors: string[]): string {
    for (const color of CURSOR_COLORS) {
        if (!existingColors.includes(color)) {
            return color;
        }
    }
    // If all colors are used, generate a random one
    return '#' + crypto.randomBytes(3).toString('hex');
}

// ================== Rate Limiter ==================

class RateLimiter {
    private timestamps: Map<string, number[]> = new Map();
    private readonly windowMs: number;
    private readonly maxRequests: number;

    constructor(windowMs: number, maxRequests: number) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
    }

    isAllowed(key: string): boolean {
        const now = Date.now();
        const timestamps = this.timestamps.get(key) || [];

        // Remove old timestamps
        const validTimestamps = timestamps.filter(t => now - t < this.windowMs);

        if (validTimestamps.length >= this.maxRequests) {
            this.timestamps.set(key, validTimestamps);
            return false;
        }

        validTimestamps.push(now);
        this.timestamps.set(key, validTimestamps);
        return true;
    }

    cleanup(): void {
        const now = Date.now();
        for (const [key, timestamps] of this.timestamps.entries()) {
            const validTimestamps = timestamps.filter(t => now - t < this.windowMs);
            if (validTimestamps.length === 0) {
                this.timestamps.delete(key);
            } else {
                this.timestamps.set(key, validTimestamps);
            }
        }
    }
}

// ================== Collaboration Manager ==================

interface ClientConnection {
    ws: WebSocket;
    participantId: string | null;
    sessionId: string | null;
    lastPing: number;
}

export class CollaborationManager {
    private sessions: Map<string, Session> = new Map();
    private inviteCodes: Map<string, string> = new Map(); // inviteCode -> sessionId
    private clients: Map<WebSocket, ClientConnection> = new Map();
    private cursorRateLimiter: RateLimiter;
    private actionRateLimiter: RateLimiter;
    private cleanupInterval: NodeJS.Timeout;

    constructor() {
        // Cursor updates: max 30 per second
        this.cursorRateLimiter = new RateLimiter(1000, 30);
        // Actions: max 10 per second
        this.actionRateLimiter = new RateLimiter(1000, 10);

        // Cleanup inactive sessions and rate limiter data every minute
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    }

    registerClient(ws: WebSocket): void {
        this.clients.set(ws, {
            ws,
            participantId: null,
            sessionId: null,
            lastPing: Date.now()
        });
    }

    unregisterClient(ws: WebSocket): void {
        const client = this.clients.get(ws);
        if (client && client.sessionId && client.participantId) {
            this.handleParticipantLeave(client.sessionId, client.participantId);
        }
        this.clients.delete(ws);
    }

    handleMessage(ws: WebSocket, message: WSMessage): void {
        const client = this.clients.get(ws);
        if (!client) {
            this.sendError(ws, 'Client not registered');
            return;
        }

        client.lastPing = Date.now();

        try {
            switch (message.type) {
                case 'createSession':
                    this.handleCreateSession(ws, client, message as CreateSessionMessage);
                    break;
                case 'joinSession':
                    this.handleJoinSession(ws, client, message as JoinSessionMessage);
                    break;
                case 'leaveSession':
                    this.handleLeaveSession(ws, client);
                    break;
                case 'cursorMove':
                    this.handleCursorMove(ws, client, message as CursorMoveMessage);
                    break;
                case 'setParticipantRole':
                    this.handleSetRole(ws, client, message as SetParticipantRoleMessage);
                    break;
                case 'kickParticipant':
                    this.handleKick(ws, client, message as KickParticipantMessage);
                    break;
                case 'sessionChat':
                    this.handleChat(ws, client, message as SessionChatMessage);
                    break;
                case 'browserAction':
                    this.handleBrowserAction(ws, client, message as BrowserActionMessage);
                    break;
                case 'updateSettings':
                    this.handleUpdateSettings(ws, client, message as UpdateSettingsMessage);
                    break;
                case 'getSessionInfo':
                    this.handleGetSessionInfo(ws, client);
                    break;
                case 'listSessions':
                    this.handleListSessions(ws);
                    break;
                default:
                    // Pass through to the relay server
                    this.forwardToRelay(ws, message);
            }
        } catch (error) {
            console.error('Error handling collaboration message:', error);
            this.sendError(ws, `Error: ${error}`);
        }
    }

    private handleCreateSession(ws: WebSocket, client: ClientConnection, message: CreateSessionMessage): void {
        if (client.sessionId) {
            this.sendError(ws, 'Already in a session. Leave first.');
            return;
        }

        const sessionId = generateSecureId(16);
        const inviteCode = generateInviteCode();
        const participantId = generateSecureId(16);

        const defaultSettings: SessionSettings = {
            maxParticipants: 10,
            allowViewerCursors: true,
            requireApproval: false,
            autoPromoteOnHostLeave: true,
            cursorUpdateRate: 50
        };

        const participant: Participant = {
            id: participantId,
            name: message.participantName || 'Host',
            color: CURSOR_COLORS[0],
            role: 'admin',
            joinedAt: Date.now(),
            isActive: true,
            lastActivity: Date.now()
        };

        const session: Session = {
            id: sessionId,
            name: message.name || 'Collaboration Session',
            hostId: participantId,
            participants: new Map([[participantId, participant]]),
            createdAt: Date.now(),
            settings: { ...defaultSettings, ...message.settings },
            inviteCode,
            chatHistory: [],
            actionHistory: []
        };

        this.sessions.set(sessionId, session);
        this.inviteCodes.set(inviteCode, sessionId);

        client.sessionId = sessionId;
        client.participantId = participantId;

        this.send(ws, {
            type: 'sessionCreated',
            session: this.serializeSession(session),
            participantId,
            inviteCode
        });

        console.log(`Session created: ${sessionId} by ${participant.name}`);
    }

    private handleJoinSession(ws: WebSocket, client: ClientConnection, message: JoinSessionMessage): void {
        if (client.sessionId) {
            this.sendError(ws, 'Already in a session. Leave first.');
            return;
        }

        let sessionId = message.sessionId;

        // Try to find by invite code if no sessionId
        if (!sessionId && message.inviteCode) {
            sessionId = this.inviteCodes.get(message.inviteCode.toUpperCase());
        }

        if (!sessionId) {
            this.sendError(ws, 'Session not found');
            return;
        }

        const session = this.sessions.get(sessionId);
        if (!session) {
            this.sendError(ws, 'Session not found');
            return;
        }

        if (session.participants.size >= session.settings.maxParticipants) {
            this.sendError(ws, 'Session is full');
            return;
        }

        const existingColors = Array.from(session.participants.values()).map(p => p.color);
        const participantId = generateSecureId(16);

        const participant: Participant = {
            id: participantId,
            name: message.participantName || `User ${session.participants.size + 1}`,
            color: getNextColor(existingColors),
            role: 'viewer', // New participants start as viewers
            joinedAt: Date.now(),
            isActive: true,
            lastActivity: Date.now()
        };

        session.participants.set(participantId, participant);
        client.sessionId = sessionId;
        client.participantId = participantId;

        // Notify the new participant
        this.send(ws, {
            type: 'sessionJoined',
            session: this.serializeSession(session),
            participantId
        });

        // Notify existing participants
        this.broadcastToSession(sessionId, {
            type: 'participantJoined',
            participant: this.serializeParticipant(participant)
        }, participantId);

        // Send chat history to new participant
        this.send(ws, {
            type: 'chatHistory',
            messages: session.chatHistory.slice(-50) // Last 50 messages
        });

        console.log(`${participant.name} joined session ${sessionId}`);
    }

    private handleLeaveSession(ws: WebSocket, client: ClientConnection): void {
        if (!client.sessionId || !client.participantId) {
            return;
        }

        this.handleParticipantLeave(client.sessionId, client.participantId);

        client.sessionId = null;
        client.participantId = null;

        this.send(ws, { type: 'sessionLeft' });
    }

    private handleParticipantLeave(sessionId: string, participantId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        const participant = session.participants.get(participantId);
        if (!participant) return;

        session.participants.delete(participantId);

        // If session is empty, clean it up
        if (session.participants.size === 0) {
            this.sessions.delete(sessionId);
            this.inviteCodes.delete(session.inviteCode);
            console.log(`Session ${sessionId} closed (no participants)`);
            return;
        }

        // If host left, promote someone else
        if (session.hostId === participantId && session.settings.autoPromoteOnHostLeave) {
            const newHost = Array.from(session.participants.values())
                .sort((a, b) => a.joinedAt - b.joinedAt)[0];

            if (newHost) {
                session.hostId = newHost.id;
                newHost.role = 'admin';

                this.broadcastToSession(sessionId, {
                    type: 'hostChanged',
                    newHostId: newHost.id,
                    participant: this.serializeParticipant(newHost)
                });
            }
        }

        // Notify other participants
        this.broadcastToSession(sessionId, {
            type: 'participantLeft',
            participantId,
            participantName: participant.name
        });

        console.log(`${participant.name} left session ${sessionId}`);
    }

    private handleCursorMove(ws: WebSocket, client: ClientConnection, message: CursorMoveMessage): void {
        if (!client.sessionId || !client.participantId) return;

        // Rate limit cursor updates
        if (!this.cursorRateLimiter.isAllowed(client.participantId)) {
            return;
        }

        const session = this.sessions.get(client.sessionId);
        if (!session) return;

        const participant = session.participants.get(client.participantId);
        if (!participant) return;

        // Check if viewers can share cursors
        if (participant.role === 'viewer' && !session.settings.allowViewerCursors) {
            return;
        }

        participant.cursor = { x: message.x, y: message.y };
        participant.lastActivity = Date.now();

        // Broadcast cursor position to other participants
        this.broadcastToSession(client.sessionId, {
            type: 'remoteCursor',
            participantId: client.participantId,
            participantName: participant.name,
            color: participant.color,
            x: message.x,
            y: message.y
        }, client.participantId);
    }

    private handleSetRole(ws: WebSocket, client: ClientConnection, message: SetParticipantRoleMessage): void {
        if (!client.sessionId || !client.participantId) {
            this.sendError(ws, 'Not in a session');
            return;
        }

        const session = this.sessions.get(client.sessionId);
        if (!session) return;

        const requester = session.participants.get(client.participantId);
        if (!requester || requester.role !== 'admin') {
            this.sendError(ws, 'Permission denied. Only admins can change roles.');
            return;
        }

        const target = session.participants.get(message.participantId);
        if (!target) {
            this.sendError(ws, 'Participant not found');
            return;
        }

        // Cannot demote the host
        if (target.id === session.hostId && message.role !== 'admin') {
            this.sendError(ws, 'Cannot demote the session host');
            return;
        }

        target.role = message.role;

        this.broadcastToSession(client.sessionId, {
            type: 'roleChanged',
            participantId: target.id,
            participantName: target.name,
            newRole: message.role,
            changedBy: requester.name
        });

        console.log(`${requester.name} changed ${target.name}'s role to ${message.role}`);
    }

    private handleKick(ws: WebSocket, client: ClientConnection, message: KickParticipantMessage): void {
        if (!client.sessionId || !client.participantId) {
            this.sendError(ws, 'Not in a session');
            return;
        }

        const session = this.sessions.get(client.sessionId);
        if (!session) return;

        const requester = session.participants.get(client.participantId);
        if (!requester || requester.role !== 'admin') {
            this.sendError(ws, 'Permission denied. Only admins can kick participants.');
            return;
        }

        if (message.participantId === session.hostId) {
            this.sendError(ws, 'Cannot kick the session host');
            return;
        }

        const target = session.participants.get(message.participantId);
        if (!target) {
            this.sendError(ws, 'Participant not found');
            return;
        }

        // Find the target's WebSocket and disconnect them
        for (const [targetWs, targetClient] of this.clients.entries()) {
            if (targetClient.participantId === message.participantId) {
                this.send(targetWs, {
                    type: 'kicked',
                    reason: `You were removed from the session by ${requester.name}`
                });

                targetClient.sessionId = null;
                targetClient.participantId = null;
                break;
            }
        }

        session.participants.delete(message.participantId);

        this.broadcastToSession(client.sessionId, {
            type: 'participantKicked',
            participantId: message.participantId,
            participantName: target.name,
            kickedBy: requester.name
        });

        console.log(`${requester.name} kicked ${target.name} from session ${client.sessionId}`);
    }

    private handleChat(ws: WebSocket, client: ClientConnection, message: SessionChatMessage): void {
        if (!client.sessionId || !client.participantId) {
            this.sendError(ws, 'Not in a session');
            return;
        }

        // Rate limit chat messages
        if (!this.actionRateLimiter.isAllowed(`chat:${client.participantId}`)) {
            this.sendError(ws, 'Too many messages. Please slow down.');
            return;
        }

        const session = this.sessions.get(client.sessionId);
        if (!session) return;

        const participant = session.participants.get(client.participantId);
        if (!participant) return;

        const chatMessage: ChatMessage = {
            id: generateSecureId(8),
            participantId: client.participantId,
            participantName: participant.name,
            message: message.message.substring(0, 500), // Limit message length
            timestamp: Date.now()
        };

        session.chatHistory.push(chatMessage);

        // Keep only last 100 messages
        if (session.chatHistory.length > 100) {
            session.chatHistory = session.chatHistory.slice(-100);
        }

        this.broadcastToSession(client.sessionId, {
            type: 'chatMessage',
            ...chatMessage,
            color: participant.color
        });
    }

    private handleBrowserAction(ws: WebSocket, client: ClientConnection, message: BrowserActionMessage): void {
        if (!client.sessionId || !client.participantId) {
            // Not in a session, forward directly
            this.forwardToRelay(ws, { type: message.action, ...message.data });
            return;
        }

        const session = this.sessions.get(client.sessionId);
        if (!session) return;

        const participant = session.participants.get(client.participantId);
        if (!participant) return;

        // Check permissions
        if (participant.role === 'viewer') {
            this.sendError(ws, 'Viewers cannot perform actions. Ask an admin to promote you to controller.');
            return;
        }

        // Rate limit actions
        if (!this.actionRateLimiter.isAllowed(`action:${client.participantId}`)) {
            this.sendError(ws, 'Too many actions. Please slow down.');
            return;
        }

        // Record the action
        const actionRecord: ActionRecord = {
            id: generateSecureId(8),
            participantId: client.participantId,
            participantName: participant.name,
            action: message.action,
            data: message.data,
            timestamp: Date.now()
        };

        session.actionHistory.push(actionRecord);

        // Keep only last 50 actions
        if (session.actionHistory.length > 50) {
            session.actionHistory = session.actionHistory.slice(-50);
        }

        // Broadcast action to all participants
        this.broadcastToSession(client.sessionId, {
            type: 'actionPerformed',
            participantId: client.participantId,
            participantName: participant.name,
            color: participant.color,
            action: message.action,
            data: message.data,
            timestamp: actionRecord.timestamp
        });

        // Forward the actual action to the relay
        this.forwardToRelay(ws, { type: message.action, ...message.data });
    }

    private handleUpdateSettings(ws: WebSocket, client: ClientConnection, message: UpdateSettingsMessage): void {
        if (!client.sessionId || !client.participantId) {
            this.sendError(ws, 'Not in a session');
            return;
        }

        const session = this.sessions.get(client.sessionId);
        if (!session) return;

        const participant = session.participants.get(client.participantId);
        if (!participant || participant.role !== 'admin') {
            this.sendError(ws, 'Permission denied. Only admins can update settings.');
            return;
        }

        // Update settings
        session.settings = { ...session.settings, ...message.settings };

        this.broadcastToSession(client.sessionId, {
            type: 'settingsUpdated',
            settings: session.settings,
            updatedBy: participant.name
        });
    }

    private handleGetSessionInfo(ws: WebSocket, client: ClientConnection): void {
        if (!client.sessionId) {
            this.send(ws, { type: 'sessionInfo', session: null });
            return;
        }

        const session = this.sessions.get(client.sessionId);
        if (!session) {
            this.send(ws, { type: 'sessionInfo', session: null });
            return;
        }

        this.send(ws, {
            type: 'sessionInfo',
            session: this.serializeSession(session),
            participantId: client.participantId
        });
    }

    private handleListSessions(ws: WebSocket): void {
        const sessionList = Array.from(this.sessions.values()).map(session => ({
            id: session.id,
            name: session.name,
            participantCount: session.participants.size,
            maxParticipants: session.settings.maxParticipants,
            createdAt: session.createdAt
        }));

        this.send(ws, {
            type: 'sessionList',
            sessions: sessionList
        });
    }

    private forwardToRelay(ws: WebSocket, message: any): void {
        // This will be handled by the main relay server
        // Just mark the message to be forwarded
        this.send(ws, {
            type: 'forwardToRelay',
            originalMessage: message
        });
    }

    private serializeSession(session: Session): any {
        return {
            id: session.id,
            name: session.name,
            hostId: session.hostId,
            participants: Array.from(session.participants.values()).map(p => this.serializeParticipant(p)),
            createdAt: session.createdAt,
            settings: session.settings,
            inviteCode: session.inviteCode
        };
    }

    private serializeParticipant(participant: Participant): any {
        return {
            id: participant.id,
            name: participant.name,
            color: participant.color,
            role: participant.role,
            cursor: participant.cursor,
            joinedAt: participant.joinedAt,
            isActive: participant.isActive
        };
    }

    private send(ws: WebSocket, data: any): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    private sendError(ws: WebSocket, message: string): void {
        this.send(ws, { type: 'error', message });
    }

    private broadcastToSession(sessionId: string, data: any, excludeParticipantId?: string): void {
        const message = JSON.stringify(data);

        for (const [ws, client] of this.clients.entries()) {
            if (client.sessionId === sessionId &&
                client.participantId !== excludeParticipantId &&
                ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    }

    private cleanup(): void {
        const now = Date.now();
        const inactiveThreshold = 5 * 60 * 1000; // 5 minutes

        // Clean up inactive participants
        for (const [sessionId, session] of this.sessions.entries()) {
            for (const [participantId, participant] of session.participants.entries()) {
                if (now - participant.lastActivity > inactiveThreshold) {
                    participant.isActive = false;
                }
            }
        }

        // Clean up rate limiter
        this.cursorRateLimiter.cleanup();
        this.actionRateLimiter.cleanup();
    }

    destroy(): void {
        clearInterval(this.cleanupInterval);
        this.sessions.clear();
        this.inviteCodes.clear();
        this.clients.clear();
    }
}

// ================== Collaboration WebSocket Server ==================

export class CollaborationServer {
    private wss: WebSocketServer;
    private manager: CollaborationManager;
    private pingInterval: NodeJS.Timeout;

    constructor(port: number) {
        this.manager = new CollaborationManager();
        this.wss = new WebSocketServer({ port });

        this.wss.on('connection', (ws: WebSocket) => {
            console.log('Collaboration client connected');
            this.manager.registerClient(ws);

            ws.on('message', (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.manager.handleMessage(ws, message);
                } catch (error) {
                    console.error('Error parsing collaboration message:', error);
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
                }
            });

            ws.on('close', () => {
                console.log('Collaboration client disconnected');
                this.manager.unregisterClient(ws);
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.manager.unregisterClient(ws);
            });

            // Send welcome message
            ws.send(JSON.stringify({
                type: 'welcome',
                message: 'Connected to collaboration server',
                version: '1.0.0'
            }));
        });

        // Ping clients every 30 seconds to keep connections alive
        this.pingInterval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                }
            });
        }, 30000);

        console.log(`Collaboration server running on ws://localhost:${port}`);
    }

    close(): void {
        clearInterval(this.pingInterval);
        this.manager.destroy();
        this.wss.close();
    }
}

// ================== Main Entry Point ==================

const COLLABORATION_PORT = 8767;

function main() {
    console.log('Starting Collaboration Server...');

    const server = new CollaborationServer(COLLABORATION_PORT);

    console.log(`\nCollaboration server started on ws://localhost:${COLLABORATION_PORT}`);
    console.log('\nPress Ctrl+C to stop.');

    process.on('SIGINT', () => {
        console.log('\nShutting down collaboration server...');
        server.close();
        process.exit(0);
    });
}

// Run if this is the main module
if (require.main === module) {
    main();
}

export { COLLABORATION_PORT };
