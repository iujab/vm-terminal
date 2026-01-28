/*---------------------------------------------------------------------------------------------
 *  Playwright Viewer View Pane - Browser screenshot viewer with interaction support
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IPlaywrightService, IAnnotation, ConnectionStatus } from '../common/playwrightAssistant.js';

export class PlaywrightViewPane extends ViewPane {

	static readonly ID = 'playwrightAssistant.viewer';

	private _container?: HTMLElement;
	private _screenshotImage?: HTMLImageElement;
	private _clickOverlay?: HTMLElement;
	private _annotationCanvas?: HTMLCanvasElement;
	private _statusBar?: HTMLElement;
	private _urlBar?: HTMLInputElement;
	private _toolbar?: HTMLElement;
	private _loadingIndicator?: HTMLElement;
	private _recordingIndicator?: HTMLElement;

	private readonly _viewDisposables = this._register(new DisposableStore());

	// Annotation state
	private _annotationMode = false;
	private _annotations: IAnnotation[] = [];
	private _currentAnnotation: Partial<IAnnotation> | null = null;
	private _annotationCtx: CanvasRenderingContext2D | null = null;

	// Events
	private readonly _onAnnotatedScreenshot = this._register(new Emitter<{ image: string; annotations: IAnnotation[] }>());
	readonly onAnnotatedScreenshot = this._onAnnotatedScreenshot.event;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this._register(this.playwrightService.onConnectionStatusChange(status => {
			this._updateConnectionStatus(status);
		}));

		this._register(this.playwrightService.onScreenshot(data => {
			this._updateScreenshot(data.image);
		}));

		this._register(this.playwrightService.onRecordingStateChange(isRecording => {
			this._updateRecordingIndicator(isRecording);
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = container;
		this._container.classList.add('playwright-viewer');

		// Create the viewer structure
		this._createStatusBar();
		this._createToolbar();
		this._createViewer();
		this._createLoadingIndicator();

		// Start screenshot stream when connected
		if (this.playwrightService.connectionStatus === 'connected') {
			this.playwrightService.startScreenshotStream();
			this._hideLoading();
		} else {
			this._showLoading();
		}
	}

	private _createStatusBar(): void {
		this._statusBar = $('div.playwright-status-bar');

		const connectionStatus = $('span.connection-status.disconnected');
		connectionStatus.textContent = 'Disconnected';
		this._statusBar.appendChild(connectionStatus);

		const actions = $('div.status-actions');

		const reconnectBtn = $('button.reconnect-btn');
		reconnectBtn.textContent = 'Reconnect';
		reconnectBtn.title = 'Reconnect to Playwright';
		this._viewDisposables.add(addDisposableListener(reconnectBtn, EventType.CLICK, () => {
			this.playwrightService.connect();
		}));
		actions.appendChild(reconnectBtn);

		this._statusBar.appendChild(actions);
		this._container!.appendChild(this._statusBar);
	}

	private _createToolbar(): void {
		this._toolbar = $('div.playwright-toolbar');

		// Navigation controls
		const navControls = $('div.nav-controls');

		const backBtn = $('button.nav-btn');
		backBtn.innerHTML = '&#8592;';
		backBtn.title = 'Back';
		this._viewDisposables.add(addDisposableListener(backBtn, EventType.CLICK, () => {
			this.playwrightService.goBack();
		}));
		navControls.appendChild(backBtn);

		const forwardBtn = $('button.nav-btn');
		forwardBtn.innerHTML = '&#8594;';
		forwardBtn.title = 'Forward';
		this._viewDisposables.add(addDisposableListener(forwardBtn, EventType.CLICK, () => {
			this.playwrightService.goForward();
		}));
		navControls.appendChild(forwardBtn);

		const reloadBtn = $('button.nav-btn');
		reloadBtn.innerHTML = '&#8635;';
		reloadBtn.title = 'Reload';
		this._viewDisposables.add(addDisposableListener(reloadBtn, EventType.CLICK, () => {
			this.playwrightService.reload();
		}));
		navControls.appendChild(reloadBtn);

		this._toolbar.appendChild(navControls);

		// URL bar
		this._urlBar = $('input.url-bar') as HTMLInputElement;
		this._urlBar.type = 'text';
		this._urlBar.placeholder = 'Enter URL...';
		this._viewDisposables.add(addDisposableListener(this._urlBar, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && this._urlBar) {
				this.playwrightService.navigate(this._urlBar.value);
			}
		}));
		this._toolbar.appendChild(this._urlBar);

		// Tool controls
		const toolControls = $('div.tool-controls');

		const annotateBtn = $('button.tool-btn');
		annotateBtn.textContent = 'A';
		annotateBtn.title = 'Annotation Mode';
		this._viewDisposables.add(addDisposableListener(annotateBtn, EventType.CLICK, () => {
			this.toggleAnnotationMode();
		}));
		toolControls.appendChild(annotateBtn);

		const recordBtn = $('button.tool-btn.record-btn');
		recordBtn.textContent = 'R';
		recordBtn.title = 'Record Session';
		this._viewDisposables.add(addDisposableListener(recordBtn, EventType.CLICK, () => {
			if (this.playwrightService.isRecording) {
				this.playwrightService.stopRecording();
			} else {
				this.playwrightService.startRecording();
			}
		}));
		toolControls.appendChild(recordBtn);

		this._toolbar.appendChild(toolControls);
		this._container!.appendChild(this._toolbar);
	}

	private _createViewer(): void {
		const viewerWrapper = $('div.viewer-wrapper');

		// Screenshot image
		this._screenshotImage = $('img.screenshot') as HTMLImageElement;
		this._screenshotImage.alt = 'Browser screenshot';
		viewerWrapper.appendChild(this._screenshotImage);

		// Click overlay for interactions
		this._clickOverlay = $('div.click-overlay');
		this._viewDisposables.add(addDisposableListener(this._clickOverlay, EventType.CLICK, (e: MouseEvent) => {
			if (!this._annotationMode) {
				this._handleClick(e);
			}
		}));
		this._viewDisposables.add(addDisposableListener(this._clickOverlay, 'wheel', (e: WheelEvent) => {
			e.preventDefault();
			this.playwrightService.scroll(e.deltaX, e.deltaY);
		}));
		viewerWrapper.appendChild(this._clickOverlay);

		// Annotation canvas
		this._annotationCanvas = $('canvas.annotation-canvas') as HTMLCanvasElement;
		this._annotationCtx = this._annotationCanvas.getContext('2d');
		this._setupAnnotationListeners();
		viewerWrapper.appendChild(this._annotationCanvas);

		// Recording indicator
		this._recordingIndicator = $('div.recording-indicator.hidden');
		const recordingDot = $('span.recording-dot');
		this._recordingIndicator.appendChild(recordingDot);
		const recordingText = $('span');
		recordingText.textContent = 'Recording';
		this._recordingIndicator.appendChild(recordingText);
		viewerWrapper.appendChild(this._recordingIndicator);

		this._container!.appendChild(viewerWrapper);

		// Type input at bottom
		const controls = $('div.playwright-controls');
		const typeInput = $('input.type-input') as HTMLInputElement;
		typeInput.type = 'text';
		typeInput.placeholder = 'Type text and press Enter...';
		this._viewDisposables.add(addDisposableListener(typeInput, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				this.playwrightService.type((e.target as HTMLInputElement).value);
				(e.target as HTMLInputElement).value = '';
			}
		}));
		controls.appendChild(typeInput);
		this._container!.appendChild(controls);
	}

	private _createLoadingIndicator(): void {
		this._loadingIndicator = $('div.loading-indicator');
		const spinner = $('div.spinner');
		this._loadingIndicator.appendChild(spinner);
		const text = $('span');
		text.textContent = 'Connecting to Playwright...';
		this._loadingIndicator.appendChild(text);
		this._container!.appendChild(this._loadingIndicator);
	}

	private _setupAnnotationListeners(): void {
		if (!this._annotationCanvas) {
			return;
		}

		this._viewDisposables.add(addDisposableListener(this._annotationCanvas, 'mousedown', (e: MouseEvent) => {
			if (this._annotationMode) {
				this._startAnnotation(e);
			}
		}));

		this._viewDisposables.add(addDisposableListener(this._annotationCanvas, 'mousemove', (e: MouseEvent) => {
			if (this._annotationMode && this._currentAnnotation) {
				this._updateAnnotation(e);
			}
		}));

		this._viewDisposables.add(addDisposableListener(this._annotationCanvas, 'mouseup', () => {
			if (this._annotationMode && this._currentAnnotation) {
				this._finishAnnotation();
			}
		}));
	}

	private _handleClick(e: MouseEvent): void {
		if (!this._screenshotImage || !this._clickOverlay) {
			return;
		}

		const rect = this._clickOverlay.getBoundingClientRect();
		const imgRect = this._screenshotImage.getBoundingClientRect();

		// Calculate relative position
		const scaleX = this._screenshotImage.naturalWidth / imgRect.width;
		const scaleY = this._screenshotImage.naturalHeight / imgRect.height;

		const x = (e.clientX - rect.left) * scaleX;
		const y = (e.clientY - rect.top) * scaleY;

		this.playwrightService.click(x, y);
	}

	private _updateScreenshot(base64Image: string): void {
		if (this._screenshotImage) {
			this._screenshotImage.src = `data:image/png;base64,${base64Image}`;
			this._hideLoading();
		}
	}

	private _updateConnectionStatus(status: ConnectionStatus): void {
		if (!this._statusBar) {
			return;
		}

		const statusEl = this._statusBar.querySelector('.connection-status');
		if (statusEl) {
			statusEl.className = `connection-status ${status}`;
			statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
		}

		if (status === 'connected') {
			this.playwrightService.startScreenshotStream();
			this._hideLoading();
		} else if (status === 'disconnected' || status === 'error') {
			this.playwrightService.stopScreenshotStream();
			this._showLoading();
		}
	}

	private _updateRecordingIndicator(isRecording: boolean): void {
		if (this._recordingIndicator) {
			this._recordingIndicator.classList.toggle('hidden', !isRecording);
		}
	}

	private _showLoading(): void {
		if (this._loadingIndicator) {
			this._loadingIndicator.style.display = 'flex';
		}
	}

	private _hideLoading(): void {
		if (this._loadingIndicator) {
			this._loadingIndicator.style.display = 'none';
		}
	}

	// Annotation methods
	toggleAnnotationMode(): void {
		this._annotationMode = !this._annotationMode;
		if (this._clickOverlay) {
			this._clickOverlay.style.pointerEvents = this._annotationMode ? 'none' : 'auto';
		}
		if (this._annotationCanvas) {
			this._annotationCanvas.style.pointerEvents = this._annotationMode ? 'auto' : 'none';
		}
	}

	private _startAnnotation(e: MouseEvent): void {
		if (!this._annotationCanvas) {
			return;
		}

		const rect = this._annotationCanvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		this._currentAnnotation = {
			id: `anno-${Date.now()}`,
			type: 'pen',
			points: [{ x, y }],
			color: '#ff0000',
			strokeWidth: 3,
			timestamp: Date.now()
		};
	}

	private _updateAnnotation(e: MouseEvent): void {
		if (!this._annotationCanvas || !this._currentAnnotation || !this._annotationCtx) {
			return;
		}

		const rect = this._annotationCanvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		if (this._currentAnnotation.points) {
			this._currentAnnotation.points.push({ x, y });
		}

		// Draw the current stroke
		this._redrawAnnotations();
	}

	private _finishAnnotation(): void {
		if (this._currentAnnotation) {
			this._annotations.push(this._currentAnnotation as IAnnotation);
			this._currentAnnotation = null;
		}
	}

	private _redrawAnnotations(): void {
		if (!this._annotationCanvas || !this._annotationCtx) {
			return;
		}

		const ctx = this._annotationCtx;
		ctx.clearRect(0, 0, this._annotationCanvas.width, this._annotationCanvas.height);

		// Draw all completed annotations
		for (const annotation of this._annotations) {
			this._drawAnnotation(ctx, annotation);
		}

		// Draw current annotation
		if (this._currentAnnotation) {
			this._drawAnnotation(ctx, this._currentAnnotation as IAnnotation);
		}
	}

	private _drawAnnotation(ctx: CanvasRenderingContext2D, annotation: IAnnotation): void {
		ctx.strokeStyle = annotation.color;
		ctx.lineWidth = annotation.strokeWidth;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		if (annotation.type === 'pen' && annotation.points && annotation.points.length > 1) {
			ctx.beginPath();
			ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
			for (let i = 1; i < annotation.points.length; i++) {
				ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
			}
			ctx.stroke();
		}
	}

	sendAnnotatedScreenshotToChat(): void {
		if (this._screenshotImage && this._annotationCanvas) {
			// Create a combined canvas
			const canvas = document.createElement('canvas');
			canvas.width = this._screenshotImage.naturalWidth;
			canvas.height = this._screenshotImage.naturalHeight;
			const ctx = canvas.getContext('2d');

			if (ctx) {
				// Draw screenshot
				ctx.drawImage(this._screenshotImage, 0, 0);

				// Draw annotations scaled
				const scaleX = canvas.width / this._annotationCanvas.width;
				const scaleY = canvas.height / this._annotationCanvas.height;
				ctx.scale(scaleX, scaleY);
				ctx.drawImage(this._annotationCanvas, 0, 0);

				const imageData = canvas.toDataURL('image/png').split(',')[1];
				this._onAnnotatedScreenshot.fire({
					image: imageData,
					annotations: [...this._annotations]
				});
			}
		}
	}

	clearAnnotations(): void {
		this._annotations = [];
		this._redrawAnnotations();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		if (this._annotationCanvas) {
			this._annotationCanvas.width = width;
			this._annotationCanvas.height = height - 100; // Account for toolbar and status
			this._redrawAnnotations();
		}
	}
}
