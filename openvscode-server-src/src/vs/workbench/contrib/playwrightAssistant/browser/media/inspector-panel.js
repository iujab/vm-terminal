/**
 * DOM Inspector Panel
 * Provides detailed element information including hierarchy, attributes, and selectors
 */

(function() {
    'use strict';

    // Inspector Panel State
    let currentElementInfo = null;
    let isPanelVisible = false;
    let elementHierarchy = [];

    // Panel Elements
    let inspectorPanel = null;
    let panelContent = null;

    /**
     * Initialize the inspector panel
     */
    function initInspectorPanel() {
        inspectorPanel = document.getElementById('inspector-panel');
        if (!inspectorPanel) {
            createInspectorPanel();
        }

        panelContent = document.getElementById('inspector-panel-content');

        // Close button
        const closeBtn = document.getElementById('inspector-panel-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', hidePanel);
        }
    }

    /**
     * Create the inspector panel DOM structure
     */
    function createInspectorPanel() {
        inspectorPanel = document.createElement('div');
        inspectorPanel.id = 'inspector-panel';
        inspectorPanel.innerHTML = `
            <div id="inspector-panel-header">
                <h3>Element Inspector</h3>
                <button id="inspector-panel-close" title="Close panel">&times;</button>
            </div>
            <div id="inspector-panel-content">
                <div class="inspector-placeholder">
                    <p>Hover over an element to inspect it</p>
                </div>
            </div>
        `;
        document.body.appendChild(inspectorPanel);
    }

    /**
     * Show the inspector panel
     */
    function showPanel() {
        if (inspectorPanel) {
            inspectorPanel.classList.add('visible');
            isPanelVisible = true;
        }
    }

    /**
     * Hide the inspector panel
     */
    function hidePanel() {
        if (inspectorPanel) {
            inspectorPanel.classList.remove('visible');
            isPanelVisible = false;
        }
    }

    /**
     * Toggle panel visibility
     */
    function togglePanel() {
        if (isPanelVisible) {
            hidePanel();
        } else {
            showPanel();
        }
    }

    /**
     * Update panel content with element info
     */
    function updatePanelContent(elementInfo) {
        if (!panelContent || !elementInfo) {
            return;
        }

        currentElementInfo = elementInfo;

        let html = '';

        // Element Header Section
        html += `
            <div class="inspector-section">
                <div class="inspector-section-title">Element</div>
                <div class="inspector-section-content">
                    <div class="inspector-element-tag">
                        <span class="tag">&lt;${elementInfo.tagName}</span>
                        ${elementInfo.id ? `<span class="id">#${elementInfo.id}</span>` : ''}
                        ${elementInfo.classes.length > 0 ? `<span class="classes">.${elementInfo.classes.join('.')}</span>` : ''}
                        <span class="tag">&gt;</span>
                    </div>
                    ${elementInfo.innerText ? `<div class="inspector-text-preview">"${truncate(elementInfo.innerText, 60)}"</div>` : ''}
                </div>
            </div>
        `;

        // Dimensions Section
        if (elementInfo.boundingBox) {
            const box = elementInfo.boundingBox;
            html += `
                <div class="inspector-section">
                    <div class="inspector-section-title">Dimensions</div>
                    <div class="inspector-section-content">
                        <div class="inspector-property">
                            <span class="inspector-property-name">Position</span>
                            <span class="inspector-property-value">${Math.round(box.x)}, ${Math.round(box.y)}</span>
                        </div>
                        <div class="inspector-property">
                            <span class="inspector-property-name">Size</span>
                            <span class="inspector-property-value">${Math.round(box.width)} x ${Math.round(box.height)}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        // Selectors Section
        html += `
            <div class="inspector-section">
                <div class="inspector-section-title">Selectors</div>
                <div class="inspector-section-content">
                    ${generateSelectorsHtml(elementInfo)}
                </div>
            </div>
        `;

        // Attributes Section
        if (Object.keys(elementInfo.attributes).length > 0) {
            html += `
                <div class="inspector-section">
                    <div class="inspector-section-title">Attributes</div>
                    <div class="inspector-section-content">
                        ${generateAttributesHtml(elementInfo.attributes)}
                    </div>
                </div>
            `;
        }

        // Computed Styles Section
        if (elementInfo.computedStyles) {
            html += `
                <div class="inspector-section">
                    <div class="inspector-section-title">Computed Styles</div>
                    <div class="inspector-section-content inspector-styles-grid">
                        ${generateStylesHtml(elementInfo.computedStyles)}
                    </div>
                </div>
            `;
        }

        panelContent.innerHTML = html;

        // Attach copy button handlers
        attachCopyHandlers();
    }

    /**
     * Generate HTML for selectors list
     */
    function generateSelectorsHtml(elementInfo) {
        const selectors = getAllSelectors(elementInfo);
        let html = '';

        for (const item of selectors) {
            html += `
                <div class="inspector-selector-item" data-selector="${escapeHtml(item.selector)}">
                    <span class="type">${item.type}</span>
                    <span class="selector" title="${escapeHtml(item.selector)}">${escapeHtml(item.selector)}</span>
                    <button class="copy-btn" data-selector="${escapeHtml(item.selector)}">Copy</button>
                </div>
            `;
        }

        return html;
    }

    /**
     * Generate HTML for attributes list
     */
    function generateAttributesHtml(attributes) {
        let html = '';

        for (const [name, value] of Object.entries(attributes)) {
            html += `
                <div class="inspector-property">
                    <span class="inspector-property-name">${escapeHtml(name)}</span>
                    <span class="inspector-property-value" title="${escapeHtml(value)}">${escapeHtml(truncate(value, 30))}</span>
                </div>
            `;
        }

        return html;
    }

    /**
     * Generate HTML for computed styles grid
     */
    function generateStylesHtml(styles) {
        let html = '';
        const importantStyles = [
            'display', 'position', 'width', 'height',
            'color', 'backgroundColor', 'fontSize',
            'padding', 'margin', 'border'
        ];

        for (const styleName of importantStyles) {
            const value = styles[styleName];
            if (value) {
                const isColor = styleName.toLowerCase().includes('color') ||
                               styleName.toLowerCase().includes('background');

                html += `
                    <div class="inspector-style-item">
                        <span class="inspector-style-name">${formatStyleName(styleName)}</span>
                        <span class="inspector-style-value">
                            ${isColor ? `<span class="color-preview" style="background-color: ${value}"></span>` : ''}
                            ${escapeHtml(value)}
                        </span>
                    </div>
                `;
            }
        }

        return html;
    }

    /**
     * Get all possible selectors for an element
     */
    function getAllSelectors(elementInfo) {
        const result = [];
        const { selectors, id, attributes } = elementInfo;

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
        if (attributes && attributes['placeholder']) {
            result.push({ type: 'placeholder', selector: `[placeholder="${attributes['placeholder']}"]`, priority: 6 });
        }

        // Name attribute
        if (attributes && attributes['name']) {
            result.push({ type: 'name', selector: `[name="${attributes['name']}"]`, priority: 7 });
        }

        // CSS selector
        if (selectors.css) {
            result.push({ type: 'css', selector: selectors.css, priority: 8 });
        }

        // XPath
        if (selectors.xpath) {
            result.push({ type: 'xpath', selector: selectors.xpath, priority: 9 });
        }

        return result.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Attach click handlers to copy buttons
     */
    function attachCopyHandlers() {
        const copyBtns = panelContent.querySelectorAll('.copy-btn');
        copyBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const selector = e.target.dataset.selector;
                if (selector) {
                    copyToClipboard(selector, e.target);
                }
            });
        });
    }

    /**
     * Copy text to clipboard and show feedback
     */
    function copyToClipboard(text, button) {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            button.classList.add('copied');

            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }

    /**
     * Update element hierarchy display
     */
    function updateHierarchy(hierarchy) {
        elementHierarchy = hierarchy || [];

        const hierarchySection = panelContent.querySelector('.inspector-hierarchy');
        if (!hierarchySection) {
            return;
        }

        let html = '';
        hierarchy.forEach((item, index) => {
            html += `
                <div class="inspector-hierarchy-item" style="--depth: ${index}">
                    <span class="tag">${item.tagName}</span>
                    ${item.id ? `<span class="id">#${item.id}</span>` : ''}
                    ${item.classes.length > 0 ? `<span class="classes">.${item.classes.slice(0, 2).join('.')}</span>` : ''}
                </div>
            `;
        });

        hierarchySection.innerHTML = html;
    }

    /**
     * Format camelCase style name to readable format
     */
    function formatStyleName(name) {
        return name.replace(/([A-Z])/g, '-$1').toLowerCase();
    }

    /**
     * Escape HTML special characters
     */
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Truncate string to max length
     */
    function truncate(str, maxLen) {
        if (!str) return '';
        if (str.length <= maxLen) return str;
        return str.substring(0, maxLen) + '...';
    }

    // Public API
    window.InspectorPanel = {
        init: initInspectorPanel,
        show: showPanel,
        hide: hidePanel,
        toggle: togglePanel,
        update: updatePanelContent,
        updateHierarchy: updateHierarchy,
        isVisible: () => isPanelVisible,
        getCurrentElement: () => currentElementInfo
    };

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initInspectorPanel);
    } else {
        initInspectorPanel();
    }
})();
