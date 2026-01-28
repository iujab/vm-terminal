/**
 * Code Generation Module for Playwright Assistant
 * Records browser interactions and generates test code
 */
(function() {
    'use strict';

    // =============================================================================
    // Action Types and Interfaces
    // =============================================================================

    const ActionTypes = {
        CLICK: 'click',
        DBLCLICK: 'dblclick',
        TYPE: 'type',
        FILL: 'fill',
        SCROLL: 'scroll',
        NAVIGATE: 'navigate',
        SELECT: 'select',
        CHECK: 'check',
        UNCHECK: 'uncheck',
        HOVER: 'hover',
        PRESS: 'press',
        WAIT_FOR_SELECTOR: 'waitForSelector',
        WAIT_FOR_NAVIGATION: 'waitForNavigation',
        FRAME: 'frame',
        POPUP: 'popup'
    };

    // =============================================================================
    // Recording State
    // =============================================================================

    let isRecording = false;
    let recordedActions = [];
    let recordingStartTime = 0;
    let recordingTimerInterval = null;
    let currentSessionName = 'Recorded Session';
    let currentUrl = '';

    // =============================================================================
    // UI Elements
    // =============================================================================

    function initializeUI() {
        // Create recording bar if it doesn't exist
        if (!document.getElementById('recording-bar')) {
            createRecordingBar();
        }

        // Create export modal if it doesn't exist
        if (!document.getElementById('export-modal')) {
            createExportModal();
        }

        // Create actions panel if it doesn't exist
        if (!document.getElementById('actions-panel')) {
            createActionsPanel();
        }

        // Create toast container
        if (!document.getElementById('toast-container')) {
            const toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            document.body.appendChild(toastContainer);
        }
    }

    function createRecordingBar() {
        const bar = document.createElement('div');
        bar.id = 'recording-bar';
        bar.innerHTML = `
            <button id="start-recording-btn" class="record-btn" title="Start Recording">
                <span class="record-icon"></span>
                <span>Record</span>
            </button>
            <button id="stop-recording-btn" class="record-btn hidden" title="Stop Recording">
                <span class="stop-icon"></span>
                <span>Stop</span>
            </button>
            <span id="recording-status"></span>
            <span id="recording-timer"></span>
            <button id="export-code-btn" disabled title="Export Code">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M16 17l5-5-5-5M19.8 12H9M13 3H5a2 2 0 00-2 2v14a2 2 0 002 2h8"/>
                </svg>
                <span>Export Code</span>
            </button>
        `;

        // Insert after status bar or at the beginning of container
        const statusBar = document.getElementById('status-bar');
        const container = document.getElementById('container');
        if (statusBar && statusBar.parentNode) {
            statusBar.parentNode.insertBefore(bar, statusBar.nextSibling);
        } else if (container) {
            container.insertBefore(bar, container.firstChild);
        } else {
            document.body.insertBefore(bar, document.body.firstChild);
        }

        // Attach event listeners
        document.getElementById('start-recording-btn').addEventListener('click', startRecording);
        document.getElementById('stop-recording-btn').addEventListener('click', stopRecording);
        document.getElementById('export-code-btn').addEventListener('click', openExportModal);
    }

    function createExportModal() {
        const modal = document.createElement('div');
        modal.id = 'export-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Export Generated Code</h3>
                    <button class="modal-close" title="Close">&times;</button>
                </div>
                <div class="modal-options">
                    <div class="option-group">
                        <label>Framework</label>
                        <select id="export-format">
                            <option value="playwright">Playwright</option>
                            <option value="puppeteer">Puppeteer</option>
                            <option value="selenium">Selenium</option>
                        </select>
                    </div>
                    <div class="option-group">
                        <label>Language</label>
                        <select id="export-language">
                            <option value="typescript">TypeScript</option>
                            <option value="javascript">JavaScript</option>
                            <option value="python">Python</option>
                        </select>
                    </div>
                    <div class="option-group" style="justify-content: flex-end;">
                        <label class="option-checkbox">
                            <input type="checkbox" id="export-comments" checked>
                            Include Comments
                        </label>
                    </div>
                    <div class="option-group" style="justify-content: flex-end;">
                        <label class="option-checkbox">
                            <input type="checkbox" id="export-waits" checked>
                            Add Wait Strategies
                        </label>
                    </div>
                    <div class="option-group" style="justify-content: flex-end;">
                        <label class="option-checkbox">
                            <input type="checkbox" id="export-locators" checked>
                            Use Locators (getByRole, etc.)
                        </label>
                    </div>
                </div>
                <div class="modal-body">
                    <pre id="code-preview"></pre>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn secondary" id="copy-code-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                        </svg>
                        Copy to Clipboard
                    </button>
                    <button class="modal-btn secondary" id="download-code-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Download
                    </button>
                    <button class="modal-btn primary" id="open-in-editor-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 20h9"/>
                            <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
                        </svg>
                        Open in Editor
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Attach event listeners
        modal.querySelector('.modal-close').addEventListener('click', closeExportModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeExportModal();
        });

        document.getElementById('export-format').addEventListener('change', regenerateCode);
        document.getElementById('export-language').addEventListener('change', regenerateCode);
        document.getElementById('export-comments').addEventListener('change', regenerateCode);
        document.getElementById('export-waits').addEventListener('change', regenerateCode);
        document.getElementById('export-locators').addEventListener('change', regenerateCode);

        document.getElementById('copy-code-btn').addEventListener('click', copyCodeToClipboard);
        document.getElementById('download-code-btn').addEventListener('click', downloadCode);
        document.getElementById('open-in-editor-btn').addEventListener('click', openInEditor);
    }

    function createActionsPanel() {
        const panel = document.createElement('div');
        panel.id = 'actions-panel';
        panel.className = 'hidden';
        panel.innerHTML = `
            <div id="actions-panel-header">
                <span>Recorded Actions (<span id="actions-count">0</span>)</span>
                <button id="actions-panel-toggle" title="Toggle panel">-</button>
            </div>
            <div id="recorded-actions-list"></div>
        `;

        // Insert before controls
        const controls = document.getElementById('controls');
        const container = document.getElementById('container');
        if (controls && controls.parentNode) {
            controls.parentNode.insertBefore(panel, controls);
        } else if (container) {
            container.appendChild(panel);
        }

        document.getElementById('actions-panel-toggle').addEventListener('click', toggleActionsPanel);
    }

    // =============================================================================
    // Recording Functions
    // =============================================================================

    function startRecording() {
        isRecording = true;
        recordedActions = [];
        recordingStartTime = Date.now();
        currentUrl = ''; // Will be set from first action or navigation

        // Update UI
        document.getElementById('start-recording-btn').classList.add('hidden');
        document.getElementById('stop-recording-btn').classList.remove('hidden');
        document.getElementById('recording-status').textContent = 'Recording...';
        document.getElementById('export-code-btn').disabled = true;

        // Show actions panel
        document.getElementById('actions-panel').classList.remove('hidden');
        updateActionsList();

        // Start timer
        recordingTimerInterval = setInterval(updateRecordingTimer, 1000);
        updateRecordingTimer();

        // Show recording overlay
        const overlay = document.getElementById('recording-overlay');
        if (overlay) {
            overlay.classList.add('active');
        }

        showToast('Recording started', 'info');

        // Notify extension
        if (window.vscode) {
            window.vscode.postMessage({ type: 'recordingStarted' });
        }
    }

    function stopRecording() {
        isRecording = false;

        // Update UI
        document.getElementById('start-recording-btn').classList.remove('hidden');
        document.getElementById('stop-recording-btn').classList.add('hidden');
        document.getElementById('recording-status').textContent = `${recordedActions.length} actions recorded`;
        document.getElementById('export-code-btn').disabled = recordedActions.length === 0;

        // Stop timer
        if (recordingTimerInterval) {
            clearInterval(recordingTimerInterval);
            recordingTimerInterval = null;
        }

        // Hide recording overlay
        const overlay = document.getElementById('recording-overlay');
        if (overlay) {
            overlay.classList.remove('active');
        }

        showToast(`Recording stopped. ${recordedActions.length} actions captured.`, 'success');

        // Notify extension
        if (window.vscode) {
            window.vscode.postMessage({
                type: 'recordingStopped',
                actions: recordedActions,
                startUrl: currentUrl
            });
        }
    }

    function updateRecordingTimer() {
        const elapsed = Date.now() - recordingStartTime;
        const seconds = Math.floor(elapsed / 1000) % 60;
        const minutes = Math.floor(elapsed / 60000);
        document.getElementById('recording-timer').textContent =
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    // =============================================================================
    // Action Recording
    // =============================================================================

    function recordAction(action) {
        if (!isRecording) return;

        const recordedAction = {
            id: generateId(),
            timestamp: Date.now(),
            ...action
        };

        // Set start URL from first navigation
        if (action.type === ActionTypes.NAVIGATE && !currentUrl) {
            currentUrl = action.url;
        }

        recordedActions.push(recordedAction);
        updateActionsList();
        updateActionsCount();

        // Notify extension
        if (window.vscode) {
            window.vscode.postMessage({
                type: 'actionRecorded',
                action: recordedAction
            });
        }

        return recordedAction;
    }

    // Hook into existing event handlers
    function hookActionRecording() {
        // This will be called from the main viewer.js
        window.recordBrowserAction = recordAction;
        window.isRecordingActive = () => isRecording;
    }

    // =============================================================================
    // Actions Panel
    // =============================================================================

    function updateActionsList() {
        const list = document.getElementById('recorded-actions-list');
        if (!list) return;

        if (recordedActions.length === 0) {
            list.innerHTML = `
                <div class="actions-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <div>No actions recorded yet</div>
                    <div style="font-size: 11px;">Click, type, or navigate to record actions</div>
                </div>
            `;
            return;
        }

        list.innerHTML = recordedActions.map((action, index) => `
            <div class="recorded-action-item" data-index="${index}">
                <span class="action-icon">${getActionIcon(action.type)}</span>
                <span class="action-type">${action.type}</span>
                <span class="action-detail">${getActionDetail(action)}</span>
                <span class="action-time">${formatTime(action.timestamp - recordingStartTime)}</span>
                <button class="action-delete" data-index="${index}" title="Delete action">&times;</button>
            </div>
        `).join('');

        // Add delete handlers
        list.querySelectorAll('.action-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(e.target.dataset.index);
                deleteAction(index);
            });
        });
    }

    function updateActionsCount() {
        const countEl = document.getElementById('actions-count');
        if (countEl) {
            countEl.textContent = recordedActions.length;
        }
    }

    function deleteAction(index) {
        recordedActions.splice(index, 1);
        updateActionsList();
        updateActionsCount();
        document.getElementById('export-code-btn').disabled = recordedActions.length === 0;
    }

    function toggleActionsPanel() {
        const list = document.getElementById('recorded-actions-list');
        const toggle = document.getElementById('actions-panel-toggle');
        if (list.style.display === 'none') {
            list.style.display = 'flex';
            toggle.textContent = '-';
        } else {
            list.style.display = 'none';
            toggle.textContent = '+';
        }
    }

    function getActionIcon(type) {
        const icons = {
            click: '&#x1F446;',
            dblclick: '&#x1F446;&#x1F446;',
            type: '&#x2328;',
            fill: '&#x270D;',
            scroll: '&#x2195;',
            navigate: '&#x1F310;',
            select: '&#x25BC;',
            check: '&#x2611;',
            uncheck: '&#x2610;',
            hover: '&#x1F4A8;',
            press: '&#x2328;',
            waitForSelector: '&#x23F3;',
            waitForNavigation: '&#x23F3;',
            frame: '&#x1F5BC;',
            popup: '&#x1F5D7;'
        };
        return icons[type] || '&#x2022;';
    }

    function getActionDetail(action) {
        switch (action.type) {
            case 'click':
            case 'dblclick':
                if (action.element) {
                    return describeElement(action.element);
                }
                return `at (${action.x}, ${action.y})`;
            case 'type':
            case 'fill':
                return `"${truncate(action.text || '', 30)}"`;
            case 'navigate':
                return truncate(action.url || '', 40);
            case 'scroll':
                return `(${action.deltaX || 0}, ${action.deltaY || 0})`;
            case 'select':
                return `"${action.text || ''}"`;
            case 'press':
                return action.key || '';
            case 'hover':
                return describeElement(action.element);
            default:
                return '';
        }
    }

    function describeElement(element) {
        if (!element) return 'element';
        if (element.testId) return `[data-testid="${element.testId}"]`;
        if (element.ariaLabel) return `"${truncate(element.ariaLabel, 25)}"`;
        if (element.text && element.text.length < 25) return `"${element.text}"`;
        if (element.placeholder) return `placeholder "${truncate(element.placeholder, 20)}"`;
        if (element.id) return `#${element.id}`;
        if (element.role) return element.role;
        return element.tagName ? element.tagName.toLowerCase() : 'element';
    }

    // =============================================================================
    // Code Generation
    // =============================================================================

    function generateCode(actions, options) {
        const {
            format = 'playwright',
            language = 'typescript',
            includeComments = true,
            includeWaits = true,
            useLocators = true
        } = options;

        // Send to backend for generation
        if (window.vscode) {
            window.vscode.postMessage({
                type: 'generateCode',
                actions: actions,
                startUrl: currentUrl,
                options: { format, language, includeComments, includeWaits, useLocators }
            });
        }

        // Also generate locally for preview
        return generateCodeLocally(actions, options);
    }

    function generateCodeLocally(actions, options) {
        const {
            format = 'playwright',
            language = 'typescript',
            includeComments = true,
            includeWaits = true,
            useLocators = true
        } = options;

        let code = '';
        const indent = '    ';
        const isTs = language === 'typescript';
        const isPy = language === 'python';

        // Generate header
        if (format === 'playwright') {
            if (isPy) {
                code = `import re
from playwright.sync_api import Page, expect

def test_recorded_session(page: Page):
`;
            } else {
                code = `import { test, expect } from '@playwright/test';

test('recorded session', async ({ page }${isTs ? ': Page' : ''}) => {
`;
            }
        } else if (format === 'puppeteer') {
            if (isPy) {
                code = `import asyncio
from pyppeteer import launch

async def main():
    browser = await launch(headless=False)
    page = await browser.newPage()

`;
            } else {
                code = isTs
                    ? `import puppeteer, { Browser, Page } from 'puppeteer';

(async () => {
    const browser: Browser = await puppeteer.launch({ headless: false });
    const page: Page = await browser.newPage();

`
                    : `const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

`;
            }
        } else if (format === 'selenium') {
            if (isPy) {
                code = `from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

driver = webdriver.Chrome()

`;
            } else {
                code = isTs
                    ? `import { Builder, By, until, WebDriver } from 'selenium-webdriver';

(async () => {
    const driver: WebDriver = await new Builder().forBrowser('chrome').build();

`
                    : `const { Builder, By, until } = require('selenium-webdriver');

(async () => {
    const driver = await new Builder().forBrowser('chrome').build();

`;
            }
        }

        // Add navigation to start URL
        if (currentUrl) {
            if (includeComments) {
                code += `${indent}${isPy ? '# ' : '// '}Navigate to the starting URL\n`;
            }
            if (format === 'playwright') {
                code += isPy
                    ? `${indent}page.goto("${currentUrl}")\n\n`
                    : `${indent}await page.goto('${currentUrl}');\n\n`;
            } else if (format === 'puppeteer') {
                code += isPy
                    ? `${indent}await page.goto("${currentUrl}")\n\n`
                    : `${indent}await page.goto('${currentUrl}');\n\n`;
            } else if (format === 'selenium') {
                code += isPy
                    ? `driver.get("${currentUrl}")\n\n`
                    : `${indent}await driver.get('${currentUrl}');\n\n`;
            }
        }

        // Generate action code
        for (const action of actions) {
            code += generateActionCode(action, {
                format,
                language,
                includeComments,
                includeWaits,
                useLocators,
                indent
            });
        }

        // Generate footer
        if (format === 'playwright') {
            if (!isPy) {
                code += '});\n';
            }
        } else if (format === 'puppeteer') {
            if (isPy) {
                code += `
    # await browser.close()

asyncio.get_event_loop().run_until_complete(main())
`;
            } else {
                code += `
    // await browser.close();
})();
`;
            }
        } else if (format === 'selenium') {
            if (isPy) {
                code += `
# driver.quit()
`;
            } else {
                code += `
    // await driver.quit();
})();
`;
            }
        }

        return code;
    }

    function generateActionCode(action, options) {
        const { format, language, includeComments, includeWaits, useLocators, indent } = options;
        const isPy = language === 'python';
        let code = '';

        // Add comment
        if (includeComments) {
            const comment = describeActionForComment(action);
            code += `${indent}${isPy ? '# ' : '// '}${comment}\n`;
        }

        const selector = action.element ? generateSelector(action.element, useLocators) : '';

        switch (action.type) {
            case 'click':
                code += generateClickCode(action, selector, options);
                break;
            case 'dblclick':
                code += generateDblClickCode(action, selector, options);
                break;
            case 'type':
            case 'fill':
                code += generateFillCode(action, selector, options);
                break;
            case 'navigate':
                code += generateNavigateCode(action, options);
                break;
            case 'scroll':
                code += generateScrollCode(action, options);
                break;
            case 'press':
                code += generatePressCode(action, options);
                break;
            case 'hover':
                code += generateHoverCode(action, selector, options);
                break;
            case 'select':
                code += generateSelectCode(action, selector, options);
                break;
        }

        code += '\n';
        return code;
    }

    function generateSelector(element, useLocators) {
        if (!element) return "''";

        // Priority: testId > role + name > id > aria-label > placeholder > text > CSS
        if (useLocators) {
            if (element.testId) {
                return { type: 'testId', value: element.testId };
            }
            if (element.role) {
                const name = element.ariaLabel || element.text;
                return { type: 'role', role: element.role, name: name };
            }
            if (element.ariaLabel) {
                return { type: 'label', value: element.ariaLabel };
            }
            if (element.placeholder) {
                return { type: 'placeholder', value: element.placeholder };
            }
            if (element.text && element.text.length < 50) {
                return { type: 'text', value: element.text };
            }
        }

        // CSS selector fallback
        return { type: 'css', value: generateCssSelector(element) };
    }

    function generateCssSelector(element) {
        if (element.testId) return `[data-testid="${element.testId}"]`;
        if (element.id && !isAutoGeneratedId(element.id)) return `#${element.id}`;
        if (element.name) return `${(element.tagName || 'input').toLowerCase()}[name="${element.name}"]`;
        if (element.ariaLabel) return `[aria-label="${element.ariaLabel}"]`;
        if (element.cssSelector) return element.cssSelector;
        return (element.tagName || 'div').toLowerCase();
    }

    function isAutoGeneratedId(id) {
        return /^[a-f0-9]{8,}$/i.test(id) ||
               /^react-/.test(id) ||
               /^:r[0-9a-z]+:/.test(id) ||
               /^\d+$/.test(id);
    }

    function generateClickCode(action, selector, options) {
        const { format, language, indent } = options;
        const isPy = language === 'python';

        if (format === 'playwright') {
            const locator = formatPlaywrightLocator(selector, isPy);
            return isPy
                ? `${indent}page.${locator}.click()\n`
                : `${indent}await page.${locator}.click();\n`;
        } else if (format === 'puppeteer') {
            const css = selector.type === 'css' ? selector.value : generateCssSelector(action.element);
            return isPy
                ? `${indent}await page.click("${css}")\n`
                : `${indent}await page.click('${css}');\n`;
        } else if (format === 'selenium') {
            const by = formatSeleniumLocator(selector, isPy);
            return isPy
                ? `driver.find_element(${by}).click()\n`
                : `${indent}await driver.findElement(${by}).click();\n`;
        }
        return '';
    }

    function generateDblClickCode(action, selector, options) {
        const { format, language, indent } = options;
        const isPy = language === 'python';

        if (format === 'playwright') {
            const locator = formatPlaywrightLocator(selector, isPy);
            return isPy
                ? `${indent}page.${locator}.dblclick()\n`
                : `${indent}await page.${locator}.dblclick();\n`;
        } else if (format === 'puppeteer') {
            const css = selector.type === 'css' ? selector.value : generateCssSelector(action.element);
            return isPy
                ? `${indent}await page.click("${css}", {"clickCount": 2})\n`
                : `${indent}await page.click('${css}', { clickCount: 2 });\n`;
        }
        return '';
    }

    function generateFillCode(action, selector, options) {
        const { format, language, indent } = options;
        const isPy = language === 'python';
        const text = escapeString(action.text || '', isPy);

        if (format === 'playwright') {
            const locator = formatPlaywrightLocator(selector, isPy);
            return isPy
                ? `${indent}page.${locator}.fill("${text}")\n`
                : `${indent}await page.${locator}.fill('${text}');\n`;
        } else if (format === 'puppeteer') {
            const css = selector.type === 'css' ? selector.value : generateCssSelector(action.element);
            return isPy
                ? `${indent}await page.type("${css}", "${text}")\n`
                : `${indent}await page.type('${css}', '${text}');\n`;
        } else if (format === 'selenium') {
            const by = formatSeleniumLocator(selector, isPy);
            return isPy
                ? `driver.find_element(${by}).send_keys("${text}")\n`
                : `${indent}await driver.findElement(${by}).sendKeys('${text}');\n`;
        }
        return '';
    }

    function generateNavigateCode(action, options) {
        const { format, language, indent } = options;
        const isPy = language === 'python';
        const url = action.url || '';

        if (format === 'playwright') {
            return isPy
                ? `${indent}page.goto("${url}")\n`
                : `${indent}await page.goto('${url}');\n`;
        } else if (format === 'puppeteer') {
            return isPy
                ? `${indent}await page.goto("${url}")\n`
                : `${indent}await page.goto('${url}');\n`;
        } else if (format === 'selenium') {
            return isPy
                ? `driver.get("${url}")\n`
                : `${indent}await driver.get('${url}');\n`;
        }
        return '';
    }

    function generateScrollCode(action, options) {
        const { format, language, indent } = options;
        const isPy = language === 'python';
        const dx = action.deltaX || 0;
        const dy = action.deltaY || 0;

        if (format === 'playwright') {
            return isPy
                ? `${indent}page.mouse.wheel(${dx}, ${dy})\n`
                : `${indent}await page.mouse.wheel(${dx}, ${dy});\n`;
        } else if (format === 'puppeteer') {
            return isPy
                ? `${indent}await page.evaluate("window.scrollBy(${dx}, ${dy})")\n`
                : `${indent}await page.evaluate(() => window.scrollBy(${dx}, ${dy}));\n`;
        } else if (format === 'selenium') {
            return isPy
                ? `driver.execute_script("window.scrollBy(${dx}, ${dy})")\n`
                : `${indent}await driver.executeScript('window.scrollBy(${dx}, ${dy})');\n`;
        }
        return '';
    }

    function generatePressCode(action, options) {
        const { format, language, indent } = options;
        const isPy = language === 'python';
        const key = action.key || '';

        if (format === 'playwright') {
            return isPy
                ? `${indent}page.keyboard.press("${key}")\n`
                : `${indent}await page.keyboard.press('${key}');\n`;
        } else if (format === 'puppeteer') {
            return isPy
                ? `${indent}await page.keyboard.press("${key}")\n`
                : `${indent}await page.keyboard.press('${key}');\n`;
        }
        return '';
    }

    function generateHoverCode(action, selector, options) {
        const { format, language, indent } = options;
        const isPy = language === 'python';

        if (format === 'playwright') {
            const locator = formatPlaywrightLocator(selector, isPy);
            return isPy
                ? `${indent}page.${locator}.hover()\n`
                : `${indent}await page.${locator}.hover();\n`;
        } else if (format === 'puppeteer') {
            const css = selector.type === 'css' ? selector.value : generateCssSelector(action.element);
            return isPy
                ? `${indent}await page.hover("${css}")\n`
                : `${indent}await page.hover('${css}');\n`;
        }
        return '';
    }

    function generateSelectCode(action, selector, options) {
        const { format, language, indent } = options;
        const isPy = language === 'python';
        const value = escapeString(action.text || '', isPy);

        if (format === 'playwright') {
            const locator = formatPlaywrightLocator(selector, isPy);
            return isPy
                ? `${indent}page.${locator}.select_option("${value}")\n`
                : `${indent}await page.${locator}.selectOption('${value}');\n`;
        } else if (format === 'puppeteer') {
            const css = selector.type === 'css' ? selector.value : generateCssSelector(action.element);
            return isPy
                ? `${indent}await page.select("${css}", "${value}")\n`
                : `${indent}await page.select('${css}', '${value}');\n`;
        }
        return '';
    }

    function formatPlaywrightLocator(selector, isPy) {
        if (!selector || typeof selector === 'string') {
            return isPy ? `locator("${selector || ''}")` : `locator('${selector || ''}')`;
        }

        const q = isPy ? '"' : "'";
        switch (selector.type) {
            case 'testId':
                return isPy
                    ? `get_by_test_id(${q}${selector.value}${q})`
                    : `getByTestId(${q}${selector.value}${q})`;
            case 'role':
                const nameOpt = selector.name
                    ? (isPy ? `, name=${q}${selector.name}${q}` : `, { name: ${q}${selector.name}${q} }`)
                    : '';
                return isPy
                    ? `get_by_role(${q}${selector.role}${q}${nameOpt})`
                    : `getByRole(${q}${selector.role}${q}${nameOpt})`;
            case 'label':
                return isPy
                    ? `get_by_label(${q}${selector.value}${q})`
                    : `getByLabel(${q}${selector.value}${q})`;
            case 'placeholder':
                return isPy
                    ? `get_by_placeholder(${q}${selector.value}${q})`
                    : `getByPlaceholder(${q}${selector.value}${q})`;
            case 'text':
                return isPy
                    ? `get_by_text(${q}${selector.value}${q})`
                    : `getByText(${q}${selector.value}${q})`;
            case 'css':
            default:
                return isPy
                    ? `locator(${q}${selector.value}${q})`
                    : `locator(${q}${selector.value}${q})`;
        }
    }

    function formatSeleniumLocator(selector, isPy) {
        if (!selector) return isPy ? '(By.CSS_SELECTOR, "")' : "By.css('')";

        const value = selector.value || generateCssSelector(selector);
        if (isPy) {
            if (selector.type === 'testId') return `(By.CSS_SELECTOR, '[data-testid="${value}"]')`;
            return `(By.CSS_SELECTOR, "${value}")`;
        } else {
            if (selector.type === 'testId') return `By.css('[data-testid="${value}"]')`;
            return `By.css('${value}')`;
        }
    }

    function describeActionForComment(action) {
        switch (action.type) {
            case 'click':
                return `Click on ${describeElement(action.element)}`;
            case 'dblclick':
                return `Double-click on ${describeElement(action.element)}`;
            case 'type':
            case 'fill':
                return `Fill "${truncate(action.text || '', 30)}" into ${describeElement(action.element)}`;
            case 'navigate':
                return `Navigate to ${action.url}`;
            case 'scroll':
                return `Scroll ${action.deltaY > 0 ? 'down' : 'up'}`;
            case 'select':
                return `Select "${action.text}" in ${describeElement(action.element)}`;
            case 'hover':
                return `Hover over ${describeElement(action.element)}`;
            case 'press':
                return `Press ${action.key}`;
            default:
                return `Perform ${action.type} action`;
        }
    }

    // =============================================================================
    // Export Modal
    // =============================================================================

    function openExportModal() {
        if (recordedActions.length === 0) {
            showToast('No actions to export', 'warning');
            return;
        }

        document.getElementById('export-modal').classList.add('visible');
        regenerateCode();
    }

    function closeExportModal() {
        document.getElementById('export-modal').classList.remove('visible');
    }

    function regenerateCode() {
        const format = document.getElementById('export-format').value;
        const language = document.getElementById('export-language').value;
        const includeComments = document.getElementById('export-comments').checked;
        const includeWaits = document.getElementById('export-waits').checked;
        const useLocators = document.getElementById('export-locators').checked;

        const code = generateCodeLocally(recordedActions, {
            format,
            language,
            includeComments,
            includeWaits,
            useLocators
        });

        document.getElementById('code-preview').textContent = code;
    }

    function copyCodeToClipboard() {
        const code = document.getElementById('code-preview').textContent;
        navigator.clipboard.writeText(code).then(() => {
            const btn = document.getElementById('copy-code-btn');
            btn.classList.add('copied');
            showToast('Code copied to clipboard', 'success');
            setTimeout(() => btn.classList.remove('copied'), 2000);
        }).catch(err => {
            showToast('Failed to copy code', 'error');
        });
    }

    function downloadCode() {
        const code = document.getElementById('code-preview').textContent;
        const format = document.getElementById('export-format').value;
        const language = document.getElementById('export-language').value;

        const ext = language === 'python' ? 'py' : (language === 'typescript' ? 'ts' : 'js');
        const filename = `recorded-test.${ext}`;

        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`Downloaded ${filename}`, 'success');
    }

    function openInEditor() {
        const code = document.getElementById('code-preview').textContent;
        const format = document.getElementById('export-format').value;
        const language = document.getElementById('export-language').value;

        if (window.vscode) {
            window.vscode.postMessage({
                type: 'openGeneratedCode',
                code: code,
                format: format,
                language: language
            });
        }

        closeExportModal();
        showToast('Opening code in editor...', 'info');
    }

    // =============================================================================
    // Utility Functions
    // =============================================================================

    function generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    function truncate(str, maxLen) {
        if (!str) return '';
        if (str.length <= maxLen) return str;
        return str.substring(0, maxLen) + '...';
    }

    function formatTime(ms) {
        const seconds = Math.floor(ms / 1000) % 60;
        const minutes = Math.floor(ms / 60000);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function escapeString(str, forPython = false) {
        let escaped = str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        if (forPython) {
            escaped = escaped.replace(/"/g, '\\"');
        } else {
            escaped = escaped.replace(/'/g, "\\'");
        }
        return escaped;
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // =============================================================================
    // Message Handling
    // =============================================================================

    function handleMessage(event) {
        const message = event.data;
        switch (message.type) {
            case 'startRecording':
                startRecording();
                break;
            case 'stopRecording':
                stopRecording();
                break;
            case 'exportCode':
                openExportModal();
                break;
            case 'generatedCode':
                // Update preview with server-generated code
                if (message.code) {
                    document.getElementById('code-preview').textContent = message.code;
                }
                break;
            case 'clearRecording':
                recordedActions = [];
                updateActionsList();
                updateActionsCount();
                document.getElementById('export-code-btn').disabled = true;
                break;
        }
    }

    // =============================================================================
    // Initialization
    // =============================================================================

    function init() {
        initializeUI();
        hookActionRecording();
        window.addEventListener('message', handleMessage);

        // Notify that code generation is ready
        if (window.vscode) {
            window.vscode.postMessage({ type: 'codeGenerationReady' });
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export for external use
    window.CodeGeneration = {
        startRecording,
        stopRecording,
        recordAction,
        isRecording: () => isRecording,
        getRecordedActions: () => [...recordedActions],
        generateCode,
        openExportModal,
        closeExportModal
    };
})();
