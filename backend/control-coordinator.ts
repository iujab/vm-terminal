/**
 * Control Coordinator for bidirectional browser control
 * Manages action queues, priorities, locks, and conflict resolution
 */

export type ControlSource = 'user' | 'ai';
export type ControlMode = 'shared' | 'user-only' | 'ai-only' | 'locked';

export interface QueuedAction {
    id: string;
    source: ControlSource;
    action: any;
    priority: number;
    timestamp: number;
    callback?: (result: ActionResult) => void;
}

export interface ActionResult {
    success: boolean;
    actionId: string;
    error?: string;
    data?: any;
}

export interface ControlState {
    mode: ControlMode;
    lockedBy: ControlSource | null;
    lockExpiry: number | null;
    activeController: ControlSource | null;
    queueLength: number;
    lastAction: {
        source: ControlSource;
        type: string;
        timestamp: number;
    } | null;
}

export interface ActionHistoryEntry {
    id: string;
    source: ControlSource;
    action: any;
    timestamp: number;
    result: ActionResult | null;
    duration: number | null;
}

// Priority levels (higher = more priority)
const PRIORITY = {
    USER_IMMEDIATE: 100,
    USER_NORMAL: 80,
    AI_IMMEDIATE: 60,
    AI_NORMAL: 40,
    BACKGROUND: 10
};

// Lock timeout in milliseconds
const DEFAULT_LOCK_TIMEOUT = 30000; // 30 seconds
const MAX_LOCK_TIMEOUT = 300000; // 5 minutes

// Action history limit
const MAX_HISTORY_SIZE = 1000;

/**
 * ControlCoordinator manages bidirectional control between user and AI
 */
export class ControlCoordinator {
    private mode: ControlMode = 'shared';
    private lockedBy: ControlSource | null = null;
    private lockExpiry: number | null = null;
    private activeController: ControlSource | null = null;

    private actionQueue: QueuedAction[] = [];
    private actionHistory: ActionHistoryEntry[] = [];
    private pendingActions: Map<string, QueuedAction> = new Map();

    private actionIdCounter = 0;
    private processingQueue = false;

    private onStateChange: ((state: ControlState) => void) | null = null;
    private onActionQueued: ((action: QueuedAction) => void) | null = null;
    private onActionExecute: ((action: QueuedAction) => Promise<ActionResult>) | null = null;

    constructor() {
        // Start lock expiry checker
        setInterval(() => this.checkLockExpiry(), 1000);
    }

    /**
     * Set callback for state changes
     */
    setOnStateChange(callback: (state: ControlState) => void) {
        this.onStateChange = callback;
    }

    /**
     * Set callback for when actions are queued
     */
    setOnActionQueued(callback: (action: QueuedAction) => void) {
        this.onActionQueued = callback;
    }

    /**
     * Set callback for executing actions
     */
    setOnActionExecute(callback: (action: QueuedAction) => Promise<ActionResult>) {
        this.onActionExecute = callback;
    }

    /**
     * Get current control state
     */
    getState(): ControlState {
        return {
            mode: this.mode,
            lockedBy: this.lockedBy,
            lockExpiry: this.lockExpiry,
            activeController: this.activeController,
            queueLength: this.actionQueue.length,
            lastAction: this.getLastAction()
        };
    }

    /**
     * Set control mode
     */
    setMode(mode: ControlMode, requestedBy: ControlSource): { success: boolean; error?: string } {
        // Check if the source can change the mode
        if (this.lockedBy && this.lockedBy !== requestedBy) {
            return { success: false, error: `Control is locked by ${this.lockedBy}` };
        }

        // User can always change mode, AI needs permission in user-only mode
        if (this.mode === 'user-only' && requestedBy === 'ai' && mode !== 'user-only') {
            return { success: false, error: 'User-only mode is active, AI cannot change mode' };
        }

        const previousMode = this.mode;
        this.mode = mode;

        console.log(`[ControlCoordinator] Mode changed from ${previousMode} to ${mode} by ${requestedBy}`);

        // Clear queue if switching to locked mode
        if (mode === 'locked') {
            this.clearQueue();
        }

        this.notifyStateChange();
        return { success: true };
    }

