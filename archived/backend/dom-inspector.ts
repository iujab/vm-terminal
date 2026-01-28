/**
 * DOM Inspector - Provides element information at coordinates
 * Used by Playwright to inspect elements in the browser
 */

export interface ElementInfo {
    tagName: string;
    id?: string;
    classes: string[];
    attributes: Record<string, string>;
    boundingBox: { x: number; y: number; width: number; height: number };
    selectors: {
        css: string;
        xpath: string;
        text?: string;
        testId?: string;
        role?: string;
        ariaLabel?: string;
    };
    innerText?: string;
    computedStyles?: Record<string, string>;
}

/**
 * Script to be evaluated in the browser context to get element info at coordinates
 */
export const getElementInfoScript = `
(function(x, y) {
    const element = document.elementFromPoint(x, y);
    if (!element) {
        return null;
    }

    // Get bounding box
    const rect = element.getBoundingClientRect();
    const boundingBox = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
    };

    // Get attributes
    const attributes = {};
    for (const attr of element.attributes) {
        attributes[attr.name] = attr.value;
    }

    // Get classes
    const classes = Array.from(element.classList);

    // Generate CSS selector
    function getCssSelector(el) {
        if (el.id) {
            return '#' + CSS.escape(el.id);
        }

        let selector = el.tagName.toLowerCase();

        if (el.className && typeof el.className === 'string') {
            const classes = el.className.trim().split(/\\s+/).filter(c => c);
            if (classes.length > 0) {
                selector += '.' + classes.map(c => CSS.escape(c)).join('.');
            }
        }

        // Add nth-child if needed for uniqueness
        const parent = el.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter(
                child => child.tagName === el.tagName
            );
            if (siblings.length > 1) {
                const index = siblings.indexOf(el) + 1;
                selector += ':nth-child(' + index + ')';
            }
        }

        return selector;
    }

    function getFullCssSelector(el) {
        const parts = [];
        let current = el;

        while (current && current !== document.body && current !== document.documentElement) {
            parts.unshift(getCssSelector(current));
            current = current.parentElement;

            // Stop if we have an ID (unique enough)
            if (parts[0].startsWith('#')) {
                break;
            }
        }

        return parts.join(' > ');
    }

    // Generate XPath
    function getXPath(el) {
        if (el.id) {
            return '//*[@id="' + el.id + '"]';
        }

        const parts = [];
        let current = el;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
            let index = 1;
            let sibling = current.previousSibling;

            while (sibling) {
                if (sibling.nodeType === Node.ELEMENT_NODE &&
                    sibling.tagName === current.tagName) {
                    index++;
                }
                sibling = sibling.previousSibling;
            }

            const tagName = current.tagName.toLowerCase();
            const part = tagName + '[' + index + ']';
            parts.unshift(part);
            current = current.parentElement;
        }

        return '/' + parts.join('/');
    }

    // Get text content (truncated)
    function getInnerText(el) {
        const text = el.innerText || el.textContent || '';
        const trimmed = text.trim();
        if (trimmed.length > 100) {
            return trimmed.substring(0, 100) + '...';
        }
        return trimmed;
    }

    // Get computed styles (key ones)
    function getComputedStyles(el) {
        const computed = window.getComputedStyle(el);
        return {
            display: computed.display,
            position: computed.position,
            visibility: computed.visibility,
            opacity: computed.opacity,
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            fontSize: computed.fontSize,
            fontFamily: computed.fontFamily,
            fontWeight: computed.fontWeight,
            padding: computed.padding,
            margin: computed.margin,
            border: computed.border,
            width: computed.width,
            height: computed.height,
            zIndex: computed.zIndex,
            overflow: computed.overflow,
            cursor: computed.cursor
        };
    }

    // Get text selector if element has unique visible text
    function getTextSelector(el) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text && text.length < 50 && !text.includes('\\n')) {
            return text;
        }
        return undefined;
    }

    // Get test ID if present
    function getTestId(el) {
        return el.getAttribute('data-testid') ||
               el.getAttribute('data-test-id') ||
               el.getAttribute('data-test') ||
               el.getAttribute('data-cy') ||
               undefined;
    }

    // Get ARIA role
    function getRole(el) {
        return el.getAttribute('role') || undefined;
    }

    // Get ARIA label
    function getAriaLabel(el) {
        return el.getAttribute('aria-label') ||
               el.getAttribute('aria-labelledby') ||
               undefined;
    }

    const selectors = {
        css: getFullCssSelector(element),
        xpath: getXPath(element),
        text: getTextSelector(element),
        testId: getTestId(element),
        role: getRole(element),
        ariaLabel: getAriaLabel(element)
    };

    // Determine best selector to use
    function getBestSelector(el, selectors) {
        // Priority: testId > id > role+name > css
        if (selectors.testId) {
            return '[data-testid="' + selectors.testId + '"]';
        }
        if (el.id) {
            return '#' + CSS.escape(el.id);
        }
        if (selectors.role && selectors.ariaLabel) {
            return 'role=' + selectors.role + '[name="' + selectors.ariaLabel + '"]';
        }
        if (selectors.role && selectors.text && selectors.text.length < 30) {
            return 'role=' + selectors.role + '[name="' + selectors.text + '"]';
        }
        if (selectors.text && selectors.text.length < 30) {
            return 'text=' + selectors.text;
        }
        return selectors.css;
    }

    return {
        tagName: element.tagName.toLowerCase(),
        id: element.id || undefined,
        classes: classes,
        attributes: attributes,
        boundingBox: boundingBox,
        selectors: selectors,
        bestSelector: getBestSelector(element, selectors),
        innerText: getInnerText(element),
        computedStyles: getComputedStyles(element)
    };
})
`;

