/**
 * Voice Commands Handler for Playwright Assistant
 * Parses natural language commands and maps them to browser actions
 */

import { WebSocket } from 'ws';

// Types for voice commands
export interface VoiceCommand {
    type: 'voiceCommand';
    text?: string;
    action?: string;
    target?: string;
    value?: string;
    needsInterpretation?: boolean;
}

export interface VoiceCommandResult {
    type: 'voiceCommandResult';
    success: boolean;
    action: string;
    message?: string;
    interpretation?: string;
    speak?: string;
}

export interface ElementSearchResult {
    type: 'elementFound';
    found: boolean;
    element?: string;
    description?: string;
    suggestions?: string[];
    ref?: string;
    boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface AccessibilityNode {
    role: string;
    name: string;
    description?: string;
    ref?: string;
    children?: AccessibilityNode[];
    boundingBox?: { x: number; y: number; width: number; height: number };
}

// Command patterns for natural language parsing
const commandPatterns: { pattern: RegExp; action: string; extract: (match: RegExpMatchArray) => any }[] = [
    // Click commands
    {
        pattern: /^(?:click|press|tap|select|hit)(?: on| the)?\s+(.+)$/i,
        action: 'click',
        extract: (match) => ({ target: match[1].trim() })
    },

    // Type commands
    {
        pattern: /^(?:type|write|enter|input)\s+(.+)$/i,
        action: 'type',
        extract: (match) => ({ value: match[1].trim() })
    },

    // Navigation commands
    {
        pattern: /^(?:go to|navigate to|open|visit|load)\s+(.+)$/i,
        action: 'navigate',
        extract: (match) => ({ url: normalizeUrl(match[1].trim()) })
    },

    // Scroll commands
    {
        pattern: /^scroll\s+(up|down|left|right|to top|to bottom)$/i,
        action: 'scroll',
        extract: (match) => ({ direction: match[1].toLowerCase() })
    },

    // Back/Forward
    {
        pattern: /^(?:go )?back$/i,
        action: 'back',
        extract: () => ({})
    },
    {
        pattern: /^(?:go )?forward$/i,
        action: 'forward',
        extract: () => ({})
    },

    // Refresh
    {
        pattern: /^(?:refresh|reload)(?: page)?$/i,
        action: 'reload',
        extract: () => ({})
    },

    // Tab commands
    {
        pattern: /^(?:new tab|open (?:new )?tab|create tab)$/i,
        action: 'newTab',
        extract: () => ({})
    },
    {
        pattern: /^(?:close tab|close (?:this|current) tab)$/i,
        action: 'closeTab',
        extract: () => ({})
    },

    // Screenshot
    {
        pattern: /^(?:take (?:a )?screenshot|screenshot|capture(?: screen)?)$/i,
        action: 'screenshot',
        extract: () => ({ save: true })
    },

    // Recording
    {
        pattern: /^(?:start recording|begin recording|record)$/i,
        action: 'startRecording',
        extract: () => ({})
    },
    {
        pattern: /^(?:stop recording|end recording|stop record)$/i,
        action: 'stopRecording',
        extract: () => ({})
    },

    // Search/Find
    {
        pattern: /^(?:search for|search|find|look for)\s+(.+)$/i,
        action: 'search',
        extract: (match) => ({ query: match[1].trim() })
    },

    // Focus
    {
        pattern: /^focus(?: on)?\s+(.+)$/i,
        action: 'focus',
        extract: (match) => ({ target: match[1].trim() })
    },

    // Fill form
    {
        pattern: /^fill\s+(.+)\s+with\s+(.+)$/i,
        action: 'fill',
        extract: (match) => ({ target: match[1].trim(), value: match[2].trim() })
    },

    // Select option
    {
        pattern: /^select\s+(.+)\s+(?:in|from)\s+(.+)$/i,
        action: 'select',
        extract: (match) => ({ value: match[1].trim(), target: match[2].trim() })
    },

    // Check/Uncheck
    {
        pattern: /^(?:check|tick)\s+(.+)$/i,
        action: 'check',
        extract: (match) => ({ target: match[1].trim() })
    },
    {
        pattern: /^(?:uncheck|untick)\s+(.+)$/i,
        action: 'uncheck',
        extract: (match) => ({ target: match[1].trim() })
    },

    // Wait
    {
        pattern: /^wait\s+(?:for\s+)?(\d+)\s*(?:seconds?|s)?$/i,
        action: 'wait',
        extract: (match) => ({ seconds: parseInt(match[1], 10) })
    },
    {
        pattern: /^wait\s+for\s+(.+)$/i,
        action: 'waitFor',
        extract: (match) => ({ target: match[1].trim() })
    }
];

// Scroll direction mappings
const scrollDirections: { [key: string]: { deltaX: number; deltaY: number } } = {
    'up': { deltaX: 0, deltaY: -300 },
    'down': { deltaX: 0, deltaY: 300 },
    'left': { deltaX: -300, deltaY: 0 },
    'right': { deltaX: 300, deltaY: 0 },
    'to top': { deltaX: 0, deltaY: -99999 },
    'to bottom': { deltaX: 0, deltaY: 99999 }
};

/**
 * Normalize a URL from voice input
 */
function normalizeUrl(text: string): string {
    // Handle common spoken URL patterns
    let url = text
        .replace(/\s+/g, '')
        .replace(/dot\s*/gi, '.')
        .replace(/slash\s*/gi, '/')
        .replace(/colon\s*/gi, ':');

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    return url;
}

/**
 * Calculate similarity between two strings (Levenshtein-based)
 */
function stringSimilarity(s1: string, s2: string): number {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) return 1.0;

