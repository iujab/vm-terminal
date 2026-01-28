import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Simple UUID v4 generator
function uuidv4(): string {
    return crypto.randomUUID();
}

// Recording interfaces
export interface RecordedAction {
    id: string;
    timestamp: number;
    type: string;
    params: any;
    result?: any;
}

export interface RecordedScreenshot {
    id: string;
    timestamp: number;
    image: string; // base64
    afterAction?: string; // action id
}

export interface Recording {
    id: string;
    name: string;
    startTime: number;
    endTime?: number;
    startUrl: string;
    actions: RecordedAction[];
    screenshots: RecordedScreenshot[];
    metadata?: {
        browser?: string;
        viewport?: { width: number; height: number };
        userAgent?: string;
    };
}

export interface RecordingInfo {
    id: string;
    name: string;
    startTime: number;
    endTime?: number;
    startUrl: string;
    actionCount: number;
    screenshotCount: number;
    duration?: number;
}

export interface PlaybackState {
    recording: Recording;
    currentIndex: number;
    speed: number;
    isPaused: boolean;
    isPlaying: boolean;
    startedAt: number;
}

export type PlaybackEventType =
    | 'playbackStarted'
    | 'playbackPaused'
    | 'playbackResumed'
    | 'playbackStopped'
    | 'playbackComplete'
    | 'actionExecuting'
    | 'actionExecuted'
    | 'screenshotDisplayed'
    | 'playbackError';

export interface PlaybackEvent {
    type: PlaybackEventType;
    recordingId: string;
    currentIndex?: number;
    totalActions?: number;
    action?: RecordedAction;
    screenshot?: RecordedScreenshot;
    error?: string;
    progress?: number;
}

export type RecordingEventType =
    | 'recordingStarted'
    | 'recordingStopped'
    | 'actionRecorded'
    | 'screenshotRecorded';

export interface RecordingEvent {
    type: RecordingEventType;
    recordingId?: string;
    recordingName?: string;
    action?: RecordedAction;
    screenshot?: RecordedScreenshot;
    actionCount?: number;
    screenshotCount?: number;
}

type RecordingEventListener = (event: RecordingEvent) => void;
type PlaybackEventListener = (event: PlaybackEvent) => void;

export class SessionRecorder {
    private recordingsDir: string;
    private currentRecording: Recording | null = null;
    private playbackState: PlaybackState | null = null;
    private playbackTimeout: NodeJS.Timeout | null = null;
    private recordingListeners: Set<RecordingEventListener> = new Set();
    private playbackListeners: Set<PlaybackEventListener> = new Set();
    private actionExecutor: ((action: RecordedAction) => Promise<any>) | null = null;

    constructor(recordingsDir: string) {
        this.recordingsDir = recordingsDir;
        this.ensureRecordingsDir();
    }

    private ensureRecordingsDir(): void {
        if (!fs.existsSync(this.recordingsDir)) {
            fs.mkdirSync(this.recordingsDir, { recursive: true });
        }
    }

    // Event listener management
    public onRecordingEvent(listener: RecordingEventListener): () => void {
        this.recordingListeners.add(listener);
        return () => this.recordingListeners.delete(listener);
    }

    public onPlaybackEvent(listener: PlaybackEventListener): () => void {
        this.playbackListeners.add(listener);
        return () => this.playbackListeners.delete(listener);
    }