    /**
     * Request exclusive control lock
     */
    requestLock(source: ControlSource, timeoutMs: number = DEFAULT_LOCK_TIMEOUT): { success: boolean; error?: string } {
        // Check if already locked
        if (this.lockedBy && this.lockedBy !== source) {
            return { success: false, error: `Control is already locked by ${this.lockedBy}` };
        }

        // Check mode permissions
        if (this.mode === 'user-only' && source === 'ai') {
            return { success: false, error: 'AI cannot lock control in user-only mode' };
        }
        if (this.mode === 'ai-only' && source === 'user') {
            return { success: false, error: 'User cannot lock control in AI-only mode' };
        }
        if (this.mode === 'locked') {
            return { success: false, error: 'Control is in locked mode' };
        }

        // Enforce max timeout
        const actualTimeout = Math.min(timeoutMs, MAX_LOCK_TIMEOUT);

        this.lockedBy = source;
        this.lockExpiry = Date.now() + actualTimeout;

        console.log(`[ControlCoordinator] Control locked by ${source} for ${actualTimeout}ms`);
        this.notifyStateChange();
        return { success: true };
    }

    /**
     * Release control lock
     */
    releaseLock(source: ControlSource): { success: boolean; error?: string } {
        if (!this.lockedBy) {
            return { success: true }; // Already unlocked
        }

        if (this.lockedBy !== source) {
            // User can always force release
            if (source !== 'user') {
                return { success: false, error: `Only ${this.lockedBy} or user can release the lock` };
            }
        }

        this.lockedBy = null;
        this.lockExpiry = null;

        console.log(`[ControlCoordinator] Control lock released by ${source}`);
        this.notifyStateChange();

        // Process any queued actions
        this.processQueue();

        return { success: true };
    }

    /**
     * Check and handle lock expiry
     */
    private checkLockExpiry() {
        if (this.lockedBy && this.lockExpiry && Date.now() > this.lockExpiry) {
            console.log(`[ControlCoordinator] Lock by ${this.lockedBy} expired`);
            this.lockedBy = null;
            this.lockExpiry = null;
            this.notifyStateChange();
            this.processQueue();
        }
    }

    /**
     * Submit an action for execution
     */
    submitAction(
        source: ControlSource,
        action: any,
        options: {
            priority?: 'immediate' | 'normal' | 'background';
            callback?: (result: ActionResult) => void;
        } = {}
    ): { success: boolean; actionId?: string; error?: string; queued?: boolean } {
        // Check if action is allowed
        const canAct = this.canPerformAction(source);
        if (!canAct.allowed) {
            return { success: false, error: canAct.reason };
        }

        // Generate action ID
        const actionId = `${source}-${++this.actionIdCounter}-${Date.now()}`;

        // Determine priority
        let priority: number;
        switch (options.priority) {
            case 'immediate':
                priority = source === 'user' ? PRIORITY.USER_IMMEDIATE : PRIORITY.AI_IMMEDIATE;
                break;
            case 'background':
                priority = PRIORITY.BACKGROUND;
                break;
            default:
                priority = source === 'user' ? PRIORITY.USER_NORMAL : PRIORITY.AI_NORMAL;
        }

        const queuedAction: QueuedAction = {
            id: actionId,
            source,
            action,
            priority,
            timestamp: Date.now(),
            callback: options.callback
        };

        // Check for conflicts
        const conflict = this.detectConflict(queuedAction);
        if (conflict) {
            console.log(`[ControlCoordinator] Conflict detected: ${conflict.reason}`);
            // Resolve based on priority
            if (this.shouldRejectForConflict(queuedAction, conflict)) {
                return { success: false, error: `Conflict: ${conflict.reason}` };
            }
            // Otherwise, the conflicting action in queue will be resolved
        }

        // Add to queue
        this.actionQueue.push(queuedAction);
        this.sortQueue();

        console.log(`[ControlCoordinator] Action ${actionId} queued (source: ${source}, priority: ${priority})`);

        if (this.onActionQueued) {
            this.onActionQueued(queuedAction);
        }

        // Try to process immediately
        this.processQueue();

        return {
            success: true,
            actionId,
            queued: this.actionQueue.some(a => a.id === actionId)
        };
    }