    const editDistance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
    return (longer.length - editDistance) / longer.length;
}

/**
 * Levenshtein distance calculation
 */
function levenshteinDistance(s1: string, s2: string): number {
    const costs: number[] = [];

    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) {
            costs[s2.length] = lastValue;
        }
    }

    return costs[s2.length];
}

/**
 * Parse natural language command
 */
export function parseVoiceCommand(text: string): { action: string; params: any } | null {
    const normalizedText = text.toLowerCase().trim();

    for (const { pattern, action, extract } of commandPatterns) {
        const match = normalizedText.match(pattern);
        if (match) {
            return {
                action,
                params: extract(match)
            };
        }
    }

    return null;
}

/**
 * Find element by description in accessibility tree
 */
export function findElementByDescription(
    description: string,
    snapshot: AccessibilityNode[],
    threshold: number = 0.5
): { element: AccessibilityNode | null; suggestions: string[] } {
    const normalizedDesc = description.toLowerCase().trim();
    const suggestions: { name: string; score: number }[] = [];

    // Use an object to hold mutable state that works with closures
    const result: { bestMatch: { node: AccessibilityNode; score: number } | null } = { bestMatch: null };

    function searchNode(node: AccessibilityNode) {
        // Check name
        if (node.name) {
            const nameScore = stringSimilarity(normalizedDesc, node.name.toLowerCase());

            if (nameScore > threshold) {
                if (!result.bestMatch || nameScore > result.bestMatch.score) {
                    result.bestMatch = { node, score: nameScore };
                }

                if (nameScore > 0.3) {
                    suggestions.push({ name: node.name, score: nameScore });
                }
            }
        }

        // Check role + name combination
        if (node.role) {
            const roleNameScore = stringSimilarity(
                normalizedDesc,
                `${node.role} ${node.name || ''}`.toLowerCase()
            );

            if (roleNameScore > threshold && (!result.bestMatch || roleNameScore > result.bestMatch.score)) {
                result.bestMatch = { node, score: roleNameScore };
            }
        }

        // Check description
        if (node.description) {
            const descScore = stringSimilarity(normalizedDesc, node.description.toLowerCase());

            if (descScore > threshold && (!result.bestMatch || descScore > result.bestMatch.score)) {
                result.bestMatch = { node, score: descScore };
            }
        }

        // Search children
        if (node.children) {
            for (const child of node.children) {
                searchNode(child);
            }
        }
    }

    // Search all root nodes
    for (const node of snapshot) {
        searchNode(node);
    }

    // Sort suggestions by score
    suggestions.sort((a, b) => b.score - a.score);

    return {
        element: result.bestMatch ? result.bestMatch.node : null,
        suggestions: suggestions.slice(0, 5).map(s => s.name)
    };
}

