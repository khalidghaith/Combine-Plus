/**
 * PDF Annotation Toolbar Logic - Combine+
 *
 * Fixed version addressing:
 * - Event listener accumulation (re-registration on every zoom)
 * - Pointer tool conflicting with viewer panning
 * - Text resize replaced with intuitive font-size slider
 * - Correct canvas coordinate mapping
 * - Annotations serialized and exported into the final PDF (via flat rasterization)
 * - Polyline right-click no longer conflicts with context menu
 * - Proper canvas lifecycle (reset on viewer close / page change)
 */

// ─── 1. Constants & State ────────────────────────────────────────────────────

let isAnnotationMode = false;
window.toggleAnnotationMode = function (forceOpen) {
    const tb = document.getElementById('annotation-toolbar');
    const ac = document.getElementById('annot-canvas');
    if (!tb || !ac) return;

    isAnnotationMode = (typeof forceOpen === 'boolean') ? forceOpen : !isAnnotationMode;

    if (isAnnotationMode) {
        tb.classList.remove('hidden');
        tb.classList.add('flex');
        setActiveTool('PEN');
    } else {
        tb.classList.add('hidden');
        tb.classList.remove('flex');
        ac.style.pointerEvents = 'none';
        setActiveTool('POINTER');
        AnnotationState.selectedAnnotationId = null;
        renderAnnotations();
    }
};

const ActiveTool = {
    POINTER: 'POINTER',
    PEN: 'PEN',
    HIGHLIGHTER: 'HIGHLIGHTER',
    ERASER: 'ERASER',
    TEXT: 'TEXT',
    TEXT_CALLOUT: 'TEXT_CALLOUT',
    SHAPES: 'SHAPES'
};

const AnnotationState = {
    currentActiveTool: ActiveTool.POINTER,
    currentShapeType: 'POLYLINE',
    currentTextType: 'TEXT',
    currentEraserMode: 'PIXEL',
    currentStrokeColor: '#EF4444',
    currentTextColor: '#EF4444',
    currentFillColor: 'transparent',
    currentStrokeStyle: 'solid',
    currentStrokeWidth: 2,
    currentStrokeOpacity: 100,
    currentFillOpacity: 100,
    currentFontSize: 16,        // Dedicated font size (not mapped from stroke)
    selectedAnnotationId: null,
    annotations: [],
    historyStack: [],           // NEW: Snapshot-based history
    redoStack: [],              // NEW: Redo stack
    isEditing: false,
    initialSnapshot: null
};

/**
 * NEW: Take a snapshot of current annotations for undo
 */
function pushHistory() {
    const snap = JSON.stringify(AnnotationState.annotations);
    // Only push if different from last
    if (AnnotationState.historyStack.length > 0 && AnnotationState.historyStack[AnnotationState.historyStack.length - 1] === snap) return;

    AnnotationState.historyStack.push(snap);
    if (AnnotationState.historyStack.length > 50) AnnotationState.historyStack.shift();
    AnnotationState.redoStack = []; // Clear redo on new action
    updateUndoRedoUI();
}

// ─── 2. Data Models ───────────────────────────────────────────────────────────

class AnnotationNode {
    constructor(type, x, y, options = {}) {
        this.id = 'annot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        this.type = type;
        this.x = x;
        this.y = y;
        this.color = options.color || AnnotationState.currentStrokeColor;
        this.fillColor = options.fillColor || AnnotationState.currentFillColor || 'transparent';
        this.strokeStyle = options.strokeStyle || AnnotationState.currentStrokeStyle || 'solid';
        this.thickness = options.thickness || AnnotationState.currentStrokeWidth;
        this.strokeOpacity = options.strokeOpacity !== undefined ? options.strokeOpacity : AnnotationState.currentStrokeOpacity;
        this.fillOpacity = options.fillOpacity !== undefined ? options.fillOpacity : AnnotationState.currentFillOpacity;
        this.blendMode = options.blendMode || 'source-over';
        this.rotation = options.rotation || 0;
    }
}

class VectorPath extends AnnotationNode {
    constructor(x, y, options = {}) {
        super('PATH', x, y, options);
        this.points = [{ x, y }];
        this.closed = false;
    }
    addPoint(x, y) { this.points.push({ x, y }); }
}

class TextNode extends AnnotationNode {
    constructor(x, y, text, options = {}) {
        super('TEXT', x, y, options);
        this.text = (text === undefined || text === null) ? '' : text;
        this.textColor = options.textColor || AnnotationState.currentTextColor;
        this.fontSize = options.fontSize || AnnotationState.currentFontSize;
        this.fontFamily = options.fontFamily || 'sans-serif';
        this.padding = 5;
    }
}

class ShapeNode extends AnnotationNode {
    constructor(shapeType, x, y, options = {}) {
        super('SHAPE', x, y, options);
        this.shapeType = shapeType;
        this.endX = x;
        this.endY = y;
    }
    updateEndPoint(endX, endY) { this.endX = endX; this.endY = endY; }
}

class PolylineNode extends AnnotationNode {
    constructor(x, y, options = {}) {
        super('POLYLINE', x, y, options);
        this.points = [{ x, y }];
        this.closed = false;
    }
    addPoint(x, y) { this.points.push({ x, y }); }
    updateLastPoint(x, y) {
        if (this.points.length > 0) this.points[this.points.length - 1] = { x, y };
    }
}

// ─── 3. State Mutators ────────────────────────────────────────────────────────

function commitAnnotation(annotation) {
    pushHistory();
    AnnotationState.annotations.push(annotation);
    updateUndoRedoUI();
    renderAnnotations();
}

function annotUndo() {
    if (AnnotationState.historyStack.length > 0) {
        AnnotationState.redoStack.push(JSON.stringify(AnnotationState.annotations));
        AnnotationState.annotations = JSON.parse(AnnotationState.historyStack.pop());
        AnnotationState.selectedAnnotationId = null;
        updateUndoRedoUI();
        renderAnnotations();
    }
}

function annotRedo() {
    if (AnnotationState.redoStack.length > 0) {
        AnnotationState.historyStack.push(JSON.stringify(AnnotationState.annotations));
        AnnotationState.annotations = JSON.parse(AnnotationState.redoStack.pop());
        AnnotationState.selectedAnnotationId = null;
        updateUndoRedoUI();
        renderAnnotations();
    }
}

function annotClearAll() {
    if (confirm('Are you sure you want to clear all annotations?')) {
        pushHistory();
        AnnotationState.annotations = [];
        updateUndoRedoUI();
        renderAnnotations();
    }
}

function annotDeleteSelected() {
    if (AnnotationState.selectedAnnotationId) {
        const idx = AnnotationState.annotations.findIndex(a => a.id === AnnotationState.selectedAnnotationId);
        if (idx !== -1) {
            pushHistory();
            AnnotationState.annotations.splice(idx, 1);
            AnnotationState.selectedAnnotationId = null;
            updateUndoRedoUI();
            renderAnnotations();
        }
    }
}

function annotExport() {
    // Commit any active text edit
    const textEditor = document.getElementById('annot-text-editor');
    if (textEditor) textEditor.blur();

    // Deactivate tools which also finalizes uncommitted shapes
    setActiveTool('POINTER');
    AnnotationState.selectedAnnotationId = null;
    renderAnnotations();

    // "Done" button acts as save
    saveCurrentPageAnnotations();

    if (window.toggleAnnotationMode) window.toggleAnnotationMode(false);
}

// ─── 4. Getters ───────────────────────────────────────────────────────────────

function getActiveAnnotations() {
    return AnnotationState.annotations;
}

// ─── 5. UI Updating ───────────────────────────────────────────────────────────

function setActiveTool(tool) {
    // Abort any in-progress drawing when switching tools
    if (currentAnnotation && tool !== 'SHAPES') {
        if (currentAnnotation.type === 'POLYLINE') {
            if (currentAnnotation.points.length > 2) {
                currentAnnotation.points.pop(); // remove floating point
                commitAnnotation(currentAnnotation);
            }
        }
        currentAnnotation = null;
        isDrawing = false;
    }

    AnnotationState.currentActiveTool = ActiveTool[tool];
    AnnotationState.selectedAnnotationId = null;
    currentAnnotation = null;
    isDrawing = false;
    renderAnnotations();

    // Sync opacity for special tools
    if (tool === 'HIGHLIGHTER') {
        AnnotationState.currentStrokeOpacity = 40;
        const sl = document.getElementById('annot-stroke-opacity-slider');
        if (sl) sl.value = 40;
    } else if (tool === 'PEN' && AnnotationState.currentStrokeOpacity < 100) {
        AnnotationState.currentStrokeOpacity = 100;
        const sl = document.getElementById('annot-stroke-opacity-slider');
        if (sl) sl.value = 100;
    }

    updateToolbarUI();
    updateViewerCursorForAnnotation();
}

function updateViewerCursorForAnnotation() {
    // Tell logic.js to update the viewport cursor
    if (typeof updateViewerCursor === 'function') {
        updateViewerCursor();
    }
    // Directly update cursor on the viewport element
    const vp = document.getElementById('viewer-viewport');
    if (!vp) return;
    if (AnnotationState.currentActiveTool !== 'POINTER') {
        vp.style.cursor = 'crosshair';
    } else {
        vp.style.cursor = 'grab';
    }
}

function setEraserMode(mode) {
    AnnotationState.currentEraserMode = mode;
    setActiveTool('ERASER');
    const flyout = document.getElementById('annot-eraser-flyout');
    if (flyout) flyout.classList.add('hidden');
}

function setShapeType(shape) {
    if (currentAnnotation && (currentAnnotation.type === 'SHAPE' || currentAnnotation.type === 'POLYLINE')) {
        currentAnnotation = null;
        isDrawing = false;
        renderAnnotations();
    }
    AnnotationState.currentShapeType = shape;
    setActiveTool('SHAPES');
    const flyout = document.getElementById('annot-shapes-flyout');
    if (flyout) flyout.classList.add('hidden');
}

function setTextType(type) {
    AnnotationState.currentTextType = type;
    setActiveTool(type);
    const flyout = document.getElementById('annot-text-flyout');
    if (flyout) flyout.classList.add('hidden');
}

function setAnnotColor(colorHex) {
    AnnotationState.currentStrokeColor = colorHex;
    if (colorHex !== 'transparent') {
        AnnotationState.currentTextColor = colorHex;
    }
    const picker = document.getElementById('annot-color-picker');
    if (picker && colorHex !== 'transparent' && picker.value !== colorHex) picker.value = colorHex;

    const btn = document.getElementById('annot-current-color-btn');
    if (btn) {
        btn.style.backgroundColor = colorHex === 'transparent' ? 'white' : colorHex;
        const line = document.getElementById('annot-stroke-none-line');
        if (line) line.style.display = colorHex === 'transparent' ? 'block' : 'none';
    }

    if (AnnotationState.selectedAnnotationId) {
        const annot = AnnotationState.annotations.find(a => a.id === AnnotationState.selectedAnnotationId);
        if (annot) {
            annot.color = colorHex;
            if (annot.type === 'TEXT' && colorHex !== 'transparent') {
                annot.textColor = colorHex;
            }
            renderAnnotations();
        }
    }
}

function setAnnotFillColor(colorHex) {
    const flyout = document.getElementById('annot-fill-color-flyout');
    if (flyout) flyout.classList.add('hidden');

    AnnotationState.currentFillColor = colorHex;
    const picker = document.getElementById('annot-fill-picker');
    if (picker && colorHex !== 'transparent' && picker.value !== colorHex) picker.value = colorHex;

    const btn = document.getElementById('annot-current-fill-btn');
    if (btn) {
        btn.style.backgroundColor = colorHex === 'transparent' ? 'white' : colorHex;
        const line = document.getElementById('annot-fill-none-line');
        if (line) line.style.display = colorHex === 'transparent' ? 'block' : 'none';
    }

    if (AnnotationState.selectedAnnotationId) {
        const annot = AnnotationState.annotations.find(a => a.id === AnnotationState.selectedAnnotationId);
        if (annot) { annot.fillColor = colorHex; renderAnnotations(); }
    }
}

