/*---------------------------------------------------------------------------------------------
 *  Playwright Assistant - Common Types and Interfaces
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const PLAYWRIGHT_ASSISTANT_VIEWLET_ID = 'workbench.view.playwrightAssistant';
export const PLAYWRIGHT_VIEWER_VIEW_ID = 'playwrightAssistant.viewer';
export const PLAYWRIGHT_CHAT_VIEW_ID = 'playwrightAssistant.chat';

/**
 * Annotation data structure for screenshot annotations
 */
export interface IAnnotation {
	id: string;
	type: 'pen' | 'highlighter' | 'arrow' | 'rectangle' | 'circle' | 'text';
	points?: { x: number; y: number }[];
	start?: { x: number; y: number };
	end?: { x: number; y: number };
	text?: string;
	color: string;
	strokeWidth: number;
	timestamp: number;
}

/**
 * Collaboration state for status bar updates
 */
export interface ICollaborationState {
	active: boolean;
	participantCount: number;
	sessionId?: string;
	inviteCode?: string;
}

/**
 * Browser tab information
 */
export interface IBrowserTab {
	id: string;
	title: string;
	url: string;
	active: boolean;
}

/**
 * Connection status types
 */
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/**
 * Recorded action for code generation
 */
export interface IRecordedAction {
	type: 'click' | 'type' | 'navigate' | 'scroll' | 'wait';
	timestamp: number;
	selector?: string;
	value?: string;
	x?: number;
	y?: number;
	deltaX?: number;
	deltaY?: number;
}

/**
 * Screenshot data from the browser
 */
export interface IScreenshotData {
	image: string; // base64 encoded
	width: number;
	height: number;
	timestamp: number;
}

/**
 * Playwright Assistant Service Interface
 */
export interface IPlaywrightService {
	readonly _serviceBrand: undefined;

	// Connection
	readonly onConnectionStatusChange: Event<ConnectionStatus>;
	readonly connectionStatus: ConnectionStatus;
	connect(): Promise<void>;
	disconnect(): void;

	// Screenshot streaming
	readonly onScreenshot: Event<IScreenshotData>;
	startScreenshotStream(interval?: number): void;
	stopScreenshotStream(): void;

	// Browser control
	click(x: number, y: number): void;
	type(text: string): void;
	navigate(url: string): void;
	scroll(deltaX: number, deltaY: number): void;
	goBack(): void;
	goForward(): void;
	reload(): void;

	// Tab management
	readonly onTabsUpdate: Event<{ tabs: IBrowserTab[]; activeTabId: string }>;
	getTabs(): Promise<IBrowserTab[]>;
	newTab(url?: string): void;
	closeTab(tabId?: string): void;
	switchTab(tabId: string): void;

	// Recording
	readonly onRecordingStateChange: Event<boolean>;
	readonly isRecording: boolean;
	startRecording(): void;
	stopRecording(): void;
	getRecordedActions(): IRecordedAction[];
	clearRecording(): void;

	// Collaboration
	readonly onCollaborationStateChange: Event<ICollaborationState>;
	readonly collaborationState: ICollaborationState;
	createCollaborationSession(sessionName: string, participantName: string): void;
	joinCollaborationSession(inviteCode: string, participantName: string): void;
	leaveCollaborationSession(): void;
}

export const IPlaywrightService = createDecorator<IPlaywrightService>('playwrightService');

/**
 * Chat Service Interface for Playwright Assistant
 */
export interface IPlaywrightChatService {
	readonly _serviceBrand: undefined;

	sendMessage(text: string, streaming?: boolean): Promise<void>;
	cancelStream(): void;
	clearHistory(): Promise<void>;
	addScreenshot(imageData: string, annotations?: IAnnotation[]): void;
}

export const IPlaywrightChatService = createDecorator<IPlaywrightChatService>('playwrightChatService');