/**
 * Voice Commands Handler class
 */
export class VoiceCommandHandler {
    private currentSnapshot: AccessibilityNode[] = [];

    /**
     * Update the accessibility snapshot
     */
    updateSnapshot(snapshot: AccessibilityNode[]) {
        this.currentSnapshot = snapshot;
    }

    /**
     * Process a voice command
     */
    async processCommand(
        command: VoiceCommand,
        sendAction: (action: any) => void
    ): Promise<VoiceCommandResult> {
        // If we have a pre-parsed action
        if (command.action && !command.needsInterpretation) {
            return this.executeAction(command.action, command, sendAction);
        }

        // Parse the text
        if (command.text) {
            const parsed = parseVoiceCommand(command.text);

            if (parsed) {
                return this.executeAction(parsed.action, { ...command, ...parsed.params }, sendAction);
            }

            // If parsing failed and needs interpretation, try AI
            if (command.needsInterpretation) {
                return this.interpretWithAI(command.text, sendAction);
            }
        }

        return {
            type: 'voiceCommandResult',
            success: false,
            action: 'unknown',
            message: 'Could not understand the command',
            interpretation: command.text
        };
    }

    /**
     * Execute a parsed action
     */
    private async executeAction(
        action: string,
        params: any,
        sendAction: (action: any) => void
    ): Promise<VoiceCommandResult> {
        let message = '';
        let speak = '';

        switch (action) {
            case 'click':
                if (params.target) {
                    const result = findElementByDescription(params.target, this.currentSnapshot);

                    if (result.element) {
                        // Click using ref if available, otherwise coordinates
                        if (result.element.ref) {
                            sendAction({ type: 'click', ref: result.element.ref });
                        } else if (result.element.boundingBox) {
                            const { x, y, width, height } = result.element.boundingBox;
                            sendAction({
                                type: 'click',
                                x: x + width / 2,
                                y: y + height / 2
                            });
                        }
                        message = `Clicked "${result.element.name || params.target}"`;
                        speak = `Clicked ${result.element.name || params.target}`;
                    } else {
                        return {
                            type: 'voiceCommandResult',
                            success: false,
                            action: 'click',
                            message: `Could not find element: "${params.target}"`,
                            interpretation: result.suggestions.length > 0
                                ? `Did you mean: ${result.suggestions.join(', ')}?`
                                : undefined
                        };
                    }
                } else {
                    return {
                        type: 'voiceCommandResult',
                        success: false,
                        action: 'click',
                        message: 'Please specify what to click'
                    };
                }
                break;

            case 'type':
                if (params.value) {
                    sendAction({ type: 'type', text: params.value });
                    message = `Typed "${params.value}"`;
                    speak = `Typed ${params.value}`;
                } else {
                    return {
                        type: 'voiceCommandResult',
                        success: false,
                        action: 'type',
                        message: 'Please specify what to type'
                    };
                }
                break;

            case 'navigate':
                if (params.url) {
                    sendAction({ type: 'navigate', url: params.url });
                    message = `Navigating to ${params.url}`;
                    speak = `Navigating to ${params.url.replace(/^https?:\/\//, '')}`;
                }
                break;

            case 'scroll':
                if (params.direction) {
                    const scrollData = scrollDirections[params.direction];
                    if (scrollData) {
                        sendAction({ type: 'scroll', ...scrollData });
                        message = `Scrolling ${params.direction}`;
                        speak = `Scrolling ${params.direction}`;
                    }
                }
                break;

            case 'back':
                sendAction({ type: 'back' });
                message = 'Going back';
                speak = 'Going back';
                break;

            case 'forward':
                sendAction({ type: 'forward' });
                message = 'Going forward';
                speak = 'Going forward';
                break;

            case 'reload':
                sendAction({ type: 'reload' });
                message = 'Reloading page';
                speak = 'Reloading';
                break;

            case 'newTab':
                sendAction({ type: 'newTab' });
                message = 'Opening new tab';
                speak = 'Opening new tab';
                break;

            case 'closeTab':
                sendAction({ type: 'closeTab' });
                message = 'Closing tab';
                speak = 'Closing tab';
                break;

            case 'screenshot':
                sendAction({ type: 'screenshot', save: true });
                message = 'Taking screenshot';
                speak = 'Screenshot taken';
                break;

            case 'startRecording':
                sendAction({ type: 'startRecording' });
                message = 'Recording started';
                speak = 'Recording started';
                break;

            case 'stopRecording':
                sendAction({ type: 'stopRecording' });
                message = 'Recording stopped';
                speak = 'Recording stopped';
                break;

            case 'search':
                if (params.query) {
                    // Send Ctrl+F to open find dialog, then type query
                    sendAction({ type: 'press', key: 'Control+f' });
                    setTimeout(() => {
                        sendAction({ type: 'type', text: params.query });
                    }, 200);
                    message = `Searching for "${params.query}"`;
                    speak = `Searching for ${params.query}`;
                }
                break;

            case 'focus':
                if (params.target) {
                    const result = findElementByDescription(params.target, this.currentSnapshot);
                    if (result.element && result.element.ref) {
                        sendAction({ type: 'focus', ref: result.element.ref });
                        message = `Focused "${result.element.name || params.target}"`;
                    }
                }
                break;

            case 'fill':
                if (params.target && params.value) {
                    const result = findElementByDescription(params.target, this.currentSnapshot);
                    if (result.element && result.element.ref) {
                        sendAction({ type: 'fill', ref: result.element.ref, value: params.value });
                        message = `Filled "${params.target}" with "${params.value}"`;
                    }
                }
                break;

            case 'wait':
                if (params.seconds) {
                    // Just acknowledge - actual waiting handled by client
                    message = `Waiting ${params.seconds} seconds`;
                    speak = `Waiting ${params.seconds} seconds`;
                }
                break;

            default:
                return {
                    type: 'voiceCommandResult',
                    success: false,
                    action,
                    message: `Unknown action: ${action}`
                };
        }

        return {
            type: 'voiceCommandResult',
            success: true,
            action,
            message,
            speak
        };
    }