function setAnnotStrokeStyle(style) {
    AnnotationState.currentStrokeStyle = style;

    document.querySelectorAll('.annot-style-btn').forEach(btn => {
        btn.classList.remove('bg-[var(--border)]');
        if (btn.getAttribute('onclick').includes(`'${style}'`)) {
            btn.classList.add('bg-[var(--border)]');
        }
    });

    if (AnnotationState.selectedAnnotationId) {
        const annot = AnnotationState.annotations.find(a => a.id === AnnotationState.selectedAnnotationId);
        if (annot) { annot.strokeStyle = style; renderAnnotations(); }
    }
}

function setAnnotStroke(thickness) {
    AnnotationState.currentStrokeWidth = thickness;

    document.querySelectorAll('.annot-stroke-btn').forEach(btn => {
        btn.classList.remove('bg-[var(--border)]');
        const oc = btn.getAttribute('onclick') || '';
        if (oc.includes(String(thickness))) {
            btn.classList.add('bg-[var(--border)]');
        }
    });

    if (AnnotationState.selectedAnnotationId) {
        const annot = AnnotationState.annotations.find(a => a.id === AnnotationState.selectedAnnotationId);
        if (annot) { annot.thickness = thickness; renderAnnotations(); }
    }
}

function setAnnotStrokeOpacity(opacityVal) {
    const val = parseInt(opacityVal, 10);
    AnnotationState.currentStrokeOpacity = val;

    if (AnnotationState.selectedAnnotationId) {
        const annot = AnnotationState.annotations.find(a => a.id === AnnotationState.selectedAnnotationId);
        if (annot) { annot.strokeOpacity = val; renderAnnotations(); }
    }
}

function setAnnotFillOpacity(opacityVal) {
    const val = parseInt(opacityVal, 10);
    AnnotationState.currentFillOpacity = val;

    if (AnnotationState.selectedAnnotationId) {
        const annot = AnnotationState.annotations.find(a => a.id === AnnotationState.selectedAnnotationId);
        if (annot) { annot.fillOpacity = val; renderAnnotations(); }
    }
}

/** NEW: Intuitive font size control for text annotations */
function setAnnotFontSize(size) {
    const val = parseInt(size, 10);
    AnnotationState.currentFontSize = val;
    // Sync label
    const lbl = document.getElementById('annot-font-size-label');
    if (lbl) lbl.textContent = val + 'px';

    if (AnnotationState.selectedAnnotationId) {
        const annot = AnnotationState.annotations.find(a => a.id === AnnotationState.selectedAnnotationId);
        if (annot && annot.type === 'TEXT') {
            annot.fontSize = val;
            renderAnnotations();
        }
    }
}

function updatePropertyUIFromAnnotation(annot) {
    if (annot.color) {
        AnnotationState.currentStrokeColor = annot.color;
        if (annot.type === 'TEXT' && annot.textColor) {
            AnnotationState.currentTextColor = annot.textColor;
        } else if (annot.color !== 'transparent') {
            AnnotationState.currentTextColor = annot.color;
        }

        const picker = document.getElementById('annot-color-picker');
        const displayColor = annot.color === 'transparent' ? AnnotationState.currentTextColor : annot.color;
        if (picker && displayColor !== 'transparent' && picker.value !== displayColor) picker.value = displayColor;

        const btn = document.getElementById('annot-current-color-btn');
        if (btn) {
            btn.style.backgroundColor = annot.color === 'transparent' ? 'white' : annot.color;
            const line = document.getElementById('annot-stroke-none-line');
            if (line) line.style.display = annot.color === 'transparent' ? 'block' : 'none';
        }
    }
    if (annot.fillColor) {
        AnnotationState.currentFillColor = annot.fillColor;
        const picker = document.getElementById('annot-fill-picker');
        if (picker && annot.fillColor !== 'transparent' && picker.value !== annot.fillColor) picker.value = annot.fillColor;
        const btn = document.getElementById('annot-current-fill-btn');
        if (btn) {
            btn.style.backgroundColor = annot.fillColor === 'transparent' ? 'white' : annot.fillColor;
            const line = document.getElementById('annot-fill-none-line');
            if (line) line.style.display = annot.fillColor === 'transparent' ? 'block' : 'none';
        }
    }
    if (annot.strokeStyle) {
        AnnotationState.currentStrokeStyle = annot.strokeStyle;
        document.querySelectorAll('.annot-style-btn').forEach(btn => {
            btn.classList.remove('bg-[var(--border)]');
            if (btn.getAttribute('onclick').includes(`'${annot.strokeStyle}'`)) {
                btn.classList.add('bg-[var(--border)]');
            }
        });
    }
    if (annot.thickness) {
        AnnotationState.currentStrokeWidth = annot.thickness;
        document.querySelectorAll('.annot-stroke-btn').forEach(btn => {
            btn.classList.remove('bg-[var(--border)]');
            if (btn.getAttribute('onclick').includes(`(${annot.thickness})`)) {
                btn.classList.add('bg-[var(--border)]');
            }
        });
    }
    if (annot.strokeOpacity !== undefined || annot.opacity !== undefined) {
        AnnotationState.currentStrokeOpacity = annot.strokeOpacity !== undefined ? annot.strokeOpacity : annot.opacity;
        const sl = document.getElementById('annot-stroke-opacity-slider');
        if (sl) sl.value = AnnotationState.currentStrokeOpacity;
    }
    if (annot.fillOpacity !== undefined || annot.opacity !== undefined) {
        AnnotationState.currentFillOpacity = annot.fillOpacity !== undefined ? annot.fillOpacity : annot.opacity;
        const sl = document.getElementById('annot-fill-opacity-slider');
        if (sl) sl.value = AnnotationState.currentFillOpacity;
    }
    if (annot.fontSize) {
        AnnotationState.currentFontSize = annot.fontSize;
        const sl = document.getElementById('annot-font-size-slider');
        const lb = document.getElementById('annot-font-size-label');
        if (sl) sl.value = annot.fontSize;
        if (lb) lb.textContent = annot.fontSize + 'px';
    }
}

function updateToolbarUI() {
    const tools = ['pointer', 'pen', 'highlighter', 'eraser', 'shapes'];
    tools.forEach(tool => {
        const btn = document.getElementById(`tool-${tool}`);
        if (!btn) return;
        if (AnnotationState.currentActiveTool.toLowerCase() === tool) {
            btn.classList.add('bg-[var(--hover-bg)]', 'text-[var(--accent)]');
            btn.classList.remove('text-[var(--text-sub)]');
        } else {
            btn.classList.remove('bg-[var(--hover-bg)]', 'text-[var(--accent)]');
            btn.classList.add('text-[var(--text-sub)]');
        }
    });

    const isTextTool = ['TEXT', 'TEXT_CALLOUT'].includes(AnnotationState.currentActiveTool);
    const btnText = document.getElementById('tool-text');
    if (btnText) {
        if (isTextTool) {
            btnText.classList.add('bg-[var(--hover-bg)]', 'text-[var(--accent)]');
            btnText.classList.remove('text-[var(--text-sub)]');
        } else {
            btnText.classList.remove('bg-[var(--hover-bg)]', 'text-[var(--accent)]');
            btnText.classList.add('text-[var(--text-sub)]');
        }
    }

    const iconTextEl = document.querySelector('#tool-text i');
    if (iconTextEl) {
        if (AnnotationState.currentActiveTool === 'TEXT_CALLOUT') {
            iconTextEl.className = 'fas fa-comment-dots text-sm pointer-events-none';
        } else {
            iconTextEl.className = 'fas fa-font text-sm pointer-events-none';
        }
    }

    const iconShapeEl = document.querySelector('#tool-shapes i');
    if (iconShapeEl) {
        if (AnnotationState.currentActiveTool !== 'SHAPES') {
            iconShapeEl.className = 'fas fa-shapes text-sm pointer-events-none';
        } else {
            iconShapeEl.className = 'text-sm pointer-events-none';
            if (AnnotationState.currentShapeType === 'LINE') iconShapeEl.classList.add('fas', 'fa-slash');
            else if (AnnotationState.currentShapeType === 'ARROW') iconShapeEl.classList.add('fas', 'fa-arrow-up', 'rotate-45');
            else if (AnnotationState.currentShapeType === 'POLYLINE') iconShapeEl.classList.add('fas', 'fa-draw-polygon');
            else if (AnnotationState.currentShapeType === 'RECTANGLE') iconShapeEl.classList.add('far', 'fa-square');
            else if (AnnotationState.currentShapeType === 'ELLIPSE') iconShapeEl.classList.add('far', 'fa-circle');
        }
    }

    // AnnotCanvas pointer-events: only capture if a drawing tool is active
    if (annotCanvas) {
        if (isAnnotationMode) {
            annotCanvas.style.pointerEvents = 'auto';
        } else {
            annotCanvas.style.pointerEvents = 'none';
        }
    }

    // Secondary properties panel visibility
    const secPanel = document.getElementById('annot-secondary-panel');
    if (secPanel) {
        const isPointerWithSelection = AnnotationState.currentActiveTool === 'POINTER' && AnnotationState.selectedAnnotationId;
        const dimmed = ['POINTER', 'ERASER'].includes(AnnotationState.currentActiveTool) && !isPointerWithSelection;
        secPanel.style.opacity = dimmed ? '0.3' : '1';
        secPanel.style.pointerEvents = dimmed ? 'none' : 'auto';
    }

    // Show/hide font size control vs stroke size control based on active tool
    const fontSizeGroup = document.getElementById('annot-font-size-group');
    const fontDivider = document.getElementById('annot-font-size-divider');
    const strokeGroup = document.getElementById('annot-strokes');
    const styleGroup = document.getElementById('annot-stroke-styles-container');
    if (fontSizeGroup && strokeGroup) {
        if (AnnotationState.currentActiveTool === 'TEXT') {
            fontSizeGroup.classList.remove('hidden');
            if (fontDivider) fontDivider.classList.remove('hidden');
        } else {
            fontSizeGroup.classList.add('hidden');
            if (fontDivider) fontDivider.classList.add('hidden');
        }
        if (strokeGroup) strokeGroup.classList.remove('hidden');
        if (styleGroup) styleGroup.classList.remove('hidden');
    }
}

function updateUndoRedoUI() {
    const u = document.getElementById('btn-annot-undo');
    const r = document.getElementById('btn-annot-redo');
    if (u) u.disabled = (AnnotationState.historyStack.length === 0);
    if (r) r.disabled = (AnnotationState.redoStack.length === 0);
}

