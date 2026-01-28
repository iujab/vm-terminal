/**
 * Annotation system for Playwright Assistant
 * Provides drawing tools for annotating screenshots
 */
(function() {
    // @ts-ignore
    const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;

    /**
     * @typedef {Object} Point
     * @property {number} x
     * @property {number} y
     */

    /**
     * @typedef {Object} Annotation
     * @property {string} id
     * @property {'pen'|'highlighter'|'arrow'|'rectangle'|'circle'|'text'} type
     * @property {Point[]} [points]
     * @property {Point} [start]
     * @property {Point} [end]
     * @property {string} [text]
     * @property {string} color
     * @property {number} strokeWidth
     * @property {number} timestamp
     */

    class AnnotationManager {
        constructor() {
            /** @type {HTMLCanvasElement} */
            this.canvas = document.getElementById('annotation-canvas');
            /** @type {CanvasRenderingContext2D} */
            this.ctx = this.canvas.getContext('2d');

            /** @type {Annotation[]} */
            this.annotations = [];
            /** @type {Annotation[]} */
            this.redoStack = [];

            // Current tool state
            this.currentTool = 'pen';
            this.currentColor = '#ff0000';
            this.strokeWidth = 3;
            this.isDrawing = false;
            this.isAnnotationMode = false;

            /** @type {Annotation|null} */
            this.currentAnnotation = null;

            /** @type {Point|null} */
            this.startPoint = null;

            // Screenshot ID for persistence
            this.currentScreenshotId = null;

            // Text input element
            this.textInput = null;

            this.init();
        }

        init() {
            this.setupCanvas();
            this.setupEventListeners();
            this.setupToolbar();
            this.loadFromSession();
        }

        setupCanvas() {
            const wrapper = document.getElementById('viewer-wrapper');
            const screenshot = document.getElementById('screenshot');

            // Resize canvas to match screenshot
            const resizeCanvas = () => {
                if (screenshot && screenshot.complete && screenshot.naturalWidth > 0) {
                    const rect = screenshot.getBoundingClientRect();
                    this.canvas.width = rect.width;
                    this.canvas.height = rect.height;
                    this.canvas.style.width = rect.width + 'px';
                    this.canvas.style.height = rect.height + 'px';
                    this.redraw();
                }
            };

            // Resize when screenshot loads or window resizes
            screenshot.addEventListener('load', resizeCanvas);
            window.addEventListener('resize', resizeCanvas);

            // Initial resize
            if (screenshot.complete) {
                resizeCanvas();
            }
        }

        setupEventListeners() {
            this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
            this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
            this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
            this.canvas.addEventListener('mouseleave', this.handleMouseUp.bind(this));

            // Touch support
            this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this));
            this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this));
            this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this));

            // Keyboard shortcuts
            document.addEventListener('keydown', this.handleKeyDown.bind(this));
        }

        setupToolbar() {
            // Tool buttons - support both class names for compatibility
            document.querySelectorAll('.annotation-tool, .anno-tool').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const tool = e.currentTarget.dataset.tool;
                    if (tool) {
                        this.setTool(tool);
                    }
                });
            });

            // Color picker - support both IDs
            const colorPicker = document.getElementById('annotation-color') || document.getElementById('anno-color');
            if (colorPicker) {
                colorPicker.addEventListener('input', (e) => {
                    this.currentColor = e.target.value;
                });
            }

            // Preset colors - support both class names
            document.querySelectorAll('.color-preset, .anno-color-preset').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    this.currentColor = e.currentTarget.dataset.color;
                    if (colorPicker) {
                        colorPicker.value = this.currentColor;
                    }
                    document.querySelectorAll('.color-preset, .anno-color-preset').forEach(b => b.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                });
            });

            // Stroke width - support both IDs
            const strokeSlider = document.getElementById('stroke-width') || document.getElementById('anno-stroke');
            if (strokeSlider) {
                strokeSlider.addEventListener('change', (e) => {
                    this.strokeWidth = parseInt(e.target.value, 10);
                });
                strokeSlider.addEventListener('input', (e) => {
                    this.strokeWidth = parseInt(e.target.value, 10);
                });
            }

            // Undo button - support both IDs
            const undoBtn = document.getElementById('annotation-undo') || document.getElementById('anno-undo');
            if (undoBtn) {
                undoBtn.addEventListener('click', () => this.undo());
            }

            // Redo button - support both IDs
            const redoBtn = document.getElementById('annotation-redo') || document.getElementById('anno-redo');
            if (redoBtn) {
                redoBtn.addEventListener('click', () => this.redo());
            }

            // Clear button - support both IDs
            const clearBtn = document.getElementById('annotation-clear') || document.getElementById('anno-clear');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => this.clearAll());
            }

            // Toggle annotation mode - support both IDs
            const toggleBtn = document.getElementById('annotation-toggle') || document.getElementById('annotate-btn');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => this.toggleAnnotationMode());
            }

            // Send to chat button - support both IDs
            const sendBtn = document.getElementById('send-to-chat') || document.getElementById('anno-send');
            if (sendBtn) {
                sendBtn.addEventListener('click', () => this.sendToChat());
            }
        }

        toggleAnnotationMode() {
            this.isAnnotationMode = !this.isAnnotationMode;

            const canvas = this.canvas;
            const clickOverlay = document.getElementById('click-overlay');
            const toggleBtn = document.getElementById('annotation-toggle');
            const toolbar = document.getElementById('annotation-toolbar');

            if (this.isAnnotationMode) {
                canvas.classList.add('active');
                if (clickOverlay) clickOverlay.style.pointerEvents = 'none';
                if (toggleBtn) toggleBtn.classList.add('active');
                if (toolbar) toolbar.classList.add('visible');
                this.updateCursor();
            } else {
                canvas.classList.remove('active');
                if (clickOverlay) clickOverlay.style.pointerEvents = 'auto';
                if (toggleBtn) toggleBtn.classList.remove('active');
                if (toolbar) toolbar.classList.remove('visible');
                canvas.style.cursor = 'default';
            }
        }

        setTool(tool) {
            this.currentTool = tool;

            // Update UI - support both class names
            document.querySelectorAll('.annotation-tool, .anno-tool').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tool === tool);
            });

            this.updateCursor();
        }

        updateCursor() {
            if (!this.isAnnotationMode) {
                this.canvas.style.cursor = 'default';
                return;
            }

            switch (this.currentTool) {
                case 'pen':
                case 'highlighter':
                    this.canvas.style.cursor = 'crosshair';
                    break;
                case 'arrow':
                case 'rectangle':
                case 'circle':
                    this.canvas.style.cursor = 'crosshair';
                    break;
                case 'text':
                    this.canvas.style.cursor = 'text';
                    break;
                case 'eraser':
                    this.canvas.style.cursor = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'10\' fill=\'white\' stroke=\'black\' stroke-width=\'2\'/%3E%3C/svg%3E") 12 12, auto';
                    break;
                default:
                    this.canvas.style.cursor = 'crosshair';
            }
        }

        getCanvasPoint(e) {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        }

        handleMouseDown(e) {
            if (!this.isAnnotationMode) return;

            const point = this.getCanvasPoint(e);
            this.isDrawing = true;
            this.startPoint = point;

            if (this.currentTool === 'text') {
                this.showTextInput(point);
                return;
            }

            if (this.currentTool === 'eraser') {
                this.eraseAt(point);
                return;
            }

            // Start new annotation
            this.currentAnnotation = {
                id: this.generateId(),
                type: this.currentTool,
                color: this.currentColor,
                strokeWidth: this.currentTool === 'highlighter' ? this.strokeWidth * 4 : this.strokeWidth,
                timestamp: Date.now(),
                points: this.currentTool === 'pen' || this.currentTool === 'highlighter' ? [point] : undefined,
                start: point
            };

            // Clear redo stack when starting new annotation
            this.redoStack = [];
        }

        handleMouseMove(e) {
            if (!this.isAnnotationMode || !this.isDrawing) return;

            const point = this.getCanvasPoint(e);

            if (this.currentTool === 'eraser') {
                this.eraseAt(point);
                return;
            }

            if (!this.currentAnnotation) return;

            if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
                this.currentAnnotation.points.push(point);
                this.redraw();
                this.drawAnnotation(this.currentAnnotation);
            } else if (this.currentTool === 'arrow' || this.currentTool === 'rectangle' || this.currentTool === 'circle') {
                this.currentAnnotation.end = point;
                this.redraw();
                this.drawAnnotation(this.currentAnnotation);
            }
        }

        handleMouseUp(e) {
            if (!this.isAnnotationMode || !this.isDrawing) return;

            this.isDrawing = false;

            if (this.currentTool === 'eraser') {
                this.saveToSession();
                return;
            }

            if (this.currentAnnotation) {
                if (this.currentTool === 'arrow' || this.currentTool === 'rectangle' || this.currentTool === 'circle') {
                    if (!this.currentAnnotation.end) {
                        this.currentAnnotation.end = this.getCanvasPoint(e);
                    }
                }

                // Only add annotation if it has content
                if (this.isValidAnnotation(this.currentAnnotation)) {
                    this.annotations.push(this.currentAnnotation);
                    this.saveToSession();
                }

                this.currentAnnotation = null;
                this.redraw();
            }
        }

        handleTouchStart(e) {
            e.preventDefault();
            const touch = e.touches[0];
            this.handleMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
        }

        handleTouchMove(e) {
            e.preventDefault();
            const touch = e.touches[0];
            this.handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
        }

        handleTouchEnd(e) {
            e.preventDefault();
            const touch = e.changedTouches[0];
            this.handleMouseUp({ clientX: touch.clientX, clientY: touch.clientY });
        }

        handleKeyDown(e) {
            // Ctrl/Cmd + Z = Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
            }
            // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y = Redo
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                this.redo();
            }
            // Escape = Exit annotation mode
            if (e.key === 'Escape' && this.isAnnotationMode) {
                this.toggleAnnotationMode();
            }
        }

        isValidAnnotation(annotation) {
            if (annotation.type === 'pen' || annotation.type === 'highlighter') {
                return annotation.points && annotation.points.length > 1;
            }
            if (annotation.type === 'text') {
                return annotation.text && annotation.text.trim().length > 0;
            }
            if (annotation.type === 'arrow' || annotation.type === 'rectangle' || annotation.type === 'circle') {
                if (!annotation.start || !annotation.end) return false;
                const dx = Math.abs(annotation.end.x - annotation.start.x);
                const dy = Math.abs(annotation.end.y - annotation.start.y);
                return dx > 5 || dy > 5;
            }
            return false;
        }

        showTextInput(point) {
            // Remove existing text input if any
            if (this.textInput) {
                this.textInput.remove();
            }

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'annotation-text-input';
            input.style.position = 'absolute';
            input.style.left = (this.canvas.offsetLeft + point.x) + 'px';
            input.style.top = (this.canvas.offsetTop + point.y - 10) + 'px';
            input.style.color = this.currentColor;
            input.style.fontSize = (this.strokeWidth * 4) + 'px';
            input.placeholder = 'Enter text...';

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.addTextAnnotation(point, input.value);
                    input.remove();
                    this.textInput = null;
                }
                if (e.key === 'Escape') {
                    input.remove();
                    this.textInput = null;
                }
            });

            input.addEventListener('blur', () => {
                if (input.value.trim()) {
                    this.addTextAnnotation(point, input.value);
                }
                input.remove();
                this.textInput = null;
            });

            this.canvas.parentElement.appendChild(input);
            this.textInput = input;
            input.focus();
        }

        addTextAnnotation(point, text) {
            if (!text.trim()) return;

            const annotation = {
                id: this.generateId(),
                type: 'text',
                start: point,
                text: text,
                color: this.currentColor,
                strokeWidth: this.strokeWidth * 4,
                timestamp: Date.now()
            };

            this.annotations.push(annotation);
            this.redoStack = [];
            this.redraw();
            this.saveToSession();
        }

        eraseAt(point) {
            const eraserRadius = this.strokeWidth * 5;

            // Find annotations that intersect with eraser
            this.annotations = this.annotations.filter(annotation => {
                return !this.intersectsWithEraser(annotation, point, eraserRadius);
            });

            this.redraw();
        }

        intersectsWithEraser(annotation, eraserPoint, radius) {
            if (annotation.type === 'pen' || annotation.type === 'highlighter') {
                for (const point of annotation.points) {
                    const dx = point.x - eraserPoint.x;
                    const dy = point.y - eraserPoint.y;
                    if (dx * dx + dy * dy < radius * radius) {
                        return true;
                    }
                }
            } else if (annotation.type === 'text') {
                // Simple bounding box check for text
                const textWidth = annotation.text.length * annotation.strokeWidth * 0.6;
                const textHeight = annotation.strokeWidth;
                if (eraserPoint.x >= annotation.start.x - radius &&
                    eraserPoint.x <= annotation.start.x + textWidth + radius &&
                    eraserPoint.y >= annotation.start.y - textHeight - radius &&
                    eraserPoint.y <= annotation.start.y + radius) {
                    return true;
                }
            } else if (annotation.start && annotation.end) {
                // Check corners and edges for shapes
                const points = [
                    annotation.start,
                    annotation.end,
                    { x: annotation.start.x, y: annotation.end.y },
                    { x: annotation.end.x, y: annotation.start.y }
                ];
                for (const point of points) {
                    const dx = point.x - eraserPoint.x;
                    const dy = point.y - eraserPoint.y;
                    if (dx * dx + dy * dy < radius * radius) {
                        return true;
                    }
                }
            }
            return false;
        }

        drawAnnotation(annotation) {
            this.ctx.save();
            this.ctx.strokeStyle = annotation.color;
            this.ctx.fillStyle = annotation.color;
            this.ctx.lineWidth = annotation.strokeWidth;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';

            if (annotation.type === 'highlighter') {
                this.ctx.globalAlpha = 0.4;
            }

            switch (annotation.type) {
                case 'pen':
                case 'highlighter':
                    this.drawPath(annotation.points);
                    break;
                case 'arrow':
                    this.drawArrow(annotation.start, annotation.end);
                    break;
                case 'rectangle':
                    this.drawRectangle(annotation.start, annotation.end);
                    break;
                case 'circle':
                    this.drawCircle(annotation.start, annotation.end);
                    break;
                case 'text':
                    this.drawText(annotation.start, annotation.text, annotation.strokeWidth);
                    break;
            }

            this.ctx.restore();
        }

        drawPath(points) {
            if (!points || points.length < 2) return;

            this.ctx.beginPath();
            this.ctx.moveTo(points[0].x, points[0].y);

            for (let i = 1; i < points.length; i++) {
                this.ctx.lineTo(points[i].x, points[i].y);
            }

            this.ctx.stroke();
        }

        drawArrow(start, end) {
            if (!start || !end) return;

            const headLength = Math.min(20, Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)) / 3);
            const angle = Math.atan2(end.y - start.y, end.x - start.x);

            // Draw line
            this.ctx.beginPath();
            this.ctx.moveTo(start.x, start.y);
            this.ctx.lineTo(end.x, end.y);
            this.ctx.stroke();

            // Draw arrowhead
            this.ctx.beginPath();
            this.ctx.moveTo(end.x, end.y);
            this.ctx.lineTo(
                end.x - headLength * Math.cos(angle - Math.PI / 6),
                end.y - headLength * Math.sin(angle - Math.PI / 6)
            );
            this.ctx.moveTo(end.x, end.y);
            this.ctx.lineTo(
                end.x - headLength * Math.cos(angle + Math.PI / 6),
                end.y - headLength * Math.sin(angle + Math.PI / 6)
            );
            this.ctx.stroke();
        }

        drawRectangle(start, end) {
            if (!start || !end) return;

            const x = Math.min(start.x, end.x);
            const y = Math.min(start.y, end.y);
            const width = Math.abs(end.x - start.x);
            const height = Math.abs(end.y - start.y);

            this.ctx.strokeRect(x, y, width, height);
        }

        drawCircle(start, end) {
            if (!start || !end) return;

            const centerX = (start.x + end.x) / 2;
            const centerY = (start.y + end.y) / 2;
            const radiusX = Math.abs(end.x - start.x) / 2;
            const radiusY = Math.abs(end.y - start.y) / 2;

            this.ctx.beginPath();
            this.ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
            this.ctx.stroke();
        }

        drawText(point, text, fontSize) {
            if (!point || !text) return;

            this.ctx.font = `${fontSize}px var(--vscode-font-family, Arial)`;
            this.ctx.fillText(text, point.x, point.y);
        }

        redraw() {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            for (const annotation of this.annotations) {
                this.drawAnnotation(annotation);
            }
        }

        undo() {
            if (this.annotations.length === 0) return;

            const lastAnnotation = this.annotations.pop();
            this.redoStack.push(lastAnnotation);
            this.redraw();
            this.saveToSession();
        }

        redo() {
            if (this.redoStack.length === 0) return;

            const annotation = this.redoStack.pop();
            this.annotations.push(annotation);
            this.redraw();
            this.saveToSession();
        }

        clearAll() {
            if (this.annotations.length === 0) return;

            // Save current state for undo
            this.redoStack = [...this.annotations];
            this.annotations = [];
            this.redraw();
            this.saveToSession();
        }

        generateId() {
            return 'ann_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }

        saveToSession() {
            const key = 'annotations_' + (this.currentScreenshotId || 'default');
            try {
                sessionStorage.setItem(key, JSON.stringify(this.annotations));
            } catch (e) {
                console.warn('Failed to save annotations to session storage:', e);
            }
        }

        loadFromSession() {
            const key = 'annotations_' + (this.currentScreenshotId || 'default');
            try {
                const saved = sessionStorage.getItem(key);
                if (saved) {
                    this.annotations = JSON.parse(saved);
                    this.redraw();
                }
            } catch (e) {
                console.warn('Failed to load annotations from session storage:', e);
            }
        }

        setScreenshotId(id) {
            this.currentScreenshotId = id;
            this.loadFromSession();
        }

        getAnnotatedScreenshot() {
            const screenshot = document.getElementById('screenshot');
            if (!screenshot) return null;

            // Create a temporary canvas to merge screenshot and annotations
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = screenshot.naturalWidth;
            tempCanvas.height = screenshot.naturalHeight;
            const tempCtx = tempCanvas.getContext('2d');

            // Draw screenshot
            tempCtx.drawImage(screenshot, 0, 0);

            // Scale factor for annotations
            const scaleX = screenshot.naturalWidth / this.canvas.width;
            const scaleY = screenshot.naturalHeight / this.canvas.height;

            // Draw annotations scaled to screenshot size
            for (const annotation of this.annotations) {
                tempCtx.save();
                tempCtx.strokeStyle = annotation.color;
                tempCtx.fillStyle = annotation.color;
                tempCtx.lineWidth = annotation.strokeWidth * scaleX;
                tempCtx.lineCap = 'round';
                tempCtx.lineJoin = 'round';

                if (annotation.type === 'highlighter') {
                    tempCtx.globalAlpha = 0.4;
                }

                switch (annotation.type) {
                    case 'pen':
                    case 'highlighter':
                        if (annotation.points && annotation.points.length > 1) {
                            tempCtx.beginPath();
                            tempCtx.moveTo(annotation.points[0].x * scaleX, annotation.points[0].y * scaleY);
                            for (let i = 1; i < annotation.points.length; i++) {
                                tempCtx.lineTo(annotation.points[i].x * scaleX, annotation.points[i].y * scaleY);
                            }
                            tempCtx.stroke();
                        }
                        break;
                    case 'arrow':
                        if (annotation.start && annotation.end) {
                            const start = { x: annotation.start.x * scaleX, y: annotation.start.y * scaleY };
                            const end = { x: annotation.end.x * scaleX, y: annotation.end.y * scaleY };
                            const headLength = Math.min(20 * scaleX, Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)) / 3);
                            const angle = Math.atan2(end.y - start.y, end.x - start.x);

                            tempCtx.beginPath();
                            tempCtx.moveTo(start.x, start.y);
                            tempCtx.lineTo(end.x, end.y);
                            tempCtx.stroke();

                            tempCtx.beginPath();
                            tempCtx.moveTo(end.x, end.y);
                            tempCtx.lineTo(end.x - headLength * Math.cos(angle - Math.PI / 6), end.y - headLength * Math.sin(angle - Math.PI / 6));
                            tempCtx.moveTo(end.x, end.y);
                            tempCtx.lineTo(end.x - headLength * Math.cos(angle + Math.PI / 6), end.y - headLength * Math.sin(angle + Math.PI / 6));
                            tempCtx.stroke();
                        }
                        break;
                    case 'rectangle':
                        if (annotation.start && annotation.end) {
                            const x = Math.min(annotation.start.x, annotation.end.x) * scaleX;
                            const y = Math.min(annotation.start.y, annotation.end.y) * scaleY;
                            const width = Math.abs(annotation.end.x - annotation.start.x) * scaleX;
                            const height = Math.abs(annotation.end.y - annotation.start.y) * scaleY;
                            tempCtx.strokeRect(x, y, width, height);
                        }
                        break;
                    case 'circle':
                        if (annotation.start && annotation.end) {
                            const centerX = (annotation.start.x + annotation.end.x) / 2 * scaleX;
                            const centerY = (annotation.start.y + annotation.end.y) / 2 * scaleY;
                            const radiusX = Math.abs(annotation.end.x - annotation.start.x) / 2 * scaleX;
                            const radiusY = Math.abs(annotation.end.y - annotation.start.y) / 2 * scaleY;
                            tempCtx.beginPath();
                            tempCtx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
                            tempCtx.stroke();
                        }
                        break;
                    case 'text':
                        if (annotation.start && annotation.text) {
                            tempCtx.font = `${annotation.strokeWidth * scaleX}px var(--vscode-font-family, Arial)`;
                            tempCtx.fillText(annotation.text, annotation.start.x * scaleX, annotation.start.y * scaleY);
                        }
                        break;
                }

                tempCtx.restore();
            }

            return tempCanvas.toDataURL('image/png');
        }

        sendToChat() {
            const imageData = this.getAnnotatedScreenshot();
            if (!imageData) {
                console.error('No screenshot available');
                return;
            }

            // Send via WebSocket if available
            if (typeof window.sendWebSocketMessage === 'function') {
                window.sendWebSocketMessage({
                    type: 'sendAnnotatedScreenshot',
                    image: imageData,
                    annotations: this.annotations
                });
            }

            // Also send to VS Code extension
            if (vscode) {
                vscode.postMessage({
                    type: 'sendAnnotatedScreenshot',
                    image: imageData,
                    annotations: this.annotations
                });
            }
        }

        // WebSocket integration for saving/loading annotations
        handleWebSocketMessage(data) {
            switch (data.type) {
                case 'annotationsSaved':
                    console.log('Annotations saved successfully');
                    break;
                case 'annotationsLoaded':
                    if (data.annotations) {
                        this.annotations = data.annotations;
                        this.redraw();
                    }
                    break;
            }
        }

        saveAnnotationsToServer() {
            if (!this.currentScreenshotId) return;

            if (typeof window.sendWebSocketMessage === 'function') {
                window.sendWebSocketMessage({
                    type: 'saveAnnotation',
                    screenshotId: this.currentScreenshotId,
                    annotations: this.annotations
                });
            }
        }

        loadAnnotationsFromServer() {
            if (!this.currentScreenshotId) return;

            if (typeof window.sendWebSocketMessage === 'function') {
                window.sendWebSocketMessage({
                    type: 'getAnnotations',
                    screenshotId: this.currentScreenshotId
                });
            }
        }

        // Export annotations as JSON
        exportAnnotations() {
            return JSON.stringify({
                screenshotId: this.currentScreenshotId,
                annotations: this.annotations,
                exportedAt: Date.now()
            }, null, 2);
        }

        // Import annotations from JSON
        importAnnotations(json) {
            try {
                const data = JSON.parse(json);
                if (data.annotations) {
                    this.annotations = data.annotations;
                    this.redraw();
                    this.saveToSession();
                }
            } catch (e) {
                console.error('Failed to import annotations:', e);
            }
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.annotationManager = new AnnotationManager();
        });
    } else {
        window.annotationManager = new AnnotationManager();
    }
})();