    /**
     * Check if a source can perform actions
     */
    canPerformAction(source: ControlSource): { allowed: boolean; reason?: string } {
        // Locked mode blocks everyone
        if (this.mode === 'locked') {
            return { allowed: false, reason: 'Control is in locked mode (view only)' };
        }

        // Check mode restrictions
        if (this.mode === 'user-only' && source === 'ai') {
            return { allowed: false, reason: 'Only user can control in user-only mode' };
        }
        if (this.mode === 'ai-only' && source === 'user') {
            return { allowed: false, reason: 'Only AI can control in AI-only mode' };
        }

        // Check lock
        if (this.lockedBy && this.lockedBy !== source) {
            return { allowed: false, reason: `Control is locked by ${this.lockedBy}` };
        }

        return { allowed: true };
    }

    /**
     * Detect conflicts between actions
     */
    private detectConflict(newAction: QueuedAction): { action: QueuedAction; reason: string } | null {
        // Check against pending actions
        for (const [id, pending] of this.pendingActions) {
            if (this.actionsConflict(newAction.action, pending.action)) {
                return { action: pending, reason: 'Conflicts with pending action' };
            }
        }

        // Check against queued actions
        for (const queued of this.actionQueue) {
            if (this.actionsConflict(newAction.action, queued.action)) {
                return { action: queued, reason: 'Conflicts with queued action' };
            }
        }

        return null;
    }

    /**
     * Check if two actions conflict
     */
    private actionsConflict(a: any, b: any): boolean {
        // Click at same position
        if (a.type === 'click' && b.type === 'click') {
            const distance = Math.sqrt(
                Math.pow((a.x || 0) - (b.x || 0), 2) +
                Math.pow((a.y || 0) - (b.y || 0), 2)
            );
            return distance < 50; // Within 50px
        }

        // Scroll in opposite directions
        if (a.type === 'scroll' && b.type === 'scroll') {
            return (a.deltaY > 0 && b.deltaY < 0) || (a.deltaY < 0 && b.deltaY > 0);
        }

        // Type overwrites
        if (a.type === 'type' && b.type === 'type') {
            return true; // Two typing actions conflict
        }

        // Navigate conflicts with everything
        if (a.type === 'navigate' || b.type === 'navigate') {
            return true;
        }

        return false;
    }

    /**
     * Determine if action should be rejected due to conflict
     */
    private shouldRejectForConflict(newAction: QueuedAction, conflict: { action: QueuedAction; reason: string }): boolean {
        // In shared mode, higher priority wins
        if (this.mode === 'shared') {
            return newAction.priority < conflict.action.priority;
        }
        return false;
    }

    /**
     * Sort queue by priority (highest first), then by timestamp (oldest first)
     */
    private sortQueue() {
        this.actionQueue.sort((a, b) => {
            if (b.priority !== a.priority) {
                return b.priority - a.priority;
            }
            return a.timestamp - b.timestamp;
        });
    }