// ─── 6. Color Helper ──────────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
    if (!hex) return `rgba(0,0,0,${alpha})`;
    if (hex === 'transparent') return 'transparent';
    let r = 0, g = 0, b = 0;
    if (hex.startsWith('#')) {
        const c = hex.substring(1);
        if (c.length === 3) { r = parseInt(c[0] + c[0], 16); g = parseInt(c[1] + c[1], 16); b = parseInt(c[2] + c[2], 16); }
        else if (c.length === 6) { r = parseInt(c.substring(0, 2), 16); g = parseInt(c.substring(2, 4), 16); b = parseInt(c.substring(4, 6), 16); }
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── 6. Rendering ─────────────────────────────────────────────────────────────

function renderAnnotations() {
    if (!annotCtx || !annotCanvas) return;
    const active = getActiveAnnotations();

    annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);

    // s = PDF points → canvas pixels.
    // canvas.width is set to cssViewport.width = unscaledPageW * viewerScale,
    // so s = viewerScale = pdfRenderState.scale.
    // We use pdfRenderState.scale directly — it's always correct and avoids
    // any instability from computing annotCanvas.width / unscaledW.
    const s = pdfRenderState.scale || 1.0;
    const rot = (pdfRenderState.rotation || 0) % 360;

    // Build the page→canvas matrix once, outside the per-annotation loop,
    // to keep the per-annotation work minimal and consistent.
    // For 0°: just scale(s,s). PDF origin (0,0) IS canvas origin (0,0).
    // For rotations: orthogonal flip so the rotated page fills the canvas.
    active.forEach(annot => {
        annotCtx.save();

        if (rot === 0) {
            annotCtx.scale(s, s);
        } else if (rot === 90) {
            // 90° CW: Original Top-Left (0,0) becomes Top-Right (W,0)
            annotCtx.translate(annotCanvas.width, 0);
            annotCtx.rotate(Math.PI / 2);
            annotCtx.scale(s, s);
        } else if (rot === 180) {
            // 180° CW: Original Top-Left (0,0) becomes Bottom-Right (W,H)
            annotCtx.translate(annotCanvas.width, annotCanvas.height);
            annotCtx.rotate(Math.PI);
            annotCtx.scale(s, s);
        } else if (rot === 270) {
            // 270° CW (90° CCW): Original Top-Left (0,0) becomes Bottom-Left (0,H)
            annotCtx.translate(0, annotCanvas.height);
            annotCtx.rotate(-Math.PI / 2);
            annotCtx.scale(s, s);
        }

        if (annot.blendMode === 'multiply') {
            annotCtx.globalCompositeOperation = 'multiply';
        } else if (annot.blendMode === 'destination-out') {
            annotCtx.globalCompositeOperation = 'destination-out';
        } else {
            annotCtx.globalCompositeOperation = 'source-over';
        }

        annotCtx.lineWidth = annot.thickness || 2;
        annotCtx.lineCap = 'round';
        annotCtx.lineJoin = 'round';
        annotCtx.globalAlpha = 1.0;

        if (annot.strokeStyle === 'dashed') {
            annotCtx.setLineDash([annot.thickness * 3, annot.thickness * 3]);
        } else if (annot.strokeStyle === 'dotted') {
            annotCtx.setLineDash([annot.thickness, annot.thickness * 2]);
        } else {
            annotCtx.setLineDash([]);
        }

        drawAnnotation(annotCtx, annot);

        if (AnnotationState.selectedAnnotationId === annot.id) {
            drawSelectionBox(annotCtx, annot, s);
        }

        annotCtx.restore();
    });
}