/**
 * Script to highlight an element by selector
 */
export const highlightElementScript = `
(function(selector, options) {
    // Remove existing highlight
    const existing = document.getElementById('__dom-inspector-highlight__');
    if (existing) {
        existing.remove();
    }

    if (!selector) {
        return { success: true };
    }

    let element;
    try {
        element = document.querySelector(selector);
    } catch (e) {
        return { success: false, error: 'Invalid selector' };
    }

    if (!element) {
        return { success: false, error: 'Element not found' };
    }

    const rect = element.getBoundingClientRect();

    const highlight = document.createElement('div');
    highlight.id = '__dom-inspector-highlight__';
    highlight.style.cssText = \`
        position: fixed;
        top: \${rect.top}px;
        left: \${rect.left}px;
        width: \${rect.width}px;
        height: \${rect.height}px;
        background-color: rgba(66, 133, 244, 0.2);
        border: 2px solid rgba(66, 133, 244, 0.8);
        pointer-events: none;
        z-index: 999999;
        box-sizing: border-box;
    \`;

    document.body.appendChild(highlight);

    return { success: true, boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
})
`;

/**
 * Script to get element hierarchy (ancestors)
 */
export const getElementHierarchyScript = `
(function(x, y) {
    const element = document.elementFromPoint(x, y);
    if (!element) {
        return null;
    }

    const hierarchy = [];
    let current = element;

    while (current && current !== document.documentElement) {
        const rect = current.getBoundingClientRect();

        hierarchy.push({
            tagName: current.tagName.toLowerCase(),
            id: current.id || undefined,
            classes: Array.from(current.classList),
            boundingBox: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            }
        });

        current = current.parentElement;
    }

    return hierarchy;
})
`;

/**
 * Script to remove the highlight overlay
 */
export const removeHighlightScript = `
(function() {
    const existing = document.getElementById('__dom-inspector-highlight__');
    if (existing) {
        existing.remove();
    }
    return { success: true };
})()
`;

/**
 * Generate the best Playwright selector for an element
 */
export function generatePlaywrightSelector(elementInfo: ElementInfo): string {
    const { selectors, tagName, attributes } = elementInfo;

    // Priority order for Playwright selectors:
    // 1. data-testid
    if (selectors.testId) {
        return `[data-testid="${selectors.testId}"]`;
    }

    // 2. ID
    if (elementInfo.id) {
        return `#${elementInfo.id}`;
    }

    // 3. Role with name
    if (selectors.role && selectors.ariaLabel) {
        return `role=${selectors.role}[name="${selectors.ariaLabel}"]`;
    }

    // 4. Role with text content
    if (selectors.role && selectors.text) {
        return `role=${selectors.role}[name="${selectors.text}"]`;
    }

    // 5. Text content (for links, buttons)
    if (selectors.text && ['a', 'button', 'label'].includes(tagName)) {
        return `text="${selectors.text}"`;
    }

    // 6. Placeholder for inputs
    if (attributes['placeholder'] && tagName === 'input') {
        return `[placeholder="${attributes['placeholder']}"]`;
    }

    // 7. Name attribute
    if (attributes['name']) {
        return `[name="${attributes['name']}"]`;
    }

    // 8. Fall back to CSS selector
    return selectors.css;
}

/**
 * Get all possible selectors for an element
 */
export function getAllSelectors(elementInfo: ElementInfo): Array<{ type: string; selector: string; priority: number }> {
    const result: Array<{ type: string; selector: string; priority: number }> = [];
    const { selectors, tagName, attributes, id } = elementInfo;

    // data-testid (highest priority)
    if (selectors.testId) {
        result.push({ type: 'testId', selector: `[data-testid="${selectors.testId}"]`, priority: 1 });
    }

    // ID
    if (id) {
        result.push({ type: 'id', selector: `#${id}`, priority: 2 });
    }

    // Role with name
    if (selectors.role && selectors.ariaLabel) {
        result.push({ type: 'role', selector: `role=${selectors.role}[name="${selectors.ariaLabel}"]`, priority: 3 });
    }

    // Role with text
    if (selectors.role && selectors.text && selectors.text !== selectors.ariaLabel) {
        result.push({ type: 'role+text', selector: `role=${selectors.role}[name="${selectors.text}"]`, priority: 4 });
    }

    // Text content
    if (selectors.text) {
        result.push({ type: 'text', selector: `text="${selectors.text}"`, priority: 5 });
    }

    // Placeholder
    if (attributes['placeholder']) {
        result.push({ type: 'placeholder', selector: `[placeholder="${attributes['placeholder']}"]`, priority: 6 });
    }

    // Name attribute
    if (attributes['name']) {
        result.push({ type: 'name', selector: `[name="${attributes['name']}"]`, priority: 7 });
    }

    // CSS selector
    result.push({ type: 'css', selector: selectors.css, priority: 8 });

    // XPath
    result.push({ type: 'xpath', selector: selectors.xpath, priority: 9 });

    return result.sort((a, b) => a.priority - b.priority);
}