    /**
     * Process the action queue
     */
    private async processQueue() {
        if (this.processingQueue) {
            return;
        }

        this.processingQueue = true;

        while (this.actionQueue.length > 0) {
            const action = this.actionQueue[0];

            // Check if action can still be performed
            const canAct = this.canPerformAction(action.source);
            if (!canAct.allowed) {
                // Remove action and notify failure
                this.actionQueue.shift();
                this.recordHistory(action, {
                    success: false,
                    actionId: action.id,
                    error: canAct.reason
                }, 0);
                if (action.callback) {
                    action.callback({ success: false, actionId: action.id, error: canAct.reason });
                }
                continue;
            }

            // Execute action
            this.actionQueue.shift();
            this.pendingActions.set(action.id, action);
            this.activeController = action.source;
            this.notifyStateChange();

            const startTime = Date.now();
            let result: ActionResult;

            try {
                if (this.onActionExecute) {
                    result = await this.onActionExecute(action);
                } else {
                    result = { success: true, actionId: action.id };
                }
            } catch (error) {
                result = {
                    success: false,
                    actionId: action.id,
                    error: error instanceof Error ? error.message : String(error)
                };
            }

            const duration = Date.now() - startTime;
            this.pendingActions.delete(action.id);
            this.recordHistory(action, result, duration);

            if (action.callback) {
                action.callback(result);
            }

            // Small delay between actions to prevent overwhelming
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        this.activeController = null;
        this.processingQueue = false;
        this.notifyStateChange();
    }

    /**
     * Record action in history
     */
    private recordHistory(action: QueuedAction, result: ActionResult, duration: number) {
        const entry: ActionHistoryEntry = {
            id: action.id,
            source: action.source,
            action: action.action,
            timestamp: action.timestamp,
            result,
            duration
        };

        this.actionHistory.push(entry);

        // Trim history if too large
        if (this.actionHistory.length > MAX_HISTORY_SIZE) {
            this.actionHistory = this.actionHistory.slice(-MAX_HISTORY_SIZE);
        }
    }

    /**
     * Get action history
     */
    getHistory(options: {
        source?: ControlSource;
        limit?: number;
        since?: number;
    } = {}): ActionHistoryEntry[] {
        let history = [...this.actionHistory];

        if (options.source) {
            history = history.filter(h => h.source === options.source);
        }
        if (options.since !== undefined) {
            const since = options.since;
            history = history.filter(h => h.timestamp >= since);
        }
        if (options.limit) {
            history = history.slice(-options.limit);
        }

        return history;
    }

    /**
     * Get last action info
     */
    private getLastAction(): ControlState['lastAction'] {
        if (this.actionHistory.length === 0) {
            return null;
        }
        const last = this.actionHistory[this.actionHistory.length - 1];
        return {
            source: last.source,
            type: last.action.type,
            timestamp: last.timestamp
        };
    }

    /**
     * Clear the action queue
     */
    clearQueue(source?: ControlSource) {
        if (source) {
            this.actionQueue = this.actionQueue.filter(a => a.source !== source);
        } else {
            this.actionQueue = [];
        }
        this.notifyStateChange();
    }

    /**
     * Notify listeners of state change
     */
    private notifyStateChange() {
        if (this.onStateChange) {
            this.onStateChange(this.getState());
        }
    }

    /**
     * Cancel a specific pending action
     */
    cancelAction(actionId: string, requestedBy: ControlSource): { success: boolean; error?: string } {
        // Check queue
        const queueIndex = this.actionQueue.findIndex(a => a.id === actionId);
        if (queueIndex !== -1) {
            const action = this.actionQueue[queueIndex];
            // Only same source or user can cancel
            if (action.source !== requestedBy && requestedBy !== 'user') {
                return { success: false, error: 'Cannot cancel action from different source' };
            }
            this.actionQueue.splice(queueIndex, 1);
            return { success: true };
        }

        // Check pending (cannot cancel already executing)
        if (this.pendingActions.has(actionId)) {
            return { success: false, error: 'Cannot cancel action that is already executing' };
        }

        return { success: false, error: 'Action not found' };
    }

    /**
     * Get current queue status
     */
    getQueueStatus(): {
        total: number;
        bySource: { user: number; ai: number };
        oldest: number | null;
    } {
        const bySource = { user: 0, ai: 0 };
        let oldest: number | null = null;

        for (const action of this.actionQueue) {
            bySource[action.source]++;
            if (oldest === null || action.timestamp < oldest) {
                oldest = action.timestamp;
            }
        }

        return {
            total: this.actionQueue.length,
            bySource,
            oldest
        };
    }
}

// Singleton instance
let coordinatorInstance: ControlCoordinator | null = null;

export function getControlCoordinator(): ControlCoordinator {
    if (!coordinatorInstance) {
        coordinatorInstance = new ControlCoordinator();
    }
    return coordinatorInstance;
}

export function createControlCoordinator(): ControlCoordinator {
    return new ControlCoordinator();
}