function drawAnnotation(ctx, annot) {
    const sOpacity = (annot.strokeOpacity !== undefined ? annot.strokeOpacity : (annot.opacity || 100)) / 100;
    const fOpacity = (annot.fillOpacity !== undefined ? annot.fillOpacity : (annot.opacity || 100)) / 100;

    if (annot.type === 'PATH' && annot.points && annot.points.length > 0) {
        ctx.strokeStyle = hexToRgba(annot.color, sOpacity);
        ctx.beginPath();
        ctx.moveTo(annot.points[0].x, annot.points[0].y);
        for (let i = 1; i < annot.points.length; i++) {
            ctx.lineTo(annot.points[i].x, annot.points[i].y);
        }
        if (annot.closed) {
            ctx.closePath();
            if (annot.fillColor && annot.fillColor !== 'transparent') {
                ctx.fillStyle = hexToRgba(annot.fillColor, fOpacity);
                ctx.fill();
            }
        }
        if (annot.strokeStyle !== 'none') ctx.stroke();

    } else if (annot.type === 'POLYLINE' && annot.points && annot.points.length > 0) {
        ctx.strokeStyle = hexToRgba(annot.color, sOpacity);
        ctx.beginPath();
        ctx.moveTo(annot.points[0].x, annot.points[0].y);
        for (let i = 1; i < annot.points.length; i++) {
            ctx.lineTo(annot.points[i].x, annot.points[i].y);
        }
        if (annot.closed) {
            ctx.closePath();
            if (annot.fillColor && annot.fillColor !== 'transparent') {
                ctx.fillStyle = hexToRgba(annot.fillColor, fOpacity);
                ctx.fill();
            }
        }
        if (annot.strokeStyle !== 'none') ctx.stroke();

    } else if (annot.type === 'TEXT') {
        ctx.save();
        ctx.translate(annot.x, annot.y);
        if (annot.rotation) {
            ctx.rotate((annot.rotation * Math.PI) / 180);
        }
        ctx.textBaseline = 'top';
        ctx.font = `${annot.fontSize}px ${annot.fontFamily}`;
        const padding = (annot.padding || 5);
        const lines = (annot.text || ' ').split('\n');
        const textHeight = annot.fontSize;
        let textWidth = 0;
        lines.forEach(line => {
            const metrics = ctx.measureText(line);
            if (metrics.width > textWidth) textWidth = metrics.width;
        });

        if (annot.leaderHead && annot.leaderElbow) {
            const minX = -padding;
            const maxX = textWidth + padding;
            const minY = -padding;
            const maxY = textHeight * lines.length + padding;

            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;

            let headX = annot.leaderHead.x - annot.x;
            let headY = annot.leaderHead.y - annot.y;
            let elbowX = annot.leaderElbow.x - annot.x;
            let elbowY = annot.leaderElbow.y - annot.y;

            if (annot.rotation) {
                const rad = (-annot.rotation * Math.PI) / 180;

                const rxHead = headX * Math.cos(rad) - headY * Math.sin(rad);
                const ryHead = headX * Math.sin(rad) + headY * Math.cos(rad);
                headX = rxHead; headY = ryHead;

                const rxElbow = elbowX * Math.cos(rad) - elbowY * Math.sin(rad);
                const ryElbow = elbowX * Math.sin(rad) + elbowY * Math.cos(rad);
                elbowX = rxElbow; elbowY = ryElbow;
            }

            let intersectX = cx;
            let intersectY = cy;

            const dx = cx - elbowX;
            const dy = cy - elbowY;

            if (dx !== 0 || dy !== 0) {
                let tX = -Infinity, tY = -Infinity;
                if (dx > 0) tX = (minX - elbowX) / dx;
                else if (dx < 0) tX = (maxX - elbowX) / dx;

                if (dy > 0) tY = (minY - elbowY) / dy;
                else if (dy < 0) tY = (maxY - elbowY) / dy;

                const t = Math.max(0, Math.min(1, Math.max(tX, tY)));
                intersectX = elbowX + t * dx;
                intersectY = elbowY + t * dy;
            }

            ctx.save();
            ctx.strokeStyle = hexToRgba(annot.color, sOpacity);
            ctx.lineWidth = annot.thickness;
            if (annot.strokeStyle === 'dashed') ctx.setLineDash([annot.thickness * 3, annot.thickness * 3]);
            else if (annot.strokeStyle === 'dotted') ctx.setLineDash([annot.thickness, annot.thickness * 2]);
            else ctx.setLineDash([]);

            ctx.beginPath();
            ctx.moveTo(intersectX, intersectY);
            ctx.lineTo(elbowX, elbowY);
            ctx.lineTo(headX, headY);
            if (annot.strokeStyle !== 'none') ctx.stroke();

            const angle = Math.atan2(headY - elbowY, headX - elbowX);
            const headlen = 12;

            ctx.save();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(headX, headY);
            ctx.lineTo(headX - headlen * Math.cos(angle - Math.PI / 6), headY - headlen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(headX, headY);
            ctx.lineTo(headX - headlen * Math.cos(angle + Math.PI / 6), headY - headlen * Math.sin(angle + Math.PI / 6));
            if (annot.strokeStyle !== 'none') ctx.stroke();
            ctx.restore();
            ctx.restore();
        }

        if (annot.fillColor && annot.fillColor !== 'transparent') {
            ctx.fillStyle = hexToRgba(annot.fillColor, fOpacity);
            ctx.fillRect(-padding, -padding, textWidth + padding * 2, textHeight * lines.length + padding * 2);
        }
        if (annot.color && annot.thickness > 0 && annot.strokeStyle !== 'none') {
            ctx.strokeStyle = hexToRgba(annot.color, sOpacity);
            ctx.lineWidth = annot.thickness;
            if (annot.strokeStyle === 'dashed') ctx.setLineDash([annot.thickness * 3, annot.thickness * 3]);
            else if (annot.strokeStyle === 'dotted') ctx.setLineDash([annot.thickness, annot.thickness * 2]);
            else ctx.setLineDash([]);
            ctx.strokeRect(-padding, -padding, textWidth + padding * 2, textHeight * lines.length + padding * 2);
            ctx.setLineDash([]);
        }

        if (annot.text && !annot._isEditing) {
            let tColor = annot.textColor || (annot.color === 'transparent' ? '#000000' : annot.color);
            ctx.fillStyle = hexToRgba(tColor, sOpacity);
            lines.forEach((line, i) => {
                ctx.fillText(line, 0, i * textHeight);
            });
        }

        // Store unscaled dims for hit testing
        annot._width = textWidth;
        annot._height = textHeight * lines.length;
        ctx.restore();

    } else if (annot.type === 'SHAPE') {
        drawShape(ctx, annot, sOpacity, fOpacity);
    }
}

function drawShape(ctx, ann, sOpacity, fOpacity) {
    ctx.strokeStyle = hexToRgba(ann.color, sOpacity);
    const hasStroke = ann.strokeStyle !== 'none';
    if (ann.shapeType === 'LINE') {
        if (hasStroke) {
            ctx.beginPath();
            ctx.moveTo(ann.x, ann.y);
            ctx.lineTo(ann.endX, ann.endY);
            ctx.stroke();
        }
    } else if (ann.shapeType === 'RECTANGLE') {
        if (ann.fillColor && ann.fillColor !== 'transparent') {
            ctx.fillStyle = hexToRgba(ann.fillColor, fOpacity);
            ctx.fillRect(ann.x, ann.y, ann.endX - ann.x, ann.endY - ann.y);
        }
        if (hasStroke) {
            ctx.strokeRect(ann.x, ann.y, ann.endX - ann.x, ann.endY - ann.y);
        }
    } else if (ann.shapeType === 'ELLIPSE') {
        const cx = ann.x + (ann.endX - ann.x) / 2;
        const cy = ann.y + (ann.endY - ann.y) / 2;
        const rx = Math.abs(ann.endX - ann.x) / 2;
        const ry = Math.abs(ann.endY - ann.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, 2 * Math.PI);
        if (ann.fillColor && ann.fillColor !== 'transparent') {
            ctx.fillStyle = hexToRgba(ann.fillColor, fOpacity);
            ctx.fill();
        }
        if (hasStroke) ctx.stroke();
    } else if (ann.shapeType === 'ARROW') {
        if (hasStroke) {
            const headlen = 12;
            const dx = ann.endX - ann.x;
            const dy = ann.endY - ann.y;
            const angle = Math.atan2(dy, dx);
            ctx.beginPath();
            ctx.moveTo(ann.x, ann.y);
            ctx.lineTo(ann.endX, ann.endY);
            ctx.stroke();

            ctx.save();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(ann.endX, ann.endY);
            ctx.lineTo(ann.endX - headlen * Math.cos(angle - Math.PI / 6),
                ann.endY - headlen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(ann.endX, ann.endY);
            ctx.lineTo(ann.endX - headlen * Math.cos(angle + Math.PI / 6),
                ann.endY - headlen * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
            ctx.restore();
        }
    }
}

function drawSelectionBox(ctx, annot, s) {
    ctx.save();
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 1 / s;
    ctx.setLineDash([5 / s, 3 / s]);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    const hs = 8 / s, half = hs / 2;

    if (annot.type === 'SHAPE' && (annot.shapeType === 'LINE' || annot.shapeType === 'ARROW')) {
        ctx.fillStyle = '#FFFFFF';
        ctx.setLineDash([]);
        const corners = [
            { x: annot.x, y: annot.y },
            { x: annot.endX, y: annot.endY }
        ];
        corners.forEach(c => { ctx.fillRect(c.x - half, c.y - half, hs, hs); ctx.strokeRect(c.x - half, c.y - half, hs, hs); });
        ctx.restore();
        return;
    }

    if (annot.type === 'POLYLINE' || annot.type === 'PATH') {
        ctx.setLineDash([5 / s, 3 / s]);
        let selRect = getAnnotBounds(annot);
        if (selRect) {
            const bx = selRect.x - 5 / s, by = selRect.y - 5 / s;
            const bw = selRect.w + 10 / s, bh = selRect.h + 10 / s;
            ctx.strokeRect(bx, by, bw, bh);
        }
        if (annot.type === 'POLYLINE' && annot.points) {
            ctx.fillStyle = '#FFFFFF';
            ctx.setLineDash([]);
            annot.points.forEach(p => {
                ctx.fillRect(p.x - half, p.y - half, hs, hs);
                ctx.strokeRect(p.x - half, p.y - half, hs, hs);
            });
        }
        ctx.restore();
        return;
    }

    if (annot.rotation) {
        ctx.translate(annot.x, annot.y);
        ctx.rotate((annot.rotation * Math.PI) / 180);
        ctx.translate(-annot.x, -annot.y);
    }

    let selRect = getAnnotBounds(annot);
    if (!selRect) { ctx.restore(); return; }

    const bx = selRect.x - 5 / s, by = selRect.y - 5 / s;
    const bw = selRect.w + 10 / s, bh = selRect.h + 10 / s;
    ctx.strokeRect(bx, by, bw, bh);

    // Corner handles (for all types, for move affordance)
    const corners = [
        { x: bx - half, y: by - half },
        { x: bx + bw - half, y: by - half },
        { x: bx + bw - half, y: by + bh - half },
        { x: bx - half, y: by + bh - half }
    ];
    ctx.setLineDash([]);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 1 / s;
    corners.forEach(c => { ctx.fillRect(c.x, c.y, hs, hs); ctx.strokeRect(c.x, c.y, hs, hs); });

    ctx.restore();

    if (annot.type === 'TEXT' && annot.leaderHead && annot.leaderElbow) {
        ctx.save();
        ctx.fillStyle = '#EF4444';
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1 / s;
        ctx.fillRect(annot.leaderHead.x - half, annot.leaderHead.y - half, hs, hs);
        ctx.strokeRect(annot.leaderHead.x - half, annot.leaderHead.y - half, hs, hs);

        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(annot.leaderElbow.x - half, annot.leaderElbow.y - half, hs, hs);
        ctx.strokeRect(annot.leaderElbow.x - half, annot.leaderElbow.y - half, hs, hs);
        ctx.restore();
    }
}

function getAnnotBounds(annot) {
    if (annot.type === 'TEXT') {
        const p = (annot.padding || 5);
        const w = (annot._width || 80);
        const h = (annot._height || annot.fontSize);
        return { x: annot.x - p, y: annot.y - p, w: w + p * 2, h: h + p * 2 };
    } else if (annot.type === 'SHAPE') {
        const minX = Math.min(annot.x, annot.endX);
        const maxX = Math.max(annot.x, annot.endX);
        const minY = Math.min(annot.y, annot.endY);
        const maxY = Math.max(annot.y, annot.endY);
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    } else if ((annot.type === 'PATH' || annot.type === 'POLYLINE') && annot.points && annot.points.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of annot.points) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    return null;
}

// ─── 7. Canvas Lifecycle ──────────────────────────────────────────────────────

let annotCanvas = null;
let annotCtx = null;
let isDrawing = false;
let isDraggingSelection = false;
let isResizing = false;
let resizeHandle = null;
let originalResizeBounds = null;
let currentAnnotation = null;
let dragOffset = { x: 0, y: 0 };
let _canvasListenersAttached = false; // Guard against duplicate listeners
let lastLoadedPageId = null;

let pdfRenderState = { width: 0, height: 0, scale: 1, rotation: 0 };

// Listen to logic.js viewer changes (zoom, page switch, open)
window.addEventListener('viewerRendered', (e) => {
    const data = e.detail;
    pdfRenderState.width = data.width;
    pdfRenderState.height = data.height;
    pdfRenderState.scale = data.scale;
    pdfRenderState.rotation = data.rotation;
    pdfRenderState.pageId = data.pageId;
    pdfRenderState.unscaledW = data.unscaledW;
    pdfRenderState.unscaledH = data.unscaledH;

    initAnnotCanvas();
});

// Reset annotations when viewer is closed
window.addEventListener('viewerClosed', () => {
    // Clear canvas
    if (annotCtx && annotCanvas) {
        annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    }
    AnnotationState.annotations = [];
    AnnotationState.historyStack = [];
    AnnotationState.redoStack = [];
    AnnotationState.selectedAnnotationId = null;
    currentAnnotation = null;
    isDrawing = false;
    isDraggingSelection = false;
    isResizing = false;
    lastLoadedPageId = null;
    pdfRenderState.pageId = null;
    AnnotationState.initialSnapshot = null;
    if (window.toggleAnnotationMode) window.toggleAnnotationMode(false);
    updateUndoRedoUI();
});

// Listen for page changes so we can clear/save per-page annotations
window.addEventListener('viewerPageChanged', () => {
    AnnotationState.annotations = [];
    AnnotationState.historyStack = [];
    AnnotationState.redoStack = [];
    AnnotationState.selectedAnnotationId = null;
    currentAnnotation = null;
    isDrawing = false;
    lastLoadedPageId = null;
    pdfRenderState.pageId = null;
    AnnotationState.initialSnapshot = null;
    updateUndoRedoUI();
    if (window.toggleAnnotationMode) window.toggleAnnotationMode(false);
    if (annotCtx && annotCanvas) annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
});

function initAnnotCanvas() {
    annotCanvas = document.getElementById('annot-canvas');
    if (!annotCanvas) return;

    // Calculate a safe render scale to prevent canvas allocation crash
    const MAX_CANVAS_DIM = 16384;
    let safeWidth = pdfRenderState.width;
    let safeHeight = pdfRenderState.height;

    if (safeWidth > MAX_CANVAS_DIM || safeHeight > MAX_CANVAS_DIM) {
        const reduction = Math.min(MAX_CANVAS_DIM / safeWidth, MAX_CANVAS_DIM / safeHeight);
        safeWidth *= reduction;
        safeHeight *= reduction;
    }

    // Set canvas internal bitmap size to exact integer pixels
    const w = Math.round(safeWidth);
    const h = Math.round(safeHeight);
    annotCanvas.width = w;
    annotCanvas.height = h;

    // CRITICAL FIX: Set CSS size to the SAME integer pixel values instead of '100%'.
    // Using '100%' caused the browser to CSS-stretch the canvas bitmap to the wrapper,
    // introducing non-uniform distortion whenever wrapper dimensions (float CSS px)
    // didn't match the canvas bitmap size (integer px). With fixed px values,
    // there is zero CSS stretching: 1 canvas pixel = 1 CSS pixel.
    annotCanvas.style.width = w + 'px';
    annotCanvas.style.height = h + 'px';
    annotCanvas.style.position = 'absolute';
    annotCanvas.style.top = '0';
    annotCanvas.style.left = '0';

    annotCtx = annotCanvas.getContext('2d');

    // Load any existing annotations for this page (skip if just zooming)
    if (pdfRenderState.pageId && pdfRenderState.pageId !== lastLoadedPageId) {
        loadAnnotations(pdfRenderState.pageId);
        lastLoadedPageId = pdfRenderState.pageId;
    }

    // Only attach event listeners ONCE to avoid accumulation
    if (!_canvasListenersAttached) {
        _canvasListenersAttached = true;

        annotCanvas.addEventListener('dblclick', handleDoubleClick);
        annotCanvas.addEventListener('pointerdown', handlePointerDown);
        annotCanvas.addEventListener('pointermove', handlePointerMove);
        annotCanvas.addEventListener('pointerup', handlePointerUp);
        annotCanvas.addEventListener('pointercancel', handlePointerUp);

        // Suppress context menu on canvas only during polyline/shape drawing
        annotCanvas.addEventListener('contextmenu', (e) => {
            if (AnnotationState.currentActiveTool === 'SHAPES') {
                if (AnnotationState.currentShapeType === 'POLYLINE' && currentAnnotation && currentAnnotation.type === 'POLYLINE') {
                    e.preventDefault();
                    e.stopPropagation();
                    // Finish polyline on right click
                    finishPolyline();
                } else if (currentAnnotation && currentAnnotation.type === 'SHAPE') {
                    e.preventDefault();
                    e.stopPropagation();
                    // Cancel shape drawing on right click
                    currentAnnotation = null;
                    isDrawing = false;
                    renderAnnotations();
                }
            } else if (AnnotationState.currentActiveTool === 'TEXT_CALLOUT') {
                if (currentAnnotation && currentAnnotation.type === 'TEXT') {
                    e.preventDefault();
                    e.stopPropagation();
                    currentAnnotation = null;
                    isDrawing = false;
                    renderAnnotations();
                }
            }
        });
    }

    renderAnnotations();
}

// ─── 8. Coordinate Mapping ────────────────────────────────────────────────────

function mapPointToUnrotated(cx, cy, rot, rotW, rotH) {
    if (rot === 0) return { x: cx, y: cy };
    if (rot === 90) {
        // cx = rotW - py, cy = px  => px = cy, py = rotW - cx
        return { x: cy, y: rotW - cx };
    }
    if (rot === 180) {
        // cx = rotW - px, cy = rotH - py => px = rotW - cx, py = rotH - cy
        return { x: rotW - cx, y: rotH - cy };
    }
    if (rot === 270) {
        // cx = py, cy = rotH - px => px = rotH - cy, py = cx
        return { x: rotH - cy, y: cx };
    }
    return { x: cx, y: cy };
}

function mapPointFromUnrotated(px, py, rot, rotW, rotH) {
    if (rot === 0) return { x: px, y: py };
    if (rot === 90) {
        // Rotate 90 CW: (x,y) -> (rotW - y, x)
        return { x: rotW - py, y: px };
    }
    if (rot === 180) {
        // Rotate 180 CW: (x,y) -> (rotW - x, rotH - y)
        return { x: rotW - px, y: rotH - py };
    }
    if (rot === 270) {
        // Rotate 270 CW: (x,y) -> (y, rotH - x)
        return { x: py, y: rotH - px };
    }
    return { x: px, y: py };
}

function snapTo45(startX, startY, endX, endY) {
    const angle = Math.atan2(endY - startY, endX - startX);
    const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const dist = Math.hypot(endX - startX, endY - startY);
    return {
        x: startX + Math.cos(snappedAngle) * dist,
        y: startY + Math.sin(snappedAngle) * dist
    };
}

/**
 * Convert pointer event screen coordinates → UNROTATED unscaled PDF coordinates.
 */
function getPdfCoordinates(evt) {
    if (!annotCanvas) return { x: 0, y: 0 };
    const rect = annotCanvas.getBoundingClientRect();
    // Map screen pointer → canvas pixel → PDF point.
    // Mirror of the renderAnnotations transform.
    let cx = (evt.clientX - rect.left) * (annotCanvas.width / rect.width);
    let cy = (evt.clientY - rect.top) * (annotCanvas.height / rect.height);

    const s = pdfRenderState.scale || 1.0;
    const rot = (pdfRenderState.rotation || 0) % 360;

    // Invert the page→canvas orthogonal transform
    if (rot === 0) {
        return { x: cx / s, y: cy / s };
    } else if (rot === 90) {
        // 90° CW Inverse: cx = (uH-py)*s, cy = px*s
        return { x: cy / s, y: (annotCanvas.width - cx) / s };
    } else if (rot === 180) {
        // 180° CW Inverse: cx = (uW-px)*s, cy = (uH-py)*s
        return { x: (annotCanvas.width - cx) / s, y: (annotCanvas.height - cy) / s };
    } else { // 270
        // 270° CW Inverse: cx = py*s, cy = (uW-px)*s
        return { x: (annotCanvas.height - cy) / s, y: cx / s };
    }
}

// ─── 9. Hit Testing ───────────────────────────────────────────────────────────

function isPointInAnnotation(annot, x, y, tolerance) {
    if (annot.type === 'TEXT') {
        let lx = x - annot.x;
        let ly = y - annot.y;
        if (annot.rotation) {
            const rad = (-annot.rotation * Math.PI) / 180;
            const rx = lx * Math.cos(rad) - ly * Math.sin(rad);
            const ry = lx * Math.sin(rad) + ly * Math.cos(rad);
            lx = rx;
            ly = ry;
        }
        const w = annot._width || 100;
        const h = annot._height || 20;
        const p = (annot.padding || 5);
        if (lx >= -p && lx <= w + p && ly >= -p && ly <= h + p) return true;
    } else if (annot.type === 'SHAPE') {
        if (annot.shapeType === 'RECTANGLE') {
            const minX = Math.min(annot.x, annot.endX);
            const maxX = Math.max(annot.x, annot.endX);
            const minY = Math.min(annot.y, annot.endY);
            const maxY = Math.max(annot.y, annot.endY);

            if (annot.fillColor && annot.fillColor !== 'transparent') {
                if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
            }

            const hitTop = Math.abs(y - minY) <= tolerance && x >= minX - tolerance && x <= maxX + tolerance;
            const hitBottom = Math.abs(y - maxY) <= tolerance && x >= minX - tolerance && x <= maxX + tolerance;
            const hitLeft = Math.abs(x - minX) <= tolerance && y >= minY - tolerance && y <= maxY + tolerance;
            const hitRight = Math.abs(x - maxX) <= tolerance && y >= minY - tolerance && y <= maxY + tolerance;
            if (hitTop || hitBottom || hitLeft || hitRight) return true;
        } else if (annot.shapeType === 'ELLIPSE') {
            const cx = (annot.x + annot.endX) / 2;
            const cy = (annot.y + annot.endY) / 2;
            const rx = Math.max(0.1, Math.abs(annot.endX - annot.x) / 2);
            const ry = Math.max(0.1, Math.abs(annot.endY - annot.y) / 2);
            const normDist = Math.hypot((x - cx) / rx, (y - cy) / ry);

            if (annot.fillColor && annot.fillColor !== 'transparent') {
                if (normDist <= 1) return true;
            }

            if (Math.abs(normDist - 1) * Math.min(rx, ry) <= tolerance) return true;
        } else {
            const l2 = (annot.endX - annot.x) ** 2 + (annot.endY - annot.y) ** 2;
            let t = ((x - annot.x) * (annot.endX - annot.x) + (y - annot.y) * (annot.endY - annot.y)) / (l2 || 1);
            t = Math.max(0, Math.min(1, t));
            const dist = Math.hypot(x - (annot.x + t * (annot.endX - annot.x)), y - (annot.y + t * (annot.endY - annot.y)));
            if (dist < tolerance) return true;
        }
    } else if (annot.type === 'PATH' || annot.type === 'POLYLINE') {
        if (annot.points && annot.points.length > 0) {
            if (annot.closed && annot.fillColor && annot.fillColor !== 'transparent') {
                let inside = false;
                for (let i = 0, j = annot.points.length - 1; i < annot.points.length; j = i++) {
                    const xi = annot.points[i].x, yi = annot.points[i].y;
                    const xj = annot.points[j].x, yj = annot.points[j].y;
                    const intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                    if (intersect) inside = !inside;
                }
                if (inside) return true;
            }

            const numPoints = annot.points.length;
            const segments = annot.closed ? numPoints : numPoints - 1;
            for (let j = 0; j < segments; j++) {
                const p1 = annot.points[j], p2 = annot.points[(j + 1) % numPoints];
                const l2 = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2;
                let t = ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / (l2 || 1);
                t = Math.max(0, Math.min(1, t));
                const dist = Math.hypot(x - (p1.x + t * (p2.x - p1.x)), y - (p1.y + t * (p2.y - p1.y)));
                if (dist < tolerance) return true;
            }
            if (annot.points.length === 1 && Math.hypot(annot.points[0].x - x, annot.points[0].y - y) < tolerance) return true;
        }
    }
    return false;
}

function hitTestAnnotation(x, y) {
    const active = getActiveAnnotations();
    const tolerance = 10 / pdfRenderState.scale;

    for (let i = active.length - 1; i >= 0; i--) {
        if (isPointInAnnotation(active[i], x, y, tolerance)) return active[i].id;
    }
    return null;
}

// ─── 10. Pointer Event Handlers ───────────────────────────────────────────────

function handlePointerDown(e) {
    // If text editor is open, let it blur/commit naturally
    if (document.getElementById('annot-text-editor')) return;

    ['annot-color-flyout', 'annot-fill-color-flyout', 'annot-eraser-flyout', 'annot-shapes-flyout', 'annot-text-flyout'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) el.classList.add('hidden');
    });

    const { x, y } = getPdfCoordinates(e);
    const tool = AnnotationState.currentActiveTool;

    // ── Check Handles for Selected Annotation (All Tools) ────────────
    if (AnnotationState.selectedAnnotationId) {
        const selAnnot = AnnotationState.annotations.find(a => a.id === AnnotationState.selectedAnnotationId);
        if (selAnnot) {
            const s = pdfRenderState.scale || 1;
            const hs = 10; // Handle size on screen in pixels
            const scX = x * s, scY = y * s;
            let handleHit = false;

            if (selAnnot.type === 'SHAPE' && (selAnnot.shapeType === 'LINE' || selAnnot.shapeType === 'ARROW')) {
                const corners = [
                    { h: 'start', x: selAnnot.x * s, y: selAnnot.y * s },
                    { h: 'end', x: selAnnot.endX * s, y: selAnnot.endY * s }
                ];
                for (let c of corners) {
                    if (Math.abs(scX - c.x) <= hs && Math.abs(scY - c.y) <= hs) {
                        pushHistory(); // SNAPSHOT
                        isResizing = true; resizeHandle = c.h; originalResizeBounds = { annot: selAnnot };
                        handleHit = true; break;
                    }
                }
            } else if (selAnnot.type === 'POLYLINE' && selAnnot.points) {
                for (let i = 0; i < selAnnot.points.length; i++) {
                    const p = selAnnot.points[i];
                    if (Math.abs(scX - p.x * s) <= hs && Math.abs(scY - p.y * s) <= hs) {
                        pushHistory(); // SNAPSHOT
                        isResizing = true; resizeHandle = 'poly_' + i; originalResizeBounds = { annot: selAnnot };
                        handleHit = true; break;
                    }
                }
            } else {
                const r = getAnnotBounds(selAnnot);
                if (r) {
                    let corners = [
                        { h: 'tl', x: r.x * s, y: r.y * s },
                        { h: 'tr', x: (r.x + r.w) * s, y: r.y * s },
                        { h: 'br', x: (r.x + r.w) * s, y: (r.y + r.h) * s },
                        { h: 'bl', x: r.x * s, y: (r.y + r.h) * s }
                    ];

                    if (selAnnot.rotation) {
                        const rad = (selAnnot.rotation * Math.PI) / 180;
                        const cx = selAnnot.x * s;
                        const cy = selAnnot.y * s;
                        corners = corners.map(c => {
                            const dx = c.x - cx;
                            const dy = c.y - cy;
                            return {
                                h: c.h,
                                x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
                                y: cy + dx * Math.sin(rad) + dy * Math.cos(rad)
                            };
                        });
                    }

                    for (let c of corners) {
                        if (Math.abs(scX - c.x) <= hs && Math.abs(scY - c.y) <= hs) {
                            pushHistory(); // SNAPSHOT
                            isResizing = true;
                            resizeHandle = c.h;
                            originalResizeBounds = { x: selAnnot.x, y: selAnnot.y, endX: selAnnot.endX, endY: selAnnot.endY, fontSize: selAnnot.fontSize, width: r.w, height: r.h, py: selAnnot.y };
                            handleHit = true; break;
                        }
                    }

                    if (!handleHit && selAnnot.type === 'TEXT' && selAnnot.leaderHead && selAnnot.leaderElbow) {
                        if (Math.abs(scX - selAnnot.leaderHead.x * s) <= hs && Math.abs(scY - selAnnot.leaderHead.y * s) <= hs) {
                            pushHistory(); // SNAPSHOT
                            isResizing = true;
                            resizeHandle = 'leaderHead';
                            originalResizeBounds = { annot: selAnnot };
                            handleHit = true;
                        }
                        else if (Math.abs(scX - selAnnot.leaderElbow.x * s) <= hs && Math.abs(scY - selAnnot.leaderElbow.y * s) <= hs) {
                            pushHistory(); // SNAPSHOT
                            isResizing = true;
                            resizeHandle = 'leaderElbow';
                            originalResizeBounds = { annot: selAnnot };
                            handleHit = true;
                        }
                    }
                }
            }

            if (handleHit) {
                if (e.pointerId != null) annotCanvas.setPointerCapture(e.pointerId);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }
    }

    if (tool !== 'POINTER') {
        AnnotationState.selectedAnnotationId = null;
        updateToolbarUI();
    }

    // ── POINTER TOOL ─────────────────────────────────────────────────
    if (tool === 'POINTER') {

        const hitId = hitTestAnnotation(x, y);
        const prevSelected = AnnotationState.selectedAnnotationId;
        AnnotationState.selectedAnnotationId = hitId;

        if (hitId) {
            pushHistory(); // SNAPSHOT before drag
            isDraggingSelection = true;
            const annot = AnnotationState.annotations.find(a => a.id === hitId);
            dragOffset = { x: x - annot.x, y: y - annot.y };

            updatePropertyUIFromAnnotation(annot);
        }

        if (prevSelected !== hitId) {
            updateToolbarUI();
        }

        // If nothing hit → let the event fall through to the viewer for panning
        // We do this by NOT calling preventDefault when hitId is null
        renderAnnotations();
        if (!hitId) return; // Do not block viewer pan

        // Capture so we get move/up even outside canvas
        if (e.pointerId != null) annotCanvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    // For all drawing tools – capture pointer and prevent viewer pan
    if (e.pointerId != null) annotCanvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();

    // ── POLYLINE ─────────────────────────────────────────────────────
    if (tool === 'SHAPES' && AnnotationState.currentShapeType === 'POLYLINE') {
        if (e.button === 2) return; // right-click handled by contextmenu event
        if (!currentAnnotation || currentAnnotation.type !== 'POLYLINE') {
            isDrawing = true;
            currentAnnotation = new PolylineNode(x, y, {
                color: AnnotationState.currentStrokeColor,
                fillColor: AnnotationState.currentFillColor,
                strokeStyle: AnnotationState.currentStrokeStyle,
                thickness: AnnotationState.currentStrokeWidth,
                strokeOpacity: AnnotationState.currentStrokeOpacity,
                fillOpacity: AnnotationState.currentFillOpacity
            });
            currentAnnotation.addPoint(x, y); // floating tracking point
        } else {
            const start = currentAnnotation.points[0];
            const dist = Math.hypot(x - start.x, y - start.y);
            const tolerance = 10 / (pdfRenderState.scale || 1);
            if (dist <= tolerance && currentAnnotation.points.length > 2) {
                // Close shape securely on click if near start point
                currentAnnotation.closed = true;
                currentAnnotation.points.pop(); // remove floating point
                commitAnnotation(currentAnnotation);
                currentAnnotation = null;
                isDrawing = false;
            } else {
                let px = x, py = y;
                if (e.shiftKey && currentAnnotation.points.length > 1) {
                    // Snap anchor point to 45 degree axis from the previous node
                    const prev = currentAnnotation.points[currentAnnotation.points.length - 2];
                    const snapped = snapTo45(prev.x, prev.y, x, y);
                    px = snapped.x; py = snapped.y;
                }
                currentAnnotation.updateLastPoint(px, py); // anchor
                currentAnnotation.addPoint(x, y);         // new floating
            }
        }
        renderAnnotations();
        if (currentAnnotation) drawCurrentAnnotationPreview();
        return;
    }

    // ── OTHER SHAPES (Line, Rect, Ellipse, Arrow) ────────────────────
    if (tool === 'SHAPES' && AnnotationState.currentShapeType !== 'POLYLINE') {
        if (e.button === 2) return; // right-click handled by contextmenu event

        if (!currentAnnotation || currentAnnotation.type !== 'SHAPE') {
            isDrawing = true;
            currentAnnotation = new ShapeNode(AnnotationState.currentShapeType, x, y, {
                color: AnnotationState.currentStrokeColor,
                fillColor: AnnotationState.currentFillColor,
                strokeStyle: AnnotationState.currentStrokeStyle,
                thickness: AnnotationState.currentStrokeWidth,
                strokeOpacity: AnnotationState.currentStrokeOpacity,
                fillOpacity: AnnotationState.currentFillOpacity
            });
        } else {
            let px = x, py = y;
            if (e.shiftKey) {
                if (currentAnnotation.shapeType === 'LINE' || currentAnnotation.shapeType === 'ARROW') {
                    const snapped = snapTo45(currentAnnotation.x, currentAnnotation.y, x, y);
                    px = snapped.x; py = snapped.y;
                } else if (currentAnnotation.shapeType === 'RECTANGLE' || currentAnnotation.shapeType === 'ELLIPSE') {
                    const dx = x - currentAnnotation.x;
                    const dy = y - currentAnnotation.y;
                    const max = Math.max(Math.abs(dx), Math.abs(dy));
                    px = currentAnnotation.x + Math.sign(dx || 1) * max;
                    py = currentAnnotation.y + Math.sign(dy || 1) * max;
                }
            }
            currentAnnotation.updateEndPoint(px, py);
            commitAnnotation(currentAnnotation);
            currentAnnotation = null;
            isDrawing = false;
        }
        renderAnnotations();
        if (currentAnnotation) drawCurrentAnnotationPreview();
        return;
    }

    // ── PEN / HIGHLIGHTER ────────────────────────────────────────────
    isDrawing = true;
    if (tool === 'PEN') {
        currentAnnotation = new VectorPath(x, y, {
            color: AnnotationState.currentStrokeColor,
            fillColor: 'transparent',
            strokeStyle: AnnotationState.currentStrokeStyle,
            thickness: AnnotationState.currentStrokeWidth,
            strokeOpacity: AnnotationState.currentStrokeOpacity,
            fillOpacity: AnnotationState.currentFillOpacity
        });
    } else if (tool === 'HIGHLIGHTER') {
        currentAnnotation = new VectorPath(x, y, {
            color: AnnotationState.currentStrokeColor,
            fillColor: 'transparent',
            strokeStyle: AnnotationState.currentStrokeStyle,
            thickness: AnnotationState.currentStrokeWidth * 3,
            strokeOpacity: 40,
            blendMode: 'multiply'
        });
    } else if (tool === 'TEXT') {
        // Check if clicking an existing text to move/edit
        const hitId = hitTestAnnotation(x, y);
        if (hitId) {
            const annot = AnnotationState.annotations.find(a => a.id === hitId);
            if (annot && annot.type === 'TEXT') {
                AnnotationState.selectedAnnotationId = hitId;
                isDraggingSelection = true;
                dragOffset = { x: x - annot.x, y: y - annot.y };
                isDrawing = false;
                renderAnnotations();
                return;
            }
        }

        // Create new text node
        const node = new TextNode(x, y, '', {
            color: AnnotationState.currentStrokeColor,
            textColor: AnnotationState.currentTextColor,
            fillColor: AnnotationState.currentFillColor,
            strokeStyle: AnnotationState.currentStrokeStyle,
            strokeOpacity: AnnotationState.currentStrokeOpacity,
            fillOpacity: AnnotationState.currentFillOpacity,
            fontSize: AnnotationState.currentFontSize,
            rotation: (360 - (pdfRenderState.rotation || 0)) % 360
        });

        commitAnnotation(node);
        AnnotationState.selectedAnnotationId = node.id;
        renderAnnotations();
        enterTextEditMode(node);
        isDrawing = false;
    } else if (tool === 'TEXT_CALLOUT') {
        if (e.button === 2) {
            if (currentAnnotation) {
                currentAnnotation = null;
                isDrawing = false;
                renderAnnotations();
            }
            return;
        }

        if (!currentAnnotation) {
            const hitId = hitTestAnnotation(x, y);
            if (hitId) {
                const annot = AnnotationState.annotations.find(a => a.id === hitId);
                if (annot && annot.type === 'TEXT') {
                    AnnotationState.selectedAnnotationId = hitId;
                    isDraggingSelection = true;
                    dragOffset = { x: x - annot.x, y: y - annot.y };
                    isDrawing = false;
                    renderAnnotations();
                    return;
                }
            }

            isDrawing = true;
            const node = new TextNode(x, y, '', {
                color: AnnotationState.currentStrokeColor,
                textColor: AnnotationState.currentTextColor,
                fillColor: AnnotationState.currentFillColor,
                strokeStyle: AnnotationState.currentStrokeStyle,
                strokeOpacity: AnnotationState.currentStrokeOpacity,
                fillOpacity: AnnotationState.currentFillOpacity,
                fontSize: AnnotationState.currentFontSize,
                rotation: (360 - (pdfRenderState.rotation || 0)) % 360
            });
            node.leaderHead = { x, y };
            node.leaderElbow = { x, y };
            node.calloutStep = 1;
            currentAnnotation = node;
            renderAnnotations();
            drawCurrentAnnotationPreview();
        } else if (currentAnnotation.calloutStep === 1) {
            currentAnnotation.leaderElbow = { x, y };
            currentAnnotation.calloutStep = 2;
            renderAnnotations();
            drawCurrentAnnotationPreview();
        } else if (currentAnnotation.calloutStep === 2) {
            currentAnnotation.x = x;
            currentAnnotation.y = y;
            const node = currentAnnotation;
            delete node.calloutStep;
            currentAnnotation = null;
            isDrawing = false;
            commitAnnotation(node);
            AnnotationState.selectedAnnotationId = node.id;
            renderAnnotations();
            enterTextEditMode(node);
        }
        return;
    } else if (tool === 'ERASER') {
        if (AnnotationState.currentEraserMode === 'PIXEL') {
            isDrawing = true;
            currentAnnotation = new VectorPath(x, y, {
                color: '#FFFFFF', // Fallback for pure PDF export
                fillColor: 'transparent',
                strokeStyle: 'solid',
                thickness: 20, // Erasing is usually thicker
                strokeOpacity: 100,
                blendMode: 'destination-out' // Masks/Erases underlying canvas strokes instantly
            });
        } else {
            eraseAtPoint(x, y);
        }
    }
}

function handlePointerMove(e) {
    const { x, y } = getPdfCoordinates(e);

    // ── Resize selected annotation ────────────────────────────────────
    if (isResizing && AnnotationState.selectedAnnotationId) {
        e.preventDefault();
        const annot = AnnotationState.annotations.find(a => a.id === AnnotationState.selectedAnnotationId);
        if (annot) {
            if (resizeHandle === 'start') {
                annot.x = x;
                annot.y = y;
            } else if (resizeHandle === 'end') {
                annot.endX = x;
                annot.endY = y;
            } else if (resizeHandle.startsWith('poly_')) {
                const idx = parseInt(resizeHandle.split('_')[1], 10);
                if (annot.points && annot.points[idx]) {
                    annot.points[idx].x = x;
                    annot.points[idx].y = y;
                }
            } else if (resizeHandle === 'leaderHead') {
                annot.leaderHead.x = x;
                annot.leaderHead.y = y;
            } else if (resizeHandle === 'leaderElbow') {
                annot.leaderElbow.x = x;
                annot.leaderElbow.y = y;
            } else if (annot.type === 'SHAPE' && (annot.shapeType === 'RECTANGLE' || annot.shapeType === 'ELLIPSE')) {
                // Determine absolute visual bounds from original interaction start
                let minX = Math.min(originalResizeBounds.x, originalResizeBounds.endX);
                let maxX = Math.max(originalResizeBounds.x, originalResizeBounds.endX);
                let minY = Math.min(originalResizeBounds.y, originalResizeBounds.endY);
                let maxY = Math.max(originalResizeBounds.y, originalResizeBounds.endY);

                if (resizeHandle.includes('l')) minX = Math.min(x, maxX - 5);
                if (resizeHandle.includes('r')) maxX = Math.max(x, minX + 5);
                if (resizeHandle.includes('t')) minY = Math.min(y, maxY - 5);
                if (resizeHandle.includes('b')) maxY = Math.max(y, minY + 5);

                annot.x = minX;
                annot.y = minY;
                annot.endX = maxX;
                annot.endY = maxY;

            } else if (annot.type === 'TEXT') {
                const r = originalResizeBounds;
                let mx = x;
                let my = y;
                if (annot.rotation) {
                    const rad = (-annot.rotation * Math.PI) / 180;
                    const lx = x - r.x;
                    const ly = y - r.y;
                    mx = r.x + lx * Math.cos(rad) - ly * Math.sin(rad);
                    my = r.y + lx * Math.sin(rad) + ly * Math.cos(rad);
                }

                const startY = r.py;
                const padding = annot.padding || 5;
                const topEdge = startY - padding;
                const bottomEdge = startY + r.height - padding;
                const leftEdge = r.x - padding;
                const rightEdge = r.x + r.width - padding;

                let sizeY = r.fontSize, sizeX = r.fontSize;

                if (resizeHandle.includes('b')) sizeY = r.fontSize * (Math.max(5, my - topEdge) / r.height);
                else if (resizeHandle.includes('t')) sizeY = r.fontSize * (Math.max(5, bottomEdge - my) / r.height);

                if (resizeHandle.includes('r')) sizeX = r.fontSize * (Math.max(5, mx - leftEdge) / r.width);
                else if (resizeHandle.includes('l')) sizeX = r.fontSize * (Math.max(5, rightEdge - mx) / r.width);

                const newSize = Math.max(8, Math.max(sizeX, sizeY));
                annot.fontSize = newSize;

                const newH = newSize * (r.height / r.fontSize);
                const newW = newSize * (r.width / r.fontSize);

                let newX = r.x;
                let newY = r.y;

                if (resizeHandle.includes('t')) newY = bottomEdge - newH + padding;
                else newY = topEdge + padding;

                if (resizeHandle.includes('l')) newX = rightEdge - newW + padding;
                else newX = leftEdge + padding;

                if (annot.rotation) {
                    const dx = newX - r.x;
                    const dy = newY - r.py;
                    const rad = (annot.rotation * Math.PI) / 180;
                    annot.x = r.x + dx * Math.cos(rad) - dy * Math.sin(rad);
                    annot.y = r.py + dx * Math.sin(rad) + dy * Math.cos(rad);
                } else {
                    annot.x = newX;
                    annot.y = newY;
                }

                const fs = document.getElementById('annot-font-size-slider');
                const fl = document.getElementById('annot-font-size-label');
                if (fs && fl) {
                    fs.value = Math.min(Math.max(8, Math.round(newSize)), 96);
                    fl.innerText = fs.value + 'px';
                }
            }
        }
        renderAnnotations();
        return;
    }

    // ── Drag selected annotation ──────────────────────────────────────
    if (isDraggingSelection && AnnotationState.selectedAnnotationId) {
        e.preventDefault();
        const annot = AnnotationState.annotations.find(a => a.id === AnnotationState.selectedAnnotationId);
        if (annot) {
            if (annot.type === 'TEXT') {
                const newX = x - dragOffset.x;
                const newY = y - dragOffset.y;
                const dx = newX - annot.x;
                const dy = newY - annot.y;
                annot.x = newX;
                annot.y = newY;
                if (annot.leaderHead && annot.leaderElbow) {
                    annot.leaderElbow.x += dx;
                    annot.leaderElbow.y += dy;
                }
            } else if (annot.type === 'SHAPE') {
                const dx = x - dragOffset.x - annot.x;
                const dy = y - dragOffset.y - annot.y;
                annot.x += dx; annot.y += dy;
                annot.endX += dx; annot.endY += dy;
                dragOffset = { x: x - annot.x, y: y - annot.y };
            } else if (annot.type === 'PATH' || annot.type === 'POLYLINE') {
                const dx = x - dragOffset.x - annot.x;
                const dy = y - dragOffset.y - annot.y;
                annot.x += dx; annot.y += dy;
                for (const pt of annot.points) { pt.x += dx; pt.y += dy; }
                dragOffset = { x: x - annot.x, y: y - annot.y };
            }
            renderAnnotations();
        }
        return;
    }

    // ── Polyline rubber band ──────────────────────────────────────────
    if (isDrawing && currentAnnotation && currentAnnotation.type === 'POLYLINE') {
        e.preventDefault();
        let px = x, py = y;

        const start = currentAnnotation.points[0];
        const distToStart = Math.hypot(x - start.x, y - start.y);
        const tolerance = 10 / (pdfRenderState.scale || 1);

        if (distToStart <= tolerance && currentAnnotation.points.length > 2) {
            px = start.x; py = start.y;
        } else if (e.shiftKey && currentAnnotation.points.length > 1) {
            const prev = currentAnnotation.points[currentAnnotation.points.length - 2];
            const snapped = snapTo45(prev.x, prev.y, x, y);
            px = snapped.x; py = snapped.y;
        }

        currentAnnotation.updateLastPoint(px, py);
        renderAnnotations();
        drawCurrentAnnotationPreview();
        return;
    }

    // ── Callout / Leader line preview ────────────────────────────────
    if (isDrawing && currentAnnotation && currentAnnotation.type === 'TEXT' && currentAnnotation.leaderHead) {
        if (currentAnnotation.calloutStep === 1) {
            currentAnnotation.leaderElbow = { x, y };
            currentAnnotation.x = x;
            currentAnnotation.y = y;
        } else if (currentAnnotation.calloutStep === 2) {
            currentAnnotation.x = x;
            currentAnnotation.y = y;
        }
        renderAnnotations();
        drawCurrentAnnotationPreview();
        return;
    }

    // ── Cursor feedback for POINTER tool ─────────────────────────────
    if (!isDrawing) {
        const hitId = hitTestAnnotation(x, y);
        let cursor = '';

        if (AnnotationState.currentActiveTool === 'POINTER') {
            cursor = hitId ? 'move' : '';
        }

        // Check resize handles specifically
        if (AnnotationState.selectedAnnotationId) {
            const selAnnot = AnnotationState.annotations.find(a => a.id === AnnotationState.selectedAnnotationId);
            if (selAnnot) {
                const s = pdfRenderState.scale || 1;
                const hs = 10;
                const scX = x * s, scY = y * s;

                if (selAnnot.type === 'SHAPE' && (selAnnot.shapeType === 'LINE' || selAnnot.shapeType === 'ARROW')) {
                    if (Math.abs(scX - selAnnot.x * s) <= hs && Math.abs(scY - selAnnot.y * s) <= hs) cursor = 'crosshair';
                    else if (Math.abs(scX - selAnnot.endX * s) <= hs && Math.abs(scY - selAnnot.endY * s) <= hs) cursor = 'crosshair';
                } else if (selAnnot.type === 'POLYLINE' && selAnnot.points) {
                    for (let p of selAnnot.points) {
                        if (Math.abs(scX - p.x * s) <= hs && Math.abs(scY - p.y * s) <= hs) {
                            cursor = 'crosshair'; break;
                        }
                    }
                } else {
                    const r = getAnnotBounds(selAnnot);
                    if (r) {
                        let corners = [
                            { x: r.x * s, y: r.y * s },
                            { x: (r.x + r.w) * s, y: r.y * s },
                            { x: (r.x + r.w) * s, y: (r.y + r.h) * s },
                            { x: r.x * s, y: (r.y + r.h) * s }
                        ];

                        if (selAnnot.rotation) {
                            const rad = (selAnnot.rotation * Math.PI) / 180;
                            const cx = selAnnot.x * s;
                            const cy = selAnnot.y * s;
                            corners = corners.map(c => {
                                const dx = c.x - cx;
                                const dy = c.y - cy;
                                return {
                                    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
                                    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad)
                                };
                            });
                        }

                        for (let c of corners) {
                            if (Math.abs(scX - c.x) <= hs && Math.abs(scY - c.y) <= hs) {
                                cursor = 'crosshair';
                                break;
                            }
                        }

                        if (selAnnot.type === 'TEXT' && selAnnot.leaderHead && selAnnot.leaderElbow) {
                            if (Math.abs(scX - selAnnot.leaderHead.x * s) <= hs && Math.abs(scY - selAnnot.leaderHead.y * s) <= hs) {
                                cursor = 'crosshair';
                            } else if (Math.abs(scX - selAnnot.leaderElbow.x * s) <= hs && Math.abs(scY - selAnnot.leaderElbow.y * s) <= hs) {
                                cursor = 'crosshair';
                            }
                        }
                    }
                }
            }
        }
        if (annotCanvas) annotCanvas.style.cursor = cursor !== '' ? cursor : (AnnotationState.currentActiveTool !== 'POINTER' ? 'crosshair' : '');
    }

    if (!isDrawing) return;
    e.preventDefault();

    if (currentAnnotation && currentAnnotation.type === 'PATH') {
        currentAnnotation.addPoint(x, y);
    } else if (currentAnnotation && currentAnnotation.type === 'SHAPE') {
        let px = x, py = y;
        if (e.shiftKey) {
            if (currentAnnotation.shapeType === 'LINE' || currentAnnotation.shapeType === 'ARROW') {
                const snapped = snapTo45(currentAnnotation.x, currentAnnotation.y, x, y);
                px = snapped.x; py = snapped.y;
            } else if (currentAnnotation.shapeType === 'RECTANGLE' || currentAnnotation.shapeType === 'ELLIPSE') {
                const dx = x - currentAnnotation.x;
                const dy = y - currentAnnotation.y;
                const max = Math.max(Math.abs(dx), Math.abs(dy));
                px = currentAnnotation.x + Math.sign(dx || 1) * max;
                py = currentAnnotation.y + Math.sign(dy || 1) * max;
            }
        }
        currentAnnotation.updateEndPoint(px, py);
    } else if (AnnotationState.currentActiveTool === 'ERASER') {
        if (AnnotationState.currentEraserMode === 'OBJECT') {
            eraseAtPoint(x, y);
        }
    }

    renderAnnotations();
    drawCurrentAnnotationPreview();
}

function handlePointerUp(e) {
    if (e.pointerId != null && annotCanvas && typeof annotCanvas.releasePointerCapture === 'function') {
        try { annotCanvas.releasePointerCapture(e.pointerId); } catch (_) { }
    }

    if (isResizing) {
        isResizing = false;
        resizeHandle = null;
        updateUndoRedoUI();
        return;
    }

    if (isDraggingSelection) {
        isDraggingSelection = false;
        return;
    }

    if (!isDrawing) return;
    // Don't commit polylines or shapes on pointer up – they finish via second click / right-click
    if (currentAnnotation && (currentAnnotation.type === 'POLYLINE' || currentAnnotation.type === 'SHAPE')) return;

    // Don't commit callouts on pointer up - they finish via clicks
    if (currentAnnotation && currentAnnotation.type === 'TEXT' && currentAnnotation.leaderHead) return;

    isDrawing = false;

    if (currentAnnotation) {
        if (currentAnnotation.type === 'PATH' && currentAnnotation.points.length < 2) {
            const { x, y } = getPdfCoordinates(e);
            currentAnnotation.addPoint(x + 0.1, y + 0.1);
        } else if (currentAnnotation.type === 'PATH' && currentAnnotation.points.length > 2) {
            const start = currentAnnotation.points[0];
            const end = currentAnnotation.points[currentAnnotation.points.length - 1];
            const dist = Math.hypot(end.x - start.x, end.y - start.y);
            const tolerance = 10 / (pdfRenderState.scale || 1);
            if (dist <= tolerance) {
                currentAnnotation.closed = true;
            }
        }
        commitAnnotation(currentAnnotation);
        AnnotationState.selectedAnnotationId = currentAnnotation.id;
        currentAnnotation = null;
        updateToolbarUI();
        renderAnnotations();
    }
}

function finishPolyline() {
    if (currentAnnotation && currentAnnotation.type === 'POLYLINE') {
        if (currentAnnotation.points.length > 1) currentAnnotation.points.pop();
        if (currentAnnotation.points.length >= 2) {
            const start = currentAnnotation.points[0];
            const end = currentAnnotation.points[currentAnnotation.points.length - 1];
            const dist = Math.hypot(end.x - start.x, end.y - start.y);
            const tolerance = 10 / (pdfRenderState.scale || 1);
            if (dist <= tolerance && currentAnnotation.points.length > 2) {
                currentAnnotation.closed = true;
            }
            commitAnnotation(currentAnnotation);
            AnnotationState.selectedAnnotationId = currentAnnotation.id;
        }
        currentAnnotation = null;
        isDrawing = false;
        updateToolbarUI();
        renderAnnotations();
    }
}

function handleDoubleClick(e) {
    const { x, y } = getPdfCoordinates(e);
    // Finish polyline on double-click (alternative to right-click)
    if (AnnotationState.currentActiveTool === 'SHAPES' &&
        AnnotationState.currentShapeType === 'POLYLINE' &&
        currentAnnotation && currentAnnotation.type === 'POLYLINE') {
        finishPolyline();
        return;
    }
    // Edit text annotation
    if (AnnotationState.currentActiveTool === 'POINTER' || AnnotationState.currentActiveTool === 'TEXT') {
        const hitId = hitTestAnnotation(x, y);
        if (hitId) {
            AnnotationState.selectedAnnotationId = hitId;
            const annot = AnnotationState.annotations.find(a => a.id === hitId);
            if (annot && annot.type === 'TEXT') enterTextEditMode(annot);
        }
    }
}

// ─── 11. Preview Only (in-progress stroke on top) ─────────────────────────────

function drawCurrentAnnotationPreview() {
    if (!currentAnnotation || !annotCtx) return;
    const sOpacity = (currentAnnotation.strokeOpacity !== undefined ? currentAnnotation.strokeOpacity : (currentAnnotation.opacity || 100)) / 100;

    annotCtx.save();

    const s = pdfRenderState.scale || 1.0;
    const rot = (pdfRenderState.rotation || 0) % 360;

    if (rot === 0) {
        annotCtx.scale(s, s);
    } else if (rot === 90) {
        annotCtx.translate(annotCanvas.width, 0);
        annotCtx.rotate(Math.PI / 2);
        annotCtx.scale(s, s);
    } else if (rot === 180) {
        annotCtx.translate(annotCanvas.width, annotCanvas.height);
        annotCtx.rotate(Math.PI);
        annotCtx.scale(s, s);
    } else if (rot === 270) {
        annotCtx.translate(0, annotCanvas.height);
        annotCtx.rotate(-Math.PI / 2);
        annotCtx.scale(s, s);
    }

    if (currentAnnotation.blendMode === 'multiply') annotCtx.globalCompositeOperation = 'multiply';
    else if (currentAnnotation.blendMode === 'destination-out') annotCtx.globalCompositeOperation = 'destination-out';
    annotCtx.strokeStyle = hexToRgba(currentAnnotation.color, sOpacity);
    annotCtx.lineWidth = currentAnnotation.thickness;
    annotCtx.lineCap = 'round';
    annotCtx.lineJoin = 'round';

    if (currentAnnotation.strokeStyle === 'dashed') {
        annotCtx.setLineDash([currentAnnotation.thickness * 3, currentAnnotation.thickness * 3]);
    } else if (currentAnnotation.strokeStyle === 'dotted') {
        annotCtx.setLineDash([currentAnnotation.thickness, currentAnnotation.thickness * 2]);
    } else {
        annotCtx.setLineDash([]);
    }

    drawAnnotation(annotCtx, currentAnnotation);
    annotCtx.restore();
}

// ─── 12. Eraser ───────────────────────────────────────────────────────────────

function eraseAtPoint(x, y) {
    const active = getActiveAnnotations();
    const hitRadius = 15 / pdfRenderState.scale;
    let deleted = false;

    for (let i = active.length - 1; i >= 0; i--) {
        const annot = active[i];
        if (isPointInAnnotation(annot, x, y, hitRadius)) {
            const idx = AnnotationState.annotations.indexOf(annot);
            if (idx > -1) {
                AnnotationState.annotations.splice(idx, 1);
                deleted = true;
                if (AnnotationState.currentEraserMode === 'OBJECT') break;
            }
        }
    }
    if (deleted) { renderAnnotations(); updateUndoRedoUI(); }
}

// ─── 13. Text Edit Mode ───────────────────────────────────────────────────────

function enterTextEditMode(annot) {
    if (!annot || annot.type !== 'TEXT') return;

    annot._isEditing = true;

    const existing = document.getElementById('annot-text-editor');
    if (existing) existing.remove();

    const s = pdfRenderState.scale || 1.0;
    const canvasRect = annotCanvas.getBoundingClientRect();
    const rot = (pdfRenderState.rotation || 0) % 360;

    const pt = mapPointFromUnrotated(annot.x * s, annot.y * s, rot, annotCanvas.width, annotCanvas.height);

    const totalRot = (rot + (annot.rotation || 0)) % 360;

    const screenX = canvasRect.left + pt.x * (canvasRect.width / annotCanvas.width);
    const screenY = canvasRect.top + pt.y * (canvasRect.height / annotCanvas.height);

    const textarea = document.createElement('textarea');
    textarea.id = 'annot-text-editor';
    textarea.value = annot.text;
    textarea.placeholder = 'Type here…';
    let editColor = annot.textColor || (annot.color === 'transparent' ? '#000000' : annot.color);

    const pScaled = (annot.padding || 5) * s;

    textarea.style.cssText = `
        position: fixed;
        left: ${screenX}px;
        top: ${screenY}px;
        transform: rotate(${totalRot}deg) translate(-${pScaled}px, -${pScaled}px);
        transform-origin: 0 0;
        font: ${annot.fontSize * s}px ${annot.fontFamily};
        color: ${editColor};
        background: transparent;
        border: none;
        outline: 2px dashed rgba(59, 130, 246, 0.8);
        border-radius: 2px;
        padding: ${pScaled}px;
        margin: 0;
        z-index: 9999;
        overflow: hidden;
        resize: none;
        white-space: pre;
        min-width: 60px;
        min-height: 1.5em;
        line-height: 1;
    `;

    const updateSize = () => {
        textarea.style.width = '1px';
        textarea.style.height = '1px';
        textarea.style.width = (textarea.scrollWidth) + 'px';
        textarea.style.height = (textarea.scrollHeight) + 'px';
        annot.text = textarea.value;
        renderAnnotations();
    };

    const commit = () => {
        if (!document.body.contains(textarea)) return;
        annot.text = textarea.value;
        delete annot._isEditing;
        if (!annot.text.trim()) {
            const idx = AnnotationState.annotations.indexOf(annot);
            if (idx > -1) AnnotationState.annotations.splice(idx, 1);
            AnnotationState.selectedAnnotationId = null;
        } else {
            setActiveTool('POINTER');
            AnnotationState.selectedAnnotationId = annot.id;
        }
        textarea.remove();
        renderAnnotations();
    };

    textarea.addEventListener('input', updateSize);
    textarea.addEventListener('blur', commit);
    textarea.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Escape') commit();
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); }
    });

    document.body.appendChild(textarea);
    updateSize();
    setTimeout(() => { textarea.focus(); textarea.select(); }, 10);
}