    private emitRecordingEvent(event: RecordingEvent): void {
        this.recordingListeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.error('Error in recording event listener:', error);
            }
        });
    }

    private emitPlaybackEvent(event: PlaybackEvent): void {
        this.playbackListeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.error('Error in playback event listener:', error);
            }
        });
    }

    // Set the action executor for playback
    public setActionExecutor(executor: (action: RecordedAction) => Promise<any>): void {
        this.actionExecutor = executor;
    }

    // Recording control
    public startRecording(name: string, startUrl: string = ''): string {
        if (this.currentRecording) {
            throw new Error('Recording already in progress');
        }

        const id = uuidv4();
        this.currentRecording = {
            id,
            name,
            startTime: Date.now(),
            startUrl,
            actions: [],
            screenshots: []
        };

        console.log(`[Recorder] Started recording: ${name} (${id})`);

        this.emitRecordingEvent({
            type: 'recordingStarted',
            recordingId: id,
            recordingName: name
        });

        return id;
    }

    public stopRecording(): Recording | null {
        if (!this.currentRecording) {
            return null;
        }

        this.currentRecording.endTime = Date.now();
        const recording = this.currentRecording;

        // Save to disk
        this.saveRecording(recording);

        console.log(`[Recorder] Stopped recording: ${recording.name} (${recording.actions.length} actions, ${recording.screenshots.length} screenshots)`);

        this.emitRecordingEvent({
            type: 'recordingStopped',
            recordingId: recording.id,
            recordingName: recording.name,
            actionCount: recording.actions.length,
            screenshotCount: recording.screenshots.length
        });

        this.currentRecording = null;
        return recording;
    }

    public isRecording(): boolean {
        return this.currentRecording !== null;
    }

    public getCurrentRecordingId(): string | null {
        return this.currentRecording?.id ?? null;
    }

    // Record an action
    public recordAction(type: string, params: any, result?: any): RecordedAction | null {
        if (!this.currentRecording) {
            return null;
        }

        const action: RecordedAction = {
            id: uuidv4(),
            timestamp: Date.now(),
            type,
            params,
            result
        };

        this.currentRecording.actions.push(action);

        console.log(`[Recorder] Recorded action: ${type}`);

        this.emitRecordingEvent({
            type: 'actionRecorded',
            recordingId: this.currentRecording.id,
            action,
            actionCount: this.currentRecording.actions.length
        });

        return action;
    }

    // Record a screenshot
    public recordScreenshot(image: string, afterActionId?: string): RecordedScreenshot | null {
        if (!this.currentRecording) {
            return null;
        }

        const screenshot: RecordedScreenshot = {
            id: uuidv4(),
            timestamp: Date.now(),
            image,
            afterAction: afterActionId
        };

        this.currentRecording.screenshots.push(screenshot);

        this.emitRecordingEvent({
            type: 'screenshotRecorded',
            recordingId: this.currentRecording.id,
            screenshot,
            screenshotCount: this.currentRecording.screenshots.length
        });

        return screenshot;
    }

    // Save recording to disk
    private saveRecording(recording: Recording): void {
        const filename = `${recording.id}.json`;
        const filepath = path.join(this.recordingsDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(recording, null, 2));
        console.log(`[Recorder] Saved recording to: ${filepath}`);
    }

    // Load recording from disk
    public loadRecording(id: string): Recording | null {
        const filename = `${id}.json`;
        const filepath = path.join(this.recordingsDir, filename);

        if (!fs.existsSync(filepath)) {
            console.error(`[Recorder] Recording not found: ${id}`);
            return null;
        }

        try {
            const data = fs.readFileSync(filepath, 'utf-8');
            return JSON.parse(data) as Recording;
        } catch (error) {
            console.error(`[Recorder] Error loading recording: ${error}`);
            return null;
        }
    }

    // List all recordings
    public listRecordings(): RecordingInfo[] {
        this.ensureRecordingsDir();

        const files = fs.readdirSync(this.recordingsDir)
            .filter(f => f.endsWith('.json'));

        const recordings: RecordingInfo[] = [];

        for (const file of files) {
            try {
                const filepath = path.join(this.recordingsDir, file);
                const data = fs.readFileSync(filepath, 'utf-8');
                const recording: Recording = JSON.parse(data);

                recordings.push({
                    id: recording.id,
                    name: recording.name,
                    startTime: recording.startTime,
                    endTime: recording.endTime,
                    startUrl: recording.startUrl,
                    actionCount: recording.actions.length,
                    screenshotCount: recording.screenshots.length,
                    duration: recording.endTime
                        ? recording.endTime - recording.startTime
                        : undefined
                });
            } catch (error) {
                console.error(`[Recorder] Error reading recording file ${file}:`, error);
            }
        }

        // Sort by start time, newest first
        recordings.sort((a, b) => b.startTime - a.startTime);

        return recordings;
    }

    // Delete a recording
    public deleteRecording(id: string): boolean {
        const filename = `${id}.json`;
        const filepath = path.join(this.recordingsDir, filename);

        if (!fs.existsSync(filepath)) {
            return false;
        }

        try {
            fs.unlinkSync(filepath);
            console.log(`[Recorder] Deleted recording: ${id}`);
            return true;
        } catch (error) {
            console.error(`[Recorder] Error deleting recording: ${error}`);
            return false;
        }
    }

    // Playback control
    public async startPlayback(recordingId: string, speed: number = 1): Promise<boolean> {
        if (this.playbackState?.isPlaying) {
            throw new Error('Playback already in progress');
        }

        const recording = this.loadRecording(recordingId);
        if (!recording) {
            return false;
        }

        if (recording.actions.length === 0) {
            console.log('[Recorder] Recording has no actions to play');
            return false;
        }

        this.playbackState = {
            recording,
            currentIndex: 0,
            speed: Math.max(0.1, Math.min(10, speed)), // Clamp speed between 0.1x and 10x
            isPaused: false,
            isPlaying: true,
            startedAt: Date.now()
        };

        console.log(`[Recorder] Starting playback: ${recording.name} at ${speed}x speed`);

        this.emitPlaybackEvent({
            type: 'playbackStarted',
            recordingId,
            totalActions: recording.actions.length,
            progress: 0
        });

        // Start executing actions
        this.executeNextAction();

        return true;
    }

    private async executeNextAction(): Promise<void> {
        if (!this.playbackState || !this.playbackState.isPlaying) {
            return;
        }

        if (this.playbackState.isPaused) {
            return;
        }

        const { recording, currentIndex, speed } = this.playbackState;

        if (currentIndex >= recording.actions.length) {
            // Playback complete
            this.completePlayback();
            return;
        }

        const action = recording.actions[currentIndex];
        const progress = (currentIndex / recording.actions.length) * 100;

        this.emitPlaybackEvent({
            type: 'actionExecuting',
            recordingId: recording.id,
            currentIndex,
            totalActions: recording.actions.length,
            action,
            progress
        });

        // Execute the action
        try {
            if (this.actionExecutor) {
                const result = await this.actionExecutor(action);
                action.result = result;
            }

            this.emitPlaybackEvent({
                type: 'actionExecuted',
                recordingId: recording.id,
                currentIndex,
                totalActions: recording.actions.length,
                action,
                progress
            });

            // Find and display screenshot taken after this action
            const screenshot = recording.screenshots.find(s => s.afterAction === action.id);
            if (screenshot) {
                this.emitPlaybackEvent({
                    type: 'screenshotDisplayed',
                    recordingId: recording.id,
                    screenshot,
                    progress
                });
            }

        } catch (error) {
            console.error(`[Recorder] Error executing action:`, error);
            this.emitPlaybackEvent({
                type: 'playbackError',
                recordingId: recording.id,
                currentIndex,
                action,
                error: String(error)
            });
        }

        // Move to next action
        this.playbackState.currentIndex++;

        // Calculate delay to next action
        if (this.playbackState.currentIndex < recording.actions.length) {
            const nextAction = recording.actions[this.playbackState.currentIndex];
            const delay = Math.max(0, (nextAction.timestamp - action.timestamp) / speed);

            // Schedule next action with adjusted timing
            this.playbackTimeout = setTimeout(() => {
                this.executeNextAction();
            }, Math.min(delay, 5000)); // Cap at 5 seconds max delay
        } else {
            this.completePlayback();
        }
    }

    private completePlayback(): void {
        if (!this.playbackState) return;

        const recordingId = this.playbackState.recording.id;

        this.emitPlaybackEvent({
            type: 'playbackComplete',
            recordingId,
            progress: 100
        });

        console.log(`[Recorder] Playback complete: ${this.playbackState.recording.name}`);

        this.playbackState = null;
        if (this.playbackTimeout) {
            clearTimeout(this.playbackTimeout);
            this.playbackTimeout = null;
        }
    }

    public pausePlayback(): boolean {
        if (!this.playbackState || !this.playbackState.isPlaying) {
            return false;
        }

        this.playbackState.isPaused = true;

        if (this.playbackTimeout) {
            clearTimeout(this.playbackTimeout);
            this.playbackTimeout = null;
        }

        this.emitPlaybackEvent({
            type: 'playbackPaused',
            recordingId: this.playbackState.recording.id,
            currentIndex: this.playbackState.currentIndex,
            totalActions: this.playbackState.recording.actions.length,
            progress: (this.playbackState.currentIndex / this.playbackState.recording.actions.length) * 100
        });

        console.log('[Recorder] Playback paused');
        return true;
    }

    public resumePlayback(): boolean {
        if (!this.playbackState || !this.playbackState.isPaused) {
            return false;
        }

        this.playbackState.isPaused = false;

        this.emitPlaybackEvent({
            type: 'playbackResumed',
            recordingId: this.playbackState.recording.id,
            currentIndex: this.playbackState.currentIndex,
            totalActions: this.playbackState.recording.actions.length
        });

        console.log('[Recorder] Playback resumed');

        // Continue execution
        this.executeNextAction();

        return true;
    }

    public stopPlayback(): boolean {
        if (!this.playbackState) {
            return false;
        }

        const recordingId = this.playbackState.recording.id;

        if (this.playbackTimeout) {
            clearTimeout(this.playbackTimeout);
            this.playbackTimeout = null;
        }

        this.emitPlaybackEvent({
            type: 'playbackStopped',
            recordingId,
            currentIndex: this.playbackState.currentIndex,
            totalActions: this.playbackState.recording.actions.length
        });

        console.log('[Recorder] Playback stopped');

        this.playbackState = null;
        return true;
    }

    public setPlaybackSpeed(speed: number): boolean {
        if (!this.playbackState) {
            return false;
        }

        this.playbackState.speed = Math.max(0.1, Math.min(10, speed));
        console.log(`[Recorder] Playback speed set to: ${this.playbackState.speed}x`);
        return true;
    }

    public stepForward(): boolean {
        if (!this.playbackState || !this.playbackState.isPaused) {
            return false;
        }

        // Execute single action
        this.executeNextAction();
        return true;
    }

    public getPlaybackState(): PlaybackState | null {
        return this.playbackState;
    }

    public isPlaying(): boolean {
        return this.playbackState?.isPlaying ?? false;
    }

    // Export recording to different formats
    public exportRecording(id: string, format: 'json' | 'playwright' | 'puppeteer' | 'cypress'): string | null {
        const recording = this.loadRecording(id);
        if (!recording) {
            return null;
        }

        switch (format) {
            case 'json':
                return JSON.stringify(recording, null, 2);

            case 'playwright':
                return this.exportToPlaywright(recording);

            case 'puppeteer':
                return this.exportToPuppeteer(recording);

            case 'cypress':
                return this.exportToCypress(recording);

            default:
                return null;
        }
    }

    private exportToPlaywright(recording: Recording): string {
        const lines: string[] = [
            "import { test, expect } from '@playwright/test';",
            "",
            `test('${this.escapeString(recording.name)}', async ({ page }) => {`
        ];

        if (recording.startUrl) {
            lines.push(`    await page.goto('${this.escapeString(recording.startUrl)}');`);
        }

        for (const action of recording.actions) {
            const code = this.actionToPlaywright(action);
            if (code) {
                lines.push(`    ${code}`);
            }
        }

        lines.push('});');
        lines.push('');

        return lines.join('\n');
    }

    private actionToPlaywright(action: RecordedAction): string | null {
        switch (action.type) {
            case 'click':
                return `await page.mouse.click(${action.params.x}, ${action.params.y});`;

            case 'dblclick':
                return `await page.mouse.dblclick(${action.params.x}, ${action.params.y});`;

            case 'type':
                return `await page.keyboard.type('${this.escapeString(action.params.text)}');`;

            case 'press':
                return `await page.keyboard.press('${this.escapeString(action.params.key)}');`;

            case 'scroll':
                return `await page.mouse.wheel(${action.params.deltaX || 0}, ${action.params.deltaY || 0});`;

            case 'navigate':
                return `await page.goto('${this.escapeString(action.params.url)}');`;

            case 'reload':
                return `await page.reload();`;

            case 'back':
                return `await page.goBack();`;

            case 'forward':
                return `await page.goForward();`;

            case 'hover':
                return `await page.mouse.move(${action.params.x}, ${action.params.y});`;

            default:
                return `// Unknown action: ${action.type}`;
        }
    }

    private exportToPuppeteer(recording: Recording): string {
        const lines: string[] = [
            "const puppeteer = require('puppeteer');",
            "",
            "(async () => {",
            "    const browser = await puppeteer.launch();",
            "    const page = await browser.newPage();",
            ""
        ];

        if (recording.startUrl) {
            lines.push(`    await page.goto('${this.escapeString(recording.startUrl)}');`);
        }

        for (const action of recording.actions) {
            const code = this.actionToPuppeteer(action);
            if (code) {
                lines.push(`    ${code}`);
            }
        }

        lines.push('');
        lines.push('    await browser.close();');
        lines.push('})();');
        lines.push('');

        return lines.join('\n');
    }

    private actionToPuppeteer(action: RecordedAction): string | null {
        switch (action.type) {
            case 'click':
                return `await page.mouse.click(${action.params.x}, ${action.params.y});`;

            case 'dblclick':
                return `await page.mouse.click(${action.params.x}, ${action.params.y}, { clickCount: 2 });`;

            case 'type':
                return `await page.keyboard.type('${this.escapeString(action.params.text)}');`;

            case 'press':
                return `await page.keyboard.press('${this.escapeString(action.params.key)}');`;

            case 'scroll':
                return `await page.evaluate(() => window.scrollBy(${action.params.deltaX || 0}, ${action.params.deltaY || 0}));`;

            case 'navigate':
                return `await page.goto('${this.escapeString(action.params.url)}');`;

            case 'reload':
                return `await page.reload();`;

            case 'back':
                return `await page.goBack();`;

            case 'forward':
                return `await page.goForward();`;

            case 'hover':
                return `await page.mouse.move(${action.params.x}, ${action.params.y});`;

            default:
                return `// Unknown action: ${action.type}`;
        }
    }

    private exportToCypress(recording: Recording): string {
        const lines: string[] = [
            `describe('${this.escapeString(recording.name)}', () => {`,
            `    it('should replay recorded actions', () => {`
        ];

        if (recording.startUrl) {
            lines.push(`        cy.visit('${this.escapeString(recording.startUrl)}');`);
        }

        for (const action of recording.actions) {
            const code = this.actionToCypress(action);
            if (code) {
                lines.push(`        ${code}`);
            }
        }

        lines.push('    });');
        lines.push('});');
        lines.push('');

        return lines.join('\n');
    }

    private actionToCypress(action: RecordedAction): string | null {
        switch (action.type) {
            case 'click':
                return `cy.get('body').click(${action.params.x}, ${action.params.y});`;

            case 'dblclick':
                return `cy.get('body').dblclick(${action.params.x}, ${action.params.y});`;

            case 'type':
                return `cy.focused().type('${this.escapeString(action.params.text)}');`;

            case 'press':
                return `cy.focused().type('{${action.params.key.toLowerCase()}}');`;

            case 'scroll':
                return `cy.scrollTo(${action.params.deltaX || 0}, ${action.params.deltaY || 0});`;

            case 'navigate':
                return `cy.visit('${this.escapeString(action.params.url)}');`;

            case 'reload':
                return `cy.reload();`;

            case 'back':
                return `cy.go('back');`;

            case 'forward':
                return `cy.go('forward');`;

            default:
                return `// Unknown action: ${action.type}`;
        }
    }

    private escapeString(str: string): string {
        return str
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }
}

// Singleton instance
let recorderInstance: SessionRecorder | null = null;

export function getRecorder(recordingsDir?: string): SessionRecorder {
    if (!recorderInstance) {
        const dir = recordingsDir || path.join(__dirname, 'recordings');
        recorderInstance = new SessionRecorder(dir);
    }
    return recorderInstance;
}

export function createRecorder(recordingsDir: string): SessionRecorder {
    return new SessionRecorder(recordingsDir);
}
