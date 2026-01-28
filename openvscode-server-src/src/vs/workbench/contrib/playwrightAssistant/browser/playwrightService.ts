/*---------------------------------------------------------------------------------------------
 *  Playwright Service - WebSocket connection to backend
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import {
	IPlaywrightService,
	ConnectionStatus,
	IScreenshotData,
	IBrowserTab,
	IRecordedAction,
	ICollaborationState
} from '../common/playwrightAssistant.js';

export class PlaywrightService extends Disposable implements IPlaywrightService {
	declare readonly _serviceBrand: undefined;

	private _ws: WebSocket | null = null;
	private _connectionStatus: ConnectionStatus = 'disconnected';
	private _screenshotInterval: ReturnType<typeof setInterval> | null = null;
	private _isRecording = false;
	private _recordedActions: IRecordedAction[] = [];
	private _collaborationState: ICollaborationState = { active: false, participantCount: 0 };
	private _reconnectAttempts = 0;
	private _maxReconnectAttempts = 5;
	private _reconnectDelay = 1000;

	// Events
	private readonly _onConnectionStatusChange = this._register(new Emitter<ConnectionStatus>());
	readonly onConnectionStatusChange: Event<ConnectionStatus> = this._onConnectionStatusChange.event;

	private readonly _onScreenshot = this._register(new Emitter<IScreenshotData>());
	readonly onScreenshot: Event<IScreenshotData> = this._onScreenshot.event;

	private readonly _onTabsUpdate = this._register(new Emitter<{ tabs: IBrowserTab[]; activeTabId: string }>());
	readonly onTabsUpdate: Event<{ tabs: IBrowserTab[]; activeTabId: string }> = this._onTabsUpdate.event;

	private readonly _onRecordingStateChange = this._register(new Emitter<boolean>());
	readonly onRecordingStateChange: Event<boolean> = this._onRecordingStateChange.event;

	private readonly _onCollaborationStateChange = this._register(new Emitter<ICollaborationState>());
	readonly onCollaborationStateChange: Event<ICollaborationState> = this._onCollaborationStateChange.event;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		// Auto-connect on startup
		this.connect();
	}

	get connectionStatus(): ConnectionStatus {
		return this._connectionStatus;
	}

	get isRecording(): boolean {
		return this._isRecording;
	}

	get collaborationState(): ICollaborationState {
		return this._collaborationState;
	}

	private getRelayServerUrl(): string {
		return this.configurationService.getValue<string>('playwrightAssistant.relayServerUrl') || 'ws://localhost:8765';
	}

	async connect(): Promise<void> {
		if (this._ws && this._ws.readyState === WebSocket.OPEN) {
			return;
		}

		this._setConnectionStatus('connecting');

		try {
			const url = this.getRelayServerUrl();
			this._ws = new WebSocket(url);

			this._ws.onopen = () => {
				this._setConnectionStatus('connected');
				this._reconnectAttempts = 0;
				console.log('Playwright Service: Connected to relay server');
			};

			this._ws.onmessage = (event) => {
				this._handleMessage(event.data);
			};

			this._ws.onclose = () => {
				this._setConnectionStatus('disconnected');
				this._ws = null;
				this._attemptReconnect();
			};

			this._ws.onerror = (error) => {
				console.error('Playwright Service: WebSocket error', error);
				this._setConnectionStatus('error');
			};
		} catch (error) {
			console.error('Playwright Service: Failed to connect', error);
			this._setConnectionStatus('error');
		}
	}

	disconnect(): void {
		if (this._ws) {
			this._ws.close();
			this._ws = null;
		}
		this._setConnectionStatus('disconnected');
		this.stopScreenshotStream();
	}

	private _attemptReconnect(): void {
		if (this._reconnectAttempts < this._maxReconnectAttempts) {
			this._reconnectAttempts++;
			const delay = this._reconnectDelay * Math.pow(2, this._reconnectAttempts - 1);
			console.log(`Playwright Service: Attempting reconnect ${this._reconnectAttempts}/${this._maxReconnectAttempts} in ${delay}ms`);
			setTimeout(() => this.connect(), delay);
		}
	}

	private _setConnectionStatus(status: ConnectionStatus): void {
		if (this._connectionStatus !== status) {
			this._connectionStatus = status;
			this._onConnectionStatusChange.fire(status);
		}
	}

	private _handleMessage(data: string): void {
		try {
			const message = JSON.parse(data);

			switch (message.type) {
				case 'screenshot':
					this._onScreenshot.fire({
						image: message.image,
						width: message.width || 0,
						height: message.height || 0,
						timestamp: Date.now()
					});
					break;

				case 'tabsUpdated':
					this._onTabsUpdate.fire({
						tabs: message.tabs || [],
						activeTabId: message.activeTabId || ''
					});
					break;

				case 'recordingStarted':
					this._isRecording = true;
					this._onRecordingStateChange.fire(true);
					break;

				case 'recordingStopped':
					this._isRecording = false;
					this._onRecordingStateChange.fire(false);
					break;

				case 'actionRecorded':
					if (message.action) {
						this._recordedActions.push(message.action);
					}
					break;

				case 'collaborationSessionCreated':
				case 'collaborationSessionJoined':
					this._collaborationState = {
						active: true,
						participantCount: message.participantCount || 1,
						sessionId: message.sessionId,
						inviteCode: message.inviteCode
					};
					this._onCollaborationStateChange.fire(this._collaborationState);
					break;

				case 'collaborationSessionLeft':
					this._collaborationState = { active: false, participantCount: 0 };
					this._onCollaborationStateChange.fire(this._collaborationState);
					break;

				case 'collaborationParticipantJoined':
				case 'collaborationParticipantLeft':
					this._collaborationState.participantCount = message.participantCount || this._collaborationState.participantCount;
					this._onCollaborationStateChange.fire(this._collaborationState);
					break;
			}
		} catch (error) {
			console.error('Playwright Service: Failed to parse message', error);
		}
	}

	private _send(message: object): void {
		if (this._ws && this._ws.readyState === WebSocket.OPEN) {
			this._ws.send(JSON.stringify(message));
		}
	}

	// Screenshot streaming
	startScreenshotStream(interval?: number): void {
		const screenshotInterval = interval || this.configurationService.getValue<number>('playwrightAssistant.screenshotInterval') || 200;

		if (this._screenshotInterval) {
			clearInterval(this._screenshotInterval);
		}

		this._screenshotInterval = setInterval(() => {
			this._send({ type: 'requestScreenshot' });
		}, screenshotInterval);

		// Request initial screenshot
		this._send({ type: 'requestScreenshot' });
	}

	stopScreenshotStream(): void {
		if (this._screenshotInterval) {
			clearInterval(this._screenshotInterval);
			this._screenshotInterval = null;
		}
	}

	// Browser control
	click(x: number, y: number): void {
		this._send({ type: 'click', x, y });
	}

	type(text: string): void {
		this._send({ type: 'type', text });
	}

	navigate(url: string): void {
		this._send({ type: 'navigate', url });
	}

	scroll(deltaX: number, deltaY: number): void {
		this._send({ type: 'scroll', deltaX, deltaY });
	}

	goBack(): void {
		this._send({ type: 'goBack' });
	}

	goForward(): void {
		this._send({ type: 'goForward' });
	}

	reload(): void {
		this._send({ type: 'reload' });
	}

	// Tab management
	async getTabs(): Promise<IBrowserTab[]> {
		return new Promise((resolve) => {
			const handler = (data: { tabs: IBrowserTab[] }) => {
				this._onTabsUpdate.event(() => {}); // Remove listener
				resolve(data.tabs);
			};
			this._register(this._onTabsUpdate.event(handler));
			this._send({ type: 'getTabs' });
			// Timeout fallback
			setTimeout(() => resolve([]), 5000);
		});
	}

	newTab(url?: string): void {
		this._send({ type: 'newTab', url });
	}

	closeTab(tabId?: string): void {
		this._send({ type: 'closeTab', tabId });
	}

	switchTab(tabId: string): void {
		this._send({ type: 'switchTab', tabId });
	}

	// Recording
	startRecording(): void {
		this._recordedActions = [];
		this._send({ type: 'startRecording' });
	}

	stopRecording(): void {
		this._send({ type: 'stopRecording' });
	}

	getRecordedActions(): IRecordedAction[] {
		return [...this._recordedActions];
	}

	clearRecording(): void {
		this._recordedActions = [];
		this._send({ type: 'clearRecording' });
	}

	// Collaboration
	createCollaborationSession(sessionName: string, participantName: string): void {
		this._send({ type: 'createCollaborationSession', sessionName, participantName });
	}

	joinCollaborationSession(inviteCode: string, participantName: string): void {
		this._send({ type: 'joinCollaborationSession', inviteCode, participantName });
	}

	leaveCollaborationSession(): void {
		this._send({ type: 'leaveCollaborationSession' });
	}

	override dispose(): void {
		this.disconnect();
		super.dispose();
	}
}