function loadAnnotations(pageId) {
    let saved = null;
    if (window.getPageAnnotation) {
        saved = window.getPageAnnotation(pageId);
    }
    if (saved && saved.nodes) {
        let nodes = JSON.parse(JSON.stringify(saved.nodes));

        // Migrate old pre-rotated nodes to 0-degree UNROTATED coordinate frame
        if (!saved._unrotated && saved.rotation) {
            const rot = saved.rotation % 360;
            const rotW = saved.pageWidth;
            const rotH = saved.pageHeight;
            nodes.forEach(n => {
                const pt = mapPointToUnrotated(n.x, n.y, rot, rotW, rotH);
                n.x = pt.x; n.y = pt.y;
                if (n.endX !== undefined && n.endY !== undefined) {
                    const ept = mapPointToUnrotated(n.endX, n.endY, rot, rotW, rotH);
                    n.endX = ept.x; n.endY = ept.y;
                }
                if (n.points) {
                    n.points = n.points.map(p => mapPointToUnrotated(p.x, p.y, rot, rotW, rotH));
                }
            });
        }
        AnnotationState.annotations = nodes;
        AnnotationState.historyStack = [];
        AnnotationState.redoStack = [];
    } else {
        AnnotationState.annotations = [];
        AnnotationState.historyStack = [];
        AnnotationState.redoStack = [];
    }
    AnnotationState.initialSnapshot = JSON.stringify(getActiveAnnotations());
    updateUndoRedoUI();
    renderAnnotations();
}