    /**
     * Use AI to interpret ambiguous commands
     * This is a placeholder - in production, integrate with Claude API
     */
    private async interpretWithAI(
        text: string,
        sendAction: (action: any) => void
    ): Promise<VoiceCommandResult> {
        // For now, try some heuristics
        const lowerText = text.toLowerCase();

        // Try to find any clickable elements matching words in the text
        const words = text.split(/\s+/).filter(w => w.length > 2);

        for (const word of words) {
            const result = findElementByDescription(word, this.currentSnapshot, 0.6);
            if (result.element) {
                return this.executeAction('click', { target: word }, sendAction);
            }
        }

        return {
            type: 'voiceCommandResult',
            success: false,
            action: 'interpret',
            message: `Could not interpret: "${text}"`,
            interpretation: 'Try commands like "click [element]", "type [text]", or "go to [URL]"'
        };
    }

    /**
     * Find element and return result
     */
    findElement(description: string): ElementSearchResult {
        const result = findElementByDescription(description, this.currentSnapshot);

        if (result.element) {
            return {
                type: 'elementFound',
                found: true,
                element: result.element.name || description,
                ref: result.element.ref,
                boundingBox: result.element.boundingBox
            };
        }

        return {
            type: 'elementFound',
            found: false,
            description,
            suggestions: result.suggestions
        };
    }
}

// Export singleton instance
export const voiceCommandHandler = new VoiceCommandHandler();
