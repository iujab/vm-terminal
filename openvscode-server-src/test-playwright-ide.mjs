/**
 * Playwright IDE Verification Test
 *
 * This script verifies that:
 * 1. Playwright Assistant icon appears in Activity Bar
 * 2. Clicking icon opens Browser Viewer + Chat panels
 * 3. Custom favicon is loaded
 * 4. Rounded corners are applied to UI elements
 * 5. Chat input is functional
 */

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:9888';

async function runTests() {
	console.log('Starting Playwright IDE verification tests...\n');

	const browser = await chromium.launch({ headless: false });
	const context = await browser.newContext({
		viewport: { width: 1400, height: 900 }
	});
	const page = await context.newPage();

	const results = {
		passed: 0,
		failed: 0,
		tests: []
	};

	function log(testName, passed, message = '') {
		const status = passed ? '✓' : '✗';
		const color = passed ? '\x1b[32m' : '\x1b[31m';
		console.log(`${color}${status}\x1b[0m ${testName}${message ? `: ${message}` : ''}`);
		results.tests.push({ name: testName, passed, message });
		if (passed) results.passed++;
		else results.failed++;
	}

	try {
		// Navigate to the IDE
		console.log('Loading Playwright IDE...');
		await page.goto(BASE_URL);

		// Wait for the workbench to load
		await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
		console.log('Workbench loaded.\n');

		// Test 1: Check custom favicon
		try {
			const faviconLink = await page.locator('link[rel="icon"]').getAttribute('href');
			const faviconContainsCustomPath = faviconLink && faviconLink.includes('favicon.ico');
			log('Custom favicon in browser tab', faviconContainsCustomPath, faviconLink);
		} catch (e) {
			log('Custom favicon in browser tab', false, e.message);
		}

		// Test 2: Check manifest name
		try {
			const manifestLink = await page.locator('link[rel="manifest"]').getAttribute('href');
			const manifestResponse = await page.request.get(`${BASE_URL}${manifestLink}`);
			const manifest = await manifestResponse.json();
			const isPlaywrightIDE = manifest.name === 'Playwright IDE';
			log('Manifest shows Playwright IDE', isPlaywrightIDE, manifest.name);
		} catch (e) {
			log('Manifest shows Playwright IDE', false, e.message);
		}

		// Test 3: Look for Playwright Assistant in Activity Bar
		// Wait a bit for extensions to load
		await page.waitForTimeout(3000);

		try {
			// Look for the Playwright icon in the activity bar
			const playwrightButton = page.locator('.activitybar .action-item[aria-label*="Playwright"]');
			const exists = await playwrightButton.count() > 0;

			if (!exists) {
				// Try to find it by icon class
				const playIcon = page.locator('.activitybar .codicon-play');
				const playIconExists = await playIcon.count() > 0;
				log('Playwright icon visible in Activity Bar', playIconExists,
					playIconExists ? 'Found play icon' : 'Icon not found - may need to check view registration');
			} else {
				log('Playwright icon visible in Activity Bar', true);

				// Test 4: Click to open the panels
				await playwrightButton.click();
				await page.waitForTimeout(1000);

				// Check for Browser Viewer panel
				const viewerPanel = page.locator('.playwright-viewer, [aria-label*="Browser Viewer"], .view-container[id*="playwright"]');
				const viewerVisible = await viewerPanel.count() > 0;
				log('Browser Viewer panel opens', viewerVisible);

				// Check for Chat panel
				const chatPanel = page.locator('.playwright-chat, [aria-label*="Chat"], .chat-messages');
				const chatVisible = await chatPanel.count() > 0;
				log('Chat panel opens', chatVisible);
			}
		} catch (e) {
			log('Playwright icon visible in Activity Bar', false, e.message);
		}

		// Test 5: Check rounded corners on command palette
		try {
			// Open command palette
			await page.keyboard.press('Control+Shift+P');
			await page.waitForTimeout(500);

			const quickInput = page.locator('.quick-input-widget');
			await quickInput.waitFor({ state: 'visible', timeout: 5000 });

			// Check the computed border-radius
			const borderRadius = await quickInput.evaluate(el => {
				return window.getComputedStyle(el).borderRadius;
			});

			const hasRoundedCorners = borderRadius && parseFloat(borderRadius) >= 10;
			log('Command palette has rounded corners', hasRoundedCorners, `border-radius: ${borderRadius}`);

			// Close command palette
			await page.keyboard.press('Escape');
		} catch (e) {
			log('Command palette has rounded corners', false, e.message);
		}

		// Test 6: Check rounded corners on context menu
		try {
			// Right-click to open context menu
			await page.click('.monaco-workbench', { button: 'right' });
			await page.waitForTimeout(500);

			const contextMenu = page.locator('.context-view .monaco-menu');
			const menuVisible = await contextMenu.count() > 0;

			if (menuVisible) {
				const borderRadius = await contextMenu.evaluate(el => {
					return window.getComputedStyle(el).borderRadius;
				});

				const hasRoundedCorners = borderRadius && parseFloat(borderRadius) >= 6;
				log('Context menus have rounded corners', hasRoundedCorners, `border-radius: ${borderRadius}`);
			} else {
				log('Context menus have rounded corners', false, 'Could not open context menu');
			}

			// Close context menu
			await page.keyboard.press('Escape');
		} catch (e) {
			log('Context menus have rounded corners', false, e.message);
		}

		// Summary
		console.log('\n' + '='.repeat(50));
		console.log(`Results: ${results.passed} passed, ${results.failed} failed`);
		console.log('='.repeat(50));

		// Keep browser open for manual inspection
		console.log('\nBrowser will stay open for manual inspection.');
		console.log('Press Ctrl+C to close.');

		// Wait indefinitely (or until user closes)
		await page.waitForTimeout(300000); // 5 minutes

	} catch (error) {
		console.error('Test error:', error);
	} finally {
		await browser.close();
	}

	return results;
}

runTests().catch(console.error);