/**
 * Saves current annotation state into the global registry.
 * This should be called before switching pages or closing the viewer.
 */
function saveCurrentPageAnnotations() {
    if (!pdfRenderState.pageId) return;

    const activeNodes = getActiveAnnotations();

    if (activeNodes.length === 0) {
        if (window.updatePageAnnotation) {
            window.updatePageAnnotation(pdfRenderState.pageId, null);
        }
        AnnotationState.initialSnapshot = JSON.stringify([]);
        return;
    }

    // Generate PNG for baking into the final PDF
    const pageWidth = pdfRenderState.width / pdfRenderState.scale;
    const pageHeight = pdfRenderState.height / pdfRenderState.scale;
    const dataUrl = getAnnotationImageDataUrl(pageWidth, pageHeight);

    let pageRot = 0;
    if (typeof window.getPageRotation === 'function') {
        pageRot = window.getPageRotation(pdfRenderState.pageId);
    }

    if (window.updatePageAnnotation) {
        window.updatePageAnnotation(pdfRenderState.pageId, {
            dataUrl,
            pageWidth,
            pageHeight,
            rotation: pageRot,
            _unrotated: true, // Tag identifying it uses the new robust rotation system
            nodes: JSON.parse(JSON.stringify(activeNodes))
        });
    }

    AnnotationState.initialSnapshot = JSON.stringify(activeNodes);
}

window.saveCurrentPageAnnotations = saveCurrentPageAnnotations;
window.loadAnnotations = loadAnnotations;

window.hasAnnotationsChanged = function () {
    const textEditor = document.getElementById('annot-text-editor');
    if (textEditor) return true;
    const hasUncommitted = currentAnnotation !== null;
    const changed = JSON.stringify(getActiveAnnotations()) !== AnnotationState.initialSnapshot;
    return hasUncommitted || changed;
};

// ─── 14. Annotation → Canvas Image for Export ────────────────────────────────

/**
 * Renders the current annotations onto a temporary, full-res canvas and returns
 * it as a PNG data-URL (or null if there's nothing to render).
 * Called by logic.js before sending data to the Python backend.
 *
 * @param {number} pageWidth  - PDF page width in pt (unscaled)
 * @param {number} pageHeight - PDF page height in pt (unscaled)
 * @returns {string|null} PNG data-URL or null
 */
function getAnnotationImageDataUrl(pageWidth, pageHeight) {
    const active = getActiveAnnotations();
    if (active.length === 0) return null;

    // Render at 2x for quality
    const renderScale = 2;

    // Safety check for huge pages
    const MAX_CANVAS_AREA = 16384 * 16384;
    let finalScale = renderScale;
    if ((pageWidth * renderScale) * (pageHeight * renderScale) > MAX_CANVAS_AREA) {
        finalScale = Math.sqrt(MAX_CANVAS_AREA / (pageWidth * pageHeight)) * 0.9;
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = pageWidth * finalScale;
    offscreen.height = pageHeight * finalScale;
    const ctx = offscreen.getContext('2d');

    // Save current canvas state
    const savedCanvas = annotCanvas;
    const savedCtx = annotCtx;
    const originalRotation = pdfRenderState.rotation;
    const originalScale = pdfRenderState.scale;

    // FORCE rotation to 0 and match dimensions for unrotated export
    pdfRenderState.rotation = 0;
    pdfRenderState.scale = finalScale;

    annotCanvas = offscreen;
    annotCtx = ctx;

    renderAnnotations();

    // Restore
    annotCanvas = savedCanvas;
    annotCtx = savedCtx;
    pdfRenderState.rotation = originalRotation;
    pdfRenderState.scale = originalScale;

    return offscreen.toDataURL('image/png');
}

function openFlyout(btnId, flyoutId) {
    const btn = document.getElementById(btnId);
    const flyout = document.getElementById(flyoutId);
    if (!btn || !flyout) return;

    const isHidden = flyout.classList.contains('hidden');

    ['annot-color-flyout', 'annot-fill-color-flyout', 'annot-eraser-flyout', 'annot-shapes-flyout', 'annot-text-flyout'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    if (isHidden) {
        const rect = btn.getBoundingClientRect();
        flyout.style.position = 'fixed';
        flyout.style.left = (rect.left + rect.width / 2) + 'px';
        flyout.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        flyout.classList.remove('hidden');
    }
}

window.toggleColorFlyout = function (e) {
    if (e) e.stopPropagation();
    openFlyout('annot-current-color-btn', 'annot-color-flyout');
};
window.toggleFillColorFlyout = function (e) {
    if (e) e.stopPropagation();
    openFlyout('annot-current-fill-btn', 'annot-fill-color-flyout');
};
window.toggleEraserFlyout = function (e) {
    if (e) e.stopPropagation();
    openFlyout('tool-eraser', 'annot-eraser-flyout');
};
window.toggleShapesFlyout = function (e) {
    if (e) e.stopPropagation();
    openFlyout('tool-shapes', 'annot-shapes-flyout');
};
window.toggleTextFlyout = function (e) {
    if (e) e.stopPropagation();
    openFlyout('tool-text', 'annot-text-flyout');
};

document.addEventListener('click', (e) => {
    const flyout = document.getElementById('annot-color-flyout');
    if (flyout && !flyout.classList.contains('hidden') && !e.target.closest('#annot-stroke-colors')) {
        flyout.classList.add('hidden');
    }
    const fillFlyout = document.getElementById('annot-fill-color-flyout');
    if (fillFlyout && !fillFlyout.classList.contains('hidden') && !e.target.closest('#annot-fill-colors')) {
        fillFlyout.classList.add('hidden');
    }
    const eraserFlyout = document.getElementById('annot-eraser-flyout');
    if (eraserFlyout && !eraserFlyout.classList.contains('hidden') && !e.target.closest('#annot-eraser-container')) {
        eraserFlyout.classList.add('hidden');
    }
    const shapesFlyout = document.getElementById('annot-shapes-flyout');
    if (shapesFlyout && !shapesFlyout.classList.contains('hidden') && !e.target.closest('#annot-shapes-container')) {
        shapesFlyout.classList.add('hidden');
    }
    const textFlyout = document.getElementById('annot-text-flyout');
    if (textFlyout && !textFlyout.classList.contains('hidden') && !e.target.closest('#annot-text-container')) {
        textFlyout.classList.add('hidden');
    }
});

// Close flyouts seamlessly when scrolling the toolbar
const annotToolbar = document.getElementById('annotation-toolbar');
if (annotToolbar) {
    annotToolbar.addEventListener('scroll', () => {
        ['annot-color-flyout', 'annot-fill-color-flyout', 'annot-eraser-flyout', 'annot-shapes-flyout', 'annot-text-flyout'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    }, { passive: true });
}

window.getAnnotationImageDataUrl = getAnnotationImageDataUrl;
window.getActiveAnnotations = getActiveAnnotations;

// ─── 15. Global Exports ───────────────────────────────────────────────────────

window.setActiveTool = setActiveTool;
window.setEraserMode = setEraserMode;
window.setShapeType = setShapeType;
window.setAnnotColor = setAnnotColor;
window.setAnnotFillColor = setAnnotFillColor;
window.setAnnotStrokeStyle = setAnnotStrokeStyle;
window.setAnnotStroke = setAnnotStroke;
window.setAnnotStrokeOpacity = setAnnotStrokeOpacity;
window.setAnnotFillOpacity = setAnnotFillOpacity;
window.setTextType = setTextType;
window.setAnnotFontSize = setAnnotFontSize;
window.annotUndo = annotUndo;
window.annotRedo = annotRedo;
window.annotClearAll = annotClearAll;
window.annotDeleteSelected = annotDeleteSelected;
window.annotExport = annotExport;
window.finishPolyline = finishPolyline;
window.AnnotationState = AnnotationState;
