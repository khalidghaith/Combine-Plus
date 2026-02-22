// --- ELECTRON DETECTION & IPC HOOKS (GLOBAL) ---
let ipcRenderer = null;
let isElectron = false;
let appVersion = 'Dev Build'; // Fallback
let pendingFiles = [];
let fs = null;
let path = null;
let os = null;

try {
    if (typeof require !== 'undefined') {
        const electron = require('electron');
        ipcRenderer = electron.ipcRenderer;
        fs = require('fs');
        path = require('path');
        os = require('os');
        isElectron = true;
        try { appVersion = require('./package.json').version; } catch (e) { }
        console.log("Environment: Real Electron App");

        ipcRenderer.on('add-files-from-system', (event, filePaths) => {
            if (window.electronProcessFiles) {
                window.electronProcessFiles(filePaths, 'electron');
            } else if (filePaths && filePaths.length > 0) {
                pendingFiles.push(...filePaths);
            }
        });
    }
} catch (e) {
    console.log("Environment: Browser Preview (No Node/Electron)");
}

document.addEventListener('DOMContentLoaded', () => {
    // --- PERSISTENCE & INITIAL STATE ---
    const savedSettings = localStorage.getItem('combine-app-settings');
    const initialSettings = savedSettings ? JSON.parse(savedSettings) : { theme: 'light', view: 'grid', resizeToFit: false, gridCols: 3, keepExpanded: false };
    let activeDrag = null; // Central state for all drag operations: { type: 'internal' | 'external' }

    let state = {
        theme: initialSettings.theme,
        view: initialSettings.view,
        resizeToFit: initialSettings.resizeToFit,
        gridCols: initialSettings.gridCols || 3,
        keepExpanded: initialSettings.keepExpanded || false,
        expandedContainerId: null,
        selected: new Set(),
        lastSelectedId: null,
        items: [],
        history: [],
        future: [],
        // Viewer State
        viewer: {
            isOpen: false,
            itemId: null, // The ID of the item (file or page) being viewed
            pageId: null, // The specific page ID
            scale: 1.0,
            rotation: 0,
            tool: 'pan', // 'pan' or 'region'
            selection: null, // { startX, startY, currentX, currentY }
            isDragging: false,
            startX: 0,
            startY: 0,
            scrollLeft: 0,
            scrollTop: 0,
            renderDebounce: null
        },
    };

    // Apply initial visual settings immediately
    document.body.className = `theme-${state.theme}`;
    document.getElementById('app-window').className = `theme-${state.theme} relative`;
    document.getElementById('theme-icon').className = state.theme === 'light' ? 'fas fa-moon text-xs' : 'fas fa-sun text-xs';

    // PDF Caching for Thumbnails
    let pdfDocCache = {};

    const dom = {
        window: document.getElementById('app-window'),
        gridView: document.getElementById('grid-view'),
        listView: document.getElementById('list-view'),
        startView: document.getElementById('start-view'),
        markerV: document.getElementById('marker-v'),
        markerH: document.getElementById('marker-h'),
        mainScroll: document.getElementById('main-scroll'),
        statusMsg: document.getElementById('status-msg'),
        settingsModal: document.getElementById('settings-modal'),
        helpModal: document.getElementById('help-modal'),
        resetModal: document.getElementById('reset-modal'),
        messageModal: document.getElementById('message-modal'),
        fileInput: document.getElementById('file-input'),
        // Viewer DOM
        viewerModal: document.getElementById('viewer-modal'),
        viewerContent: document.getElementById('viewer-content'),
        viewerViewport: document.getElementById('viewer-viewport'),
        viewerScaleInput: document.getElementById('viewer-scale-input'),
        viewerModeBtn: document.getElementById('viewer-mode-btn'),
        viewerLoading: document.getElementById('viewer-loading'),
        viewerFilename: document.getElementById('viewer-filename'),
        viewerCounter: document.getElementById('viewer-counter')
    };

    // --- INJECT ABOUT BUTTON ---
    const helpBtn = document.getElementById('btn-help');
    if (helpBtn && helpBtn.parentNode) {
        if (!helpBtn.parentNode.classList.contains('relative')) {
            helpBtn.parentNode.classList.add('relative');
        }

        const aboutBtn = document.createElement('button');
        aboutBtn.id = 'btn-about';
        aboutBtn.className = helpBtn.className;
        aboutBtn.innerHTML = '<i class="fas fa-info-circle text-xs"></i>'; // Ensure text-xs is here too
        aboutBtn.title = "About";
        aboutBtn.onclick = () => window.toggleAbout();
        helpBtn.parentNode.insertBefore(aboutBtn, helpBtn.nextSibling);

        const aboutModal = document.createElement('div');
        aboutModal.id = 'about-modal';
        aboutModal.className = 'absolute top-full right-0 mt-2 z-50 w-80 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl p-6 hidden';
        aboutModal.innerHTML = `
                <div class="text-center">
                    <div class="w-12 h-12 bg-blue-100 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i class="fas fa-info text-xl"></i>
                    </div>
                    <h3 class="text-lg font-bold mb-2">About Combine+</h3>
                    <p class="text-sm text-[var(--text-sub)] mb-1">This App. was designed by Khalid Ghaith and Gemini</p>
                    <p class="text-xs text-[var(--text-sub)] opacity-70">Version ${appVersion}</p>
                </div>
        `;
        helpBtn.parentNode.appendChild(aboutModal);
    }

    const selectionBox = document.createElement('div');
    selectionBox.id = 'viewer-selection-box';
    selectionBox.className = 'absolute border-2 border-[var(--ring-color)] bg-[var(--ring-color)]/20 hidden z-50 pointer-events-none';
    dom.viewerViewport.appendChild(selectionBox);

    // --- REWRITTEN & CENTRALIZED DRAG-AND-DROP LOGIC ---
    let dragSource = null;
    let dropTarget = null;

    function handleDragStart(e) {
        e.stopPropagation();
        const id = this.dataset.id;
        if (!state.selected.has(id)) {
            state.selected.clear();
            state.selected.add(id);
            updateSelectionVisuals();
        }
        activeDrag = { type: 'internal' };
        dragSource = {
            type: this.dataset.type,
            parentIdx: parseInt(this.dataset.parentIdx ?? this.dataset.idx),
            pageIdx: this.dataset.pageIdx !== undefined ? parseInt(this.dataset.pageIdx) : null,
            selectedIds: Array.from(state.selected)
        };
        e.dataTransfer.setData('application/x-combine-plus-internal', 'true');
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => this.classList.add('dragging'), 0);
    }

    function handleDragEnd(e) {
        if (activeDrag && activeDrag.type === 'internal') {
            this.classList.remove('dragging');
            resetMarkers();
            document.querySelectorAll('.drop-target-bg').forEach(el => el.classList.remove('drop-target-bg'));
        }
        activeDrag = null;
        dragSource = null;
        dropTarget = null;
    }

    function handleItemReorderDragOver(e) {
        if (!dragSource) return;
        resetMarkers();
        document.querySelectorAll('.drop-target-bg').forEach(el => el.classList.remove('drop-target-bg'));
        if (state.view === 'grid') {
            gridDragOver(e);
        } else {
            listDragOver(e);
        }
    }

    function handleItemReorderDrop(e) {
        resetMarkers();
        document.querySelectorAll('.drop-target-bg').forEach(el => el.classList.remove('drop-target-bg'));

        if (!dropTarget || !dragSource) return;

        try {
            saveState();
            const idsToMove = new Set(dragSource.selectedIds);
            const itemsToMove = [];
            const originalTopLevelIndices = [];

            for (let i = state.items.length - 1; i >= 0; i--) {
                const item = state.items[i];
                if (item.pages) {
                    for (let j = item.pages.length - 1; j >= 0; j--) {
                        if (idsToMove.has(item.pages[j].id)) {
                            itemsToMove.unshift(item.pages.splice(j, 1)[0]);
                        }
                    }
                }
                if (idsToMove.has(item.id)) {
                    originalTopLevelIndices.unshift(i);
                    itemsToMove.unshift(state.items.splice(i, 1)[0]);
                }
            }

            let destIdx = dropTarget.destIdx;
            if (dropTarget.action.includes('reorder')) {
                const itemsBeforeDrop = originalTopLevelIndices.filter(i => i < dropTarget.destIdx).length;
                destIdx -= itemsBeforeDrop;
            }

            if (dropTarget.action.includes('insert-into-container')) {
                const container = state.items[destIdx];
                if (container) {
                    const pagesToAdd = [];
                    itemsToMove.forEach(movedItem => {
                        if (movedItem.pages) pagesToAdd.push(...movedItem.pages);
                        else pagesToAdd.push(movedItem);
                    });
                    container.pages.splice(dropTarget.innerIdx, 0, ...pagesToAdd);
                    container.expanded = true;
                    container.isMultiPage = true;
                }
            } else if (dropTarget.action.includes('reorder')) {
                const newItems = itemsToMove.map(movedItem => {
                    if (movedItem.pages) return movedItem;
                    const page = movedItem;
                    return {
                        id: 'loose_' + Date.now() + Math.random().toString(36).substr(2, 5),
                        type: page.type || 'page', name: page.name || 'Page',
                        expanded: true, isMultiPage: false,
                        color: page.originalColor, thumbBg: page.originalThumbBg,
                        pages: [page]
                    };
                }).filter(Boolean);
                if (newItems.length > 0) state.items.splice(destIdx, 0, ...newItems);
            }
            state.selected.clear();
            render();
        } catch (err) {
            console.error("Drop Error:", err);
            render();
        } finally {
            dragSource = null;
            dropTarget = null;
        }
    }

    function handleWindowDragEnter(e) {
        e.preventDefault();
        e.stopPropagation();
        // If a drag is already active (e.g., internal drag), do nothing.
        if (activeDrag) return;

        // Check if files are being dragged from the OS.
        if (e.dataTransfer.types.includes('Files')) {
            activeDrag = { type: 'external' };
            dom.mainScroll.classList.add('border-dashed', 'border-4', 'border-[var(--ring-color)]', 'border-opacity-50');
        }
    }

    function handleWindowDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!activeDrag) return;

        if (activeDrag.type === 'external') {
            e.dataTransfer.dropEffect = 'copy'; // Show the "copy" cursor.
        } else if (activeDrag.type === 'internal') {
            handleItemReorderDragOver(e); // Delegate to the reordering logic.
        }
    }

    function handleWindowDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        // If the mouse leaves the window, reset the drag state.
        if (e.relatedTarget === null || e.relatedTarget.nodeName === "HTML") {
            if (activeDrag && activeDrag.type === 'external') {
                dom.mainScroll.classList.remove('border-dashed', 'border-4', 'border-[var(--ring-color)]', 'border-opacity-50');
            }
            activeDrag = null;
        }
    }

    function handleWindowDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!activeDrag) return;

        dom.mainScroll.classList.remove('border-dashed', 'border-4', 'border-[var(--ring-color)]', 'border-opacity-50');

        if (activeDrag.type === 'external') {
            const files = Array.from(e.dataTransfer.files).filter(f => !state.items.some(item => item.name === f.name));
            if (files.length > 0) {
                const inputs = isElectron ? files.map(f => f.path) : files;
                processFiles(inputs, isElectron ? 'electron' : 'browser');
            }
        } else if (activeDrag.type === 'internal') {
            handleItemReorderDrop(e); // Delegate to the reordering logic.
        }
        activeDrag = null; // Finalize and reset drag state.
    }

    // The internal reorder drag listeners are now handled by the centralized
    // window drag handlers, which delegate to handleItemReorderDragOver and handleItemReorderDrop.
    // Attach the new centralized drag handlers to the main app window.
    dom.window.addEventListener('dragenter', handleWindowDragEnter);
    dom.window.addEventListener('dragover', handleWindowDragOver);
    dom.window.addEventListener('dragleave', handleWindowDragLeave);
    dom.window.addEventListener('drop', handleWindowDrop);

    // --- TOUCH DRAG SUPPORT ---
    let touchDragTimer = null;
    let touchStartItem = null;

    function initTouchSupport() {
        const touchHandler = (e) => {
            const target = e.target.closest('.selectable-item');
            if (!target) return;
            // Prevent drag if touching a button or input
            if (e.target.closest('button') || e.target.closest('input')) return;
            if (!target.draggable && !target.dataset.type) return;

            touchStartItem = target;
            const touch = e.touches[0];

            if (touchDragTimer) clearTimeout(touchDragTimer);
            touchDragTimer = setTimeout(() => startTouchDrag(target, touch), 300);
        };

        const moveHandler = (e) => {
            if (touchDragTimer && !activeDrag) {
                clearTimeout(touchDragTimer);
                touchDragTimer = null;
                touchStartItem = null;
            }
            if (activeDrag && activeDrag.type === 'internal') {
                if (e.cancelable) e.preventDefault();
                const touch = e.touches[0];
                const elementUnder = document.elementFromPoint(touch.clientX, touch.clientY);
                handleItemReorderDragOver({
                    preventDefault: () => { },
                    stopPropagation: () => { },
                    target: elementUnder || document.body,
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
            }
        };

        const endHandler = (e) => {
            if (touchDragTimer) { clearTimeout(touchDragTimer); touchDragTimer = null; }
            if (activeDrag && activeDrag.type === 'internal') {
                if (e.cancelable) e.preventDefault();
                handleItemReorderDrop({ preventDefault: () => { }, stopPropagation: () => { } });
                if (touchStartItem) {
                    touchStartItem.classList.remove('dragging');
                    touchStartItem.style.pointerEvents = '';
                }
                touchStartItem = null;
                activeDrag = null;
                dragSource = null;
                dropTarget = null;
                resetMarkers();
                document.querySelectorAll('.drop-target-bg').forEach(el => el.classList.remove('drop-target-bg'));
            }
        };

        dom.gridView.addEventListener('touchstart', touchHandler, { passive: true });
        dom.listView.addEventListener('touchstart', touchHandler, { passive: true });
        window.addEventListener('touchmove', moveHandler, { passive: false });
        window.addEventListener('touchend', endHandler);
        window.addEventListener('touchcancel', endHandler);
    }

    function startTouchDrag(target, touch) {
        const id = target.dataset.id;
        if (!state.selected.has(id)) { state.selected.clear(); state.selected.add(id); updateSelectionVisuals(); }
        activeDrag = { type: 'internal' };
        dragSource = { type: target.dataset.type, parentIdx: parseInt(target.dataset.parentIdx ?? target.dataset.idx), pageIdx: target.dataset.pageIdx !== undefined ? parseInt(target.dataset.pageIdx) : null, selectedIds: Array.from(state.selected) };
        target.classList.add('dragging');
        target.style.pointerEvents = 'none';
        const elementUnder = document.elementFromPoint(touch.clientX, touch.clientY);
        handleItemReorderDragOver({ preventDefault: () => { }, stopPropagation: () => { }, target: elementUnder || document.body, clientX: touch.clientX, clientY: touch.clientY });
    }
    initTouchSupport();

    // --- TOUCH GESTURES (ZOOM & PAN) ---
    let gesture = { active: false, startDist: 0, startScale: 1, startCols: 3, startX: 0, startY: 0 };

    window.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2 && !activeDrag) {
            // Cancel potential drag reorder from single touch
            if (touchDragTimer) { clearTimeout(touchDragTimer); touchDragTimer = null; }
            if (touchStartItem) touchStartItem = null;

            gesture.active = true;
            gesture.startDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            gesture.startX = centerX;
            gesture.startY = centerY;

            if (state.viewer.isOpen) {
                gesture.startScale = state.viewer.scale;
            } else if (state.view === 'grid') {
                gesture.startCols = state.gridCols;
            }
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (!gesture.active || e.touches.length !== 2) return;
        if (e.cancelable) e.preventDefault();

        const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

        if (state.viewer.isOpen) {
            // Viewer Zoom
            const scaleChange = dist / gesture.startDist;
            let newScale = gesture.startScale * scaleChange;
            newScale = Math.max(0.0008, Math.min(newScale, 64.0));

            const oldScale = state.viewer.scale;
            const scaleRatio = newScale / oldScale;
            const rect = dom.viewerViewport.getBoundingClientRect();

            // Calculate the point under the previous center (relative to content)
            const pX = gesture.startX - rect.left + dom.viewerViewport.scrollLeft;
            const pY = gesture.startY - rect.top + dom.viewerViewport.scrollTop;

            setViewerScale(newScale);

            // Adjust scroll to keep that point under the new center
            dom.viewerViewport.scrollLeft = (pX * scaleRatio) - (centerX - rect.left);
            dom.viewerViewport.scrollTop = (pY * scaleRatio) - (centerY - rect.top);

            gesture.startX = centerX;
            gesture.startY = centerY;
        } else if (state.view === 'grid') {
            // Grid Zoom
            const scaleChange = dist / gesture.startDist;
            let newCols = gesture.startCols;

            if (scaleChange > 1.5) newCols = Math.max(1, gesture.startCols - 1);
            else if (scaleChange > 2.0) newCols = Math.max(1, gesture.startCols - 2);
            else if (scaleChange < 0.66) newCols = Math.min(8, gesture.startCols + 1);
            else if (scaleChange < 0.5) newCols = Math.min(8, gesture.startCols + 2);

            if (newCols !== state.gridCols) {
                state.gridCols = newCols;
                persistSettings();
                renderGrid();
            }
        }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            gesture.active = false;
        }
    });

    // --- EVENT LISTENERS ---
    dom.fileInput.addEventListener('change', handleBrowserFileSelect);
    document.addEventListener('keydown', (e) => {
        if (state.viewer.isOpen) {
            if (e.key === 'Escape') closeViewer();
            if (e.key === 'ArrowLeft') viewerPrevPage();
            if (e.key === 'ArrowRight') viewerNextPage();
            if (e.key === '+' || (e.ctrlKey && e.key === '=')) { e.preventDefault(); viewerZoomIn(); }
            if (e.key === '-' || (e.ctrlKey && e.key === '-')) { e.preventDefault(); viewerZoomOut(); }
            if (e.key.toLowerCase() === 'w') { e.preventDefault(); viewerFitToWidth(); }
            if (e.key.toLowerCase() === 'f') { e.preventDefault(); viewerFitPage(); }
            if ((e.key === '0' || e.key === 'Numpad0') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setViewerScale(1.0); }
            return; // Block other shortcuts when viewer is open
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            switchView(state.view === 'grid' ? 'list' : 'grid');
            return;
        }

        // Modal Handling
        if (!dom.resetModal.classList.contains('hidden')) {
            const buttons = dom.resetModal.querySelectorAll('button');
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                if (document.activeElement === buttons[0]) buttons[1].focus();
                else buttons[0].focus();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (document.activeElement === buttons[0] || document.activeElement === buttons[1]) {
                    document.activeElement.click();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeResetModal();
            }
            return;
        }

        if (!dom.messageModal.classList.contains('hidden')) {
            if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                closeMessageModal();
            }
            return;
        }

        // Input protection
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // Delete
        if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected.size > 0) {
            e.preventDefault();
            deleteSelected();
            return;
        }

        // Undo / Redo
        if ((e.ctrlKey || e.metaKey)) {
            if (e.key === 'z') { e.preventDefault(); undo(); return; }
            else if (e.key === 'y') { e.preventDefault(); redo(); return; }
        }

        // --- NEW KEYBOARD CONTROLS ---

        // Ctrl + Shift + R > Reset
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'r') {
            e.preventDefault();
            resetApp();
            return;
        }

        // Ctrl + R > Rotate page (Selected)
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'r') {
            e.preventDefault();
            rotateSelected();
            return;
        }

        // Ctrl + D > Duplicate
        if (e.ctrlKey && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            if (state.lastSelectedId) duplicateItem(state.lastSelectedId);
            return;
        }

        // Ctrl + O > Add Files
        if (e.ctrlKey && e.key.toLowerCase() === 'o') {
            e.preventDefault();
            handleAddFiles();
            return;
        }

        // Ctrl + S > Export
        if (e.ctrlKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            exportPdf();
            return;
        }

        // Ctrl + Arrows > Move page to next or previous
        if (e.ctrlKey && e.key.startsWith('Arrow')) {
            e.preventDefault();
            const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
            moveSelected(dir);
            return;
        }

        // Arrows > Select next item (Linear navigation)
        if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.startsWith('Arrow')) {
            e.preventDefault();

            if (state.view === 'grid' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                navigateGrid(e.key, e.shiftKey);
                return;
            }

            const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
            navigateSelection(dir, e.shiftKey);
            return;
        }
    });

    document.addEventListener('paste', async (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.clipboardData && e.clipboardData.files.length > 0) {
            e.preventDefault();
            const files = Array.from(e.clipboardData.files);

            if (isElectron) {
                const inputs = [];
                for (const f of files) {
                    if (f.path) {
                        if (!state.items.some(item => item.name === f.name)) inputs.push(f.path);
                    } else {
                        try {
                            const buffer = Buffer.from(await f.arrayBuffer());
                            const ext = f.type ? f.type.split('/')[1] : 'png';
                            const tempPath = path.join(os.tmpdir(), `pasted_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.${ext}`);
                            fs.writeFileSync(tempPath, buffer);
                            inputs.push(tempPath);
                        } catch (err) { console.error("Paste error:", err); }
                    }
                }
                if (inputs.length > 0) processFiles(inputs, 'electron');
            } else {
                const valid = files.filter(f => !state.items.some(item => item.name === f.name));
                if (valid.length > 0) processFiles(valid, 'browser');
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (!dom.settingsModal.classList.contains('hidden')) {
            if (!dom.settingsModal.contains(e.target) && !document.getElementById('btn-settings').contains(e.target)) {
                dom.settingsModal.classList.add('hidden');
            }
        }
        if (!dom.helpModal.classList.contains('hidden')) {
            if (!dom.helpModal.contains(e.target) && !document.getElementById('btn-help').contains(e.target)) {
                dom.helpModal.classList.add('hidden');
            }
        }
        const am = document.getElementById('about-modal');
        if (am && !am.classList.contains('hidden')) {
            const btn = document.getElementById('btn-about');
            if (!am.contains(e.target) && (!btn || !btn.contains(e.target))) {
                am.classList.add('hidden');
            }
        }
        const listCtx = document.getElementById('list-context-menu');
        if (listCtx && !listCtx.classList.contains('hidden')) {
            if (!listCtx.contains(e.target)) {
                listCtx.classList.add('hidden');
            }
        }
    });

    document.addEventListener('contextmenu', (e) => {
        if (state.view === 'list') {
            const listCtx = document.getElementById('list-context-menu');
            if (listCtx) {
                e.preventDefault();
                listCtx.style.left = `${e.pageX}px`;
                listCtx.style.top = `${e.pageY}px`;
                listCtx.classList.remove('hidden');
            }
        }
    });

    // --- GRID DENSITY & RESIZE HANDLING ---
    function updateGridDensity() {
        if (state.view !== 'grid') return;
        const width = dom.gridView.clientWidth;
        if (width === 0) return;
        const colWidth = width / state.gridCols;
        const hide = colWidth < 240;
        dom.gridView.querySelectorAll('.item-name').forEach(el => {
            el.classList.toggle('hidden', hide);
        });
        dom.gridView.querySelectorAll('.item-icon').forEach(el => {
            el.classList.toggle('hidden', hide);
        });
        const hideInfo = colWidth < 200;
        dom.gridView.querySelectorAll('.item-info').forEach(el => {
            el.classList.toggle('hidden', hideInfo);
        });
    }
    window.addEventListener('resize', updateGridDensity);

    document.addEventListener('wheel', (e) => {
        // 1. Viewer Mode: Handle Zoom, Prevent ALL other scrolling
        if (state.viewer.isOpen) {
            e.preventDefault();
            e.stopPropagation();

            // Only zoom if hovering the viewport (not toolbar)
            if (dom.viewerViewport.contains(e.target)) {
                const deltaVal = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                if (deltaVal === 0) return;

                const rect = dom.viewerContent.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return;
                const viewportRect = dom.viewerViewport.getBoundingClientRect();

                // Calculate mouse position relative to the content
                const offsetX = e.clientX - rect.left;
                const offsetY = e.clientY - rect.top;

                // Calculate relative position (unclamped to allow zooming towards outside)
                const percX = offsetX / rect.width;
                const percY = offsetY / rect.height;

                // Enhanced Zoom: Smooth exponential zoom
                const zoomIntensity = 0.0015;
                const oldScale = state.viewer.scale;

                // Clamp delta to avoid massive jumps on fast scroll
                const clampedDelta = Math.max(-200, Math.min(200, deltaVal));

                let newScale = oldScale * Math.exp(-clampedDelta * zoomIntensity);
                newScale = Math.max(0.0008, Math.min(newScale, 64.0));

                // Prevent drift at limits
                if (Math.abs(newScale - oldScale) < 0.00001) return;

                setViewerScale(newScale);

                // Force reflow to ensure the browser acknowledges the new size for scrolling
                // This prevents the scroll position from being clamped to the old, smaller size
                dom.viewerContent.offsetHeight;

                // Calculate new dimensions based on base dims (Source of Truth) to prevent drift
                const rotation = state.viewer.rotation || 0;
                const isRotated = rotation % 180 !== 0;
                const baseW = isRotated ? viewerBaseDims.h : viewerBaseDims.w;
                const baseH = isRotated ? viewerBaseDims.w : viewerBaseDims.h;

                const newWidth = baseW * newScale;
                const newHeight = baseH * newScale;

                // Adjust scroll to keep the point under the mouse
                // We calculate a 'virtual' scroll position that accounts for CSS centering (margin: auto)
                const viewportW = dom.viewerViewport.clientWidth;
                const viewportH = dom.viewerViewport.clientHeight;

                let oldScrollX = dom.viewerViewport.scrollLeft;
                let oldScrollY = dom.viewerViewport.scrollTop;

                if (rect.width < viewportW) oldScrollX = -(viewportW - rect.width) / 2;
                if (rect.height < viewportH) oldScrollY = -(viewportH - rect.height) / 2;

                dom.viewerViewport.scrollLeft = oldScrollX + percX * (newWidth - rect.width);
                dom.viewerViewport.scrollTop = oldScrollY + percY * (newHeight - rect.height);
            }
            return;
        }

        // 2. Grid View: Ctrl+Scroll to zoom grid
        if (e.ctrlKey && state.view === 'grid') {
            e.preventDefault();
            if (e.deltaY < 0) {
                state.gridCols = Math.max(1, state.gridCols - 1);
            } else {
                const nextCols = state.gridCols + 1;
                // Limit scaling: Don't allow columns to get smaller than ~140px
                if (dom.gridView.clientWidth / nextCols < 140) return;
                state.gridCols = Math.min(8, nextCols);
            }
            persistSettings();
            renderGrid();
        }
    }, { passive: false });

    // --- PERSISTENCE FUNCTIONS ---
    function persistSettings() {
        localStorage.setItem('combine-app-settings', JSON.stringify({
            theme: state.theme, view: state.view, resizeToFit: state.resizeToFit, gridCols: state.gridCols, keepExpanded: state.keepExpanded
        }));
    }

    window.toggleResizeSetting = function () {
        state.resizeToFit = document.getElementById('resize-chk').checked;
        persistSettings();
    }

    window.toggleKeepExpanded = function () {
        state.keepExpanded = document.getElementById('keep-expanded-chk').checked;
        persistSettings();
    }

    // --- HISTORY MANAGEMENT ---
    function getSnapshot() {
        return JSON.stringify(state.items.map(item => {
            const { pages, ...restItem } = item;
            const cleanPages = pages.map(p => {
                const { thumbSrc, ...restPage } = p;
                return restPage;
            });
            return { ...restItem, pages: cleanPages };
        }));
    }

    function saveState() {
        state.history.push(getSnapshot());
        state.future = [];
        if (state.history.length > 50) state.history.shift();
        updateToolbarState();
    }

    function applyState(itemsJson) {
        state.selected.clear();
        state.lastSelectedId = null;
        state.items = JSON.parse(itemsJson);
        render();
        updateToolbarState();
    }

    window.undo = function () {
        if (state.history.length <= 1) return;
        state.future.push(getSnapshot());
        const previousState = state.history.pop();
        applyState(previousState);
    }

    window.redo = function () {
        if (state.future.length === 0) return;
        state.history.push(getSnapshot());
        const nextState = state.future.pop();
        applyState(nextState);
    }

    function updateToolbarState() {
        document.getElementById('undo-btn').disabled = state.history.length <= 1;
        document.getElementById('redo-btn').disabled = state.future.length === 0;
    }

    // --- FILE HANDLING ---
    window.handleAddFiles = async function () {
        saveState();
        const initialItemCount = state.items.length;
        let filesProcessed = false;

        if (isElectron) {
            try {
                const paths = await ipcRenderer.invoke('select-files');
                if (paths && paths.length > 0) {
                    await processFiles(paths, 'electron');
                    filesProcessed = true;
                }
            } catch (e) {
                console.error(e);
                showMessageModal("Error", e.message, true);
            }
        } else {
            dom.fileInput.click();
        }

        if (!filesProcessed && state.items.length === initialItemCount) {
            if (state.history.length > 1) state.history.pop();
            else if (state.history.length === 1 && initialItemCount === 0) { state.history = []; state.history.push(JSON.stringify(state.items)); }
            updateToolbarState();
        }
    }

    function handleBrowserFileSelect(e) {
        const files = Array.from(e.target.files);
        if (files.length > 0) processFiles(files, 'browser').then(() => { e.target.value = ''; });
    }

    async function processFiles(inputs, source) {
        if (inputs.length === 0) return;

        const initialItemCount = state.items.length;

        for (const input of inputs) {
            let filePath, fileName, pageCount, type;

            if (source === 'electron') {
                try {
                    filePath = input;
                    fileName = filePath.split(/[/\\]/).pop();

                    let pdfDoc = pdfDocCache[filePath];
                    if (!pdfDoc) {
                        const loadingTask = pdfjsLib.getDocument(filePath);
                        pdfDoc = await loadingTask.promise;
                        pdfDocCache[filePath] = pdfDoc; // Cache the document
                    }
                    pageCount = pdfDoc.numPages;
                    // Determine type based on file extension as a robust fallback
                    const extension = fileName.split('.').pop().toLowerCase();
                    type = ['pdf'].includes(extension) ? 'file' : 'img';
                } catch (e) {
                    console.error("Fallback scanning for:", input, e);
                    // Fallback for non-PDFs or if scan fails
                    pageCount = 1;
                    type = 'img';
                }
            } else {
                filePath = URL.createObjectURL(input);
                fileName = input.name;
                type = input.type.includes('pdf') ? 'file' : 'img';
                let pdfDoc = pdfDocCache[filePath];
                if (!pdfDoc) {
                    const loadingTask = pdfjsLib.getDocument(filePath);
                    pdfDoc = await loadingTask.promise;
                    pdfDocCache[filePath] = pdfDoc; // Cache the document
                }
                pageCount = pdfDoc.numPages;
            }

            const fileId = 'f_' + Date.now() + Math.random().toString(36).substr(2, 9);
            const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500'];
            const thumbBgs = ['bg-red-50', 'bg-blue-50', 'bg-green-50', 'bg-purple-50', 'bg-orange-50'];
            const colorIdx = state.items.length % colors.length;

            const newPages = [];
            for (let i = 0; i < pageCount; i++) {
                newPages.push({
                    id: fileId + '_p' + i,
                    name: type === 'file' ? `Page ${i + 1}` : fileName,
                    type: type,
                    rot: 0,
                    originalFileId: fileId,
                    originalIndex: i,
                    path: filePath,
                    originalColor: colors[colorIdx],
                    originalThumbBg: thumbBgs[colorIdx]
                });
            }

            if (newPages.length > 0) {
                state.items.push({
                    id: fileId, type: type, name: fileName, path: filePath,
                    expanded: true, isMultiPage: type === 'file',
                    color: colors[colorIdx], thumbBg: thumbBgs[colorIdx],
                    pages: newPages
                });
            }
        }
        if (state.items.length > initialItemCount) {
            saveState(); render();
        }
    }

    window.electronProcessFiles = processFiles;
    if (pendingFiles.length > 0) {
        processFiles(pendingFiles, 'electron');
        pendingFiles = [];
    }

    // --- EXPORT LOGIC ---
    window.exportPdf = async function () {
        if (state.items.length === 0) return;
        const btn = document.getElementById('export-btn');

        if (isElectron) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            btn.disabled = true;
            try {
                let savePath = await ipcRenderer.invoke('save-file-dialog');

                // Handle Electron dialog result object if returned directly
                if (savePath && typeof savePath === 'object' && 'canceled' in savePath) {
                    if (savePath.canceled) return;
                    savePath = savePath.filePath;
                }

                // If the user cancels the dialog, savePath will be falsy.
                if (!savePath) {
                    return; // Exit without showing any modal. The 'finally' block will still run.
                }
                const exportList = [];
                state.items.forEach(item => {
                    if (item.pages) {
                        item.pages.forEach(p => {
                            exportList.push({ path: p.path, originalIndex: p.originalIndex, rot: p.rot, type: p.type });
                        });
                    }
                });

                const metadata = {
                    title: document.getElementById('meta-title').value,
                    author: document.getElementById('meta-author').value
                };

                const result = await ipcRenderer.invoke('merge-files', {
                    items: exportList, outputPath: savePath, metadata, resizeToFit: state.resizeToFit
                });

                if (result.success) {
                    if (result.failedFiles && result.failedFiles.length > 0) {
                        const list = result.failedFiles.map(f => `• ${f}`).join('\n');
                        showMessageModal('Completed with Issues', `Saved successfully, but the following files were skipped due to errors (e.g., encryption):\n${list}`, true);
                    } else {
                        showMessageModal('Success', 'File saved successfully.', false);
                    }
                }
                else showMessageModal('Error', result.error, true);

            } catch (e) {
                // The cancellation case is handled above, so any error here is a real processing error.
                showMessageModal('Export Error', e.message, true);
            } finally {
                btn.innerHTML = '<i class="fas fa-download transition-transform duration-300 hover:scale-110"></i>';
                btn.disabled = false;
            }
        } else {
            showMessageModal('Browser Preview', "Export is simulated in browser preview.", false);
        }
    }

    // --- UI ACTIONS ---
    window.toggleSettings = function () { dom.settingsModal.classList.toggle('hidden'); dom.helpModal.classList.add('hidden'); }
    window.toggleSettings = function () {
        dom.settingsModal.classList.toggle('hidden');
        dom.helpModal.classList.add('hidden');
        const am = document.getElementById('about-modal'); if (am) am.classList.add('hidden');
    }
    window.toggleHelp = function () {
        dom.helpModal.classList.toggle('hidden');
        dom.settingsModal.classList.add('hidden');
        const am = document.getElementById('about-modal'); if (am) am.classList.add('hidden');
    }
    window.toggleAbout = function () {
        const am = document.getElementById('about-modal');
        if (am) {
            am.classList.toggle('hidden');
            dom.settingsModal.classList.add('hidden');
            dom.helpModal.classList.add('hidden');
        }
    }

    window.toggleTheme = function () {
        const isLight = document.body.classList.contains('theme-light');
        state.theme = isLight ? 'dark' : 'light';
        document.body.className = `theme-${state.theme}`;
        document.getElementById('app-window').className = `theme-${state.theme} relative`;
        document.getElementById('theme-icon').className = isLight ? 'fas fa-sun text-xs' : 'fas fa-moon text-xs';
        persistSettings();
    }

    window.switchView = function (mode) {
        state.view = mode;
        state.expandedContainerId = null;
        persistSettings();
        render();
    }

    window.toggleContainerExpansion = function (id, e) {
        if (e) e.stopPropagation();
        state.expandedContainerId = (state.expandedContainerId === id) ? null : id;
        render();
    }
    window.toggleExpandList = function (idx) {
        state.items[idx].expanded = !state.items[idx].expanded;
        render();
    }

    window.expandAllToggles = function () {
        if (state.items) {
            state.items.forEach(item => {
                if (item.isMultiPage) item.expanded = true;
            });
            render();
        }
        document.getElementById('list-context-menu')?.classList.add('hidden');
    }

    window.collapseAllToggles = function () {
        if (state.items) {
            state.items.forEach(item => {
                if (item.isMultiPage) item.expanded = false;
            });
            render();
        }
        document.getElementById('list-context-menu')?.classList.add('hidden');
    }

    window.rotatePage = function (pageId, e) {
        if (e) e.stopPropagation();
        saveState();
        let targets = Array.from(state.selected);
        if (!targets.includes(pageId)) targets.push(pageId);
        let changed = false;
        for (let item of state.items) {
            for (let p of item.pages) {
                if (targets.includes(p.id) || targets.includes(item.id)) {
                    p.rot = (p.rot + 90) % 360;
                    p.thumbSrc = null;
                    changed = true;
                }
            }
        }
        if (changed) render();
    }

    window.duplicateItem = function (id, e) {
        if (e) e.stopPropagation();
        saveState();
        let targets = Array.from(state.selected);
        if (!targets.includes(id)) targets.push(id);
        let changed = false;

        for (let targetId of targets) {
            const itemIdx = state.items.findIndex(item => item.id === targetId);
            if (itemIdx !== -1) {
                const originalItem = state.items[itemIdx];
                const newItemId = 'copy_f_' + Date.now() + Math.random().toString(36).substr(2, 5);
                const newPages = originalItem.pages.map(p => ({
                    ...p, id: 'copy_p_' + Date.now() + Math.random().toString(36).substr(2, 5) + '_' + Math.random().toString(36).substr(2, 3),
                    originalFileId: newItemId
                }));
                const newItem = { ...originalItem, id: newItemId, pages: newPages };
                state.items.splice(itemIdx + 1, 0, newItem);
                changed = true;
                continue;
            }

            for (let i = 0; i < state.items.length; i++) {
                const item = state.items[i];
                const pageIdx = item.pages.findIndex(p => p.id === targetId);
                if (pageIdx !== -1) {
                    if (!item.isMultiPage) {
                        const originalItem = item;
                        const newItemId = 'copy_f_' + Date.now() + Math.random().toString(36).substr(2, 5);
                        const newPages = originalItem.pages.map(p => ({
                            ...p, id: 'copy_p_' + Date.now() + Math.random().toString(36).substr(2, 5) + '_' + Math.random().toString(36).substr(2, 3),
                            originalFileId: newItemId
                        }));
                        const newItem = { ...originalItem, id: newItemId, pages: newPages };
                        state.items.splice(i + 1, 0, newItem);
                        changed = true;
                    } else {
                        const originalPage = item.pages[pageIdx];
                        const newPage = { ...originalPage, id: 'copy_p_' + Date.now() + Math.random().toString(36).substr(2, 5) };
                        item.pages.splice(pageIdx + 1, 0, newPage);
                        changed = true;
                    }
                    break;
                }
            }
        }
        if (changed) render();
        else { state.history.pop(); updateToolbarState(); }
    }

    window.revertPage = function (pageId, e) {
        if (e) e.stopPropagation();
        saveState();
        let targets = Array.from(state.selected);
        if (!targets.includes(pageId)) targets.push(pageId);
        let changed = false;

        for (let targetId of targets) {
            let pageData = null;

            outer: for (let i = state.items.length - 1; i >= 0; i--) {
                if (state.items[i].pages.length === 1 && state.items[i].pages[0].id === targetId && !state.items[i].isMultiPage) {
                    pageData = state.items[i].pages[0];
                    state.items.splice(i, 1);
                    break outer;
                }
                for (let j = state.items[i].pages.length - 1; j >= 0; j--) {
                    if (state.items[i].pages[j].id === targetId) {
                        pageData = state.items[i].pages[j];
                        state.items[i].pages.splice(j, 1);
                        break outer;
                    }
                }
            }
            if (!pageData) continue;

            const original = state.items.find(it => it.id === pageData.originalFileId);

            if (original) {
                let insertIndex = original.pages.findIndex(p => p.originalIndex > pageData.originalIndex);
                if (insertIndex === -1) insertIndex = original.pages.length;
                pageData.rot = 0; pageData.thumbSrc = null;
                original.pages.splice(insertIndex, 0, pageData);
                original.expanded = true; original.isMultiPage = true;
                changed = true;
            } else {
                const newLooseItem = {
                    id: 'restored_' + Date.now() + Math.random().toString(36).substr(2, 5),
                    type: pageData.type, name: pageData.name,
                    expanded: true, isMultiPage: false,
                    color: pageData.originalColor, thumbBg: pageData.originalThumbBg,
                    pages: [pageData]
                };
                pageData.rot = 0; pageData.thumbSrc = null;
                state.items.push(newLooseItem);
                changed = true;
            }
        }

        // Cleanup empty multi-page containers
        for (let i = state.items.length - 1; i >= 0; i--) {
            if (state.items[i].isMultiPage && state.items[i].pages.length === 0) {
                state.items.splice(i, 1);
            }
        }

        if (changed) render();
        else { state.history.pop(); updateToolbarState(); }
    }

    function pruneCache() {
        const activePaths = new Set();
        state.items.forEach(item => {
            if (item.path) activePaths.add(item.path);
            if (item.pages) {
                item.pages.forEach(p => {
                    if (p.path) activePaths.add(p.path);
                });
            }
        });

        Object.keys(pdfDocCache).forEach(path => {
            if (!activePaths.has(path)) {
                if (pdfDocCache[path] && typeof pdfDocCache[path].destroy === 'function') {
                    pdfDocCache[path].destroy();
                }
                delete pdfDocCache[path];
            }
        });
    }

    window.deleteSelected = function () {
        if (state.selected.size === 0) return;
        saveState();
        const selectedIds = Array.from(state.selected);
        const toDelete = [];
        state.items.forEach((item, i) => {
            if (selectedIds.includes(item.id)) { toDelete.push({ type: 'file', idx: i }); return; }
            const pagesToDelete = [];
            item.pages.forEach((p, pIdx) => {
                if (selectedIds.includes(p.id)) pagesToDelete.push(pIdx);
            });
            if (pagesToDelete.length > 0) {
                if (pagesToDelete.length === item.pages.length) toDelete.push({ type: 'file', idx: i });
                else toDelete.push({ type: 'page', idx: i, pages: pagesToDelete });
            }
        });
        toDelete.sort((a, b) => b.idx - a.idx);
        toDelete.forEach(task => {
            if (task.type === 'file') state.items.splice(task.idx, 1);
            else task.pages.sort((a, b) => b - a).forEach(pIdx => state.items[task.idx].pages.splice(pIdx, 1));
        });
        state.selected.clear();
        state.lastSelectedId = null;
        pruneCache();
        render();
    }

    // --- VIEWER LOGIC ---
    let viewerPdfDoc = null;
    let viewerPage = null;
    let viewerRenderTask = null;
    let viewerBaseDims = { w: 0, h: 0 };

    window.openViewer = async function (pageId) {
        const pageObj = findPageObject(pageId);
        if (!pageObj) return;

        state.viewer.isOpen = true;
        state.viewer.pageId = pageId;
        state.viewer.scale = 1.0;
        state.viewer.rotation = pageObj.rot || 0;
        state.viewer.tool = 'pan';
        updateViewerCursor();

        // Find parent item to get context
        const parentItem = state.items.find(i => i.pages && i.pages.some(p => p.id === pageId));
        if (parentItem) state.viewer.itemId = parentItem.id;

        dom.viewerModal.classList.remove('hidden');
        dom.viewerModal.classList.add('bg-black/50');
        // Small delay to allow display:block to apply before opacity transition
        requestAnimationFrame(() => dom.viewerModal.classList.remove('opacity-0'));

        // Reset content
        dom.viewerContent.innerHTML = '';
        dom.viewerContent.style.width = '100%';
        dom.viewerContent.style.height = '100%';
        dom.viewerViewport.scrollTop = 0;
        dom.viewerViewport.scrollLeft = 0;

        await loadAndRenderViewer();
        if (window.viewerFitPage) {
            window.viewerFitPage();
        }
    }

    window.closeViewer = function () {
        state.viewer.isOpen = false;
        dom.viewerModal.classList.add('opacity-0');
        setTimeout(() => {
            dom.viewerModal.classList.add('hidden');
            dom.viewerContent.innerHTML = '';
            if (viewerRenderTask) { viewerRenderTask.cancel(); viewerRenderTask = null; }
            viewerPdfDoc = null;
            viewerPage = null;
            viewerBaseDims = { w: 0, h: 0 };
        }, 200);
    }

    window.viewerZoomIn = function () {
        let newScale = state.viewer.scale * 1.25;
        if (newScale > 64.0) newScale = 64.0; // Max 6400%
        setViewerScale(newScale);
    }

    window.viewerZoomOut = function () {
        let newScale = state.viewer.scale / 1.25;
        if (newScale < 0.0008) newScale = 0.0008; // Min 0.08%
        setViewerScale(newScale);
    }

    window.viewerFitToWidth = function () {
        if (!state.viewer.isOpen) return;

        const availableWidth = dom.viewerViewport.clientWidth - 48;
        let contentWidth = 0;

        if (viewerPage) {
            const rotation = ((viewerPage.rotate || 0) + (state.viewer.rotation || 0)) % 360;
            const viewport = viewerPage.getViewport({ scale: 1.0, rotation: rotation });
            contentWidth = viewport.width;
        } else {
            const rotation = state.viewer.rotation || 0;
            const isRotated = rotation % 180 !== 0;
            contentWidth = isRotated ? viewerBaseDims.h : viewerBaseDims.w;
        }

        if (contentWidth > 0) setViewerScale(availableWidth / contentWidth);
    }

    window.viewerFitPage = function () {
        if (!state.viewer.isOpen) return;

        const availableWidth = dom.viewerViewport.clientWidth - 48;
        const availableHeight = dom.viewerViewport.clientHeight - 48;

        let contentWidth = 0;
        let contentHeight = 0;

        if (viewerPage) {
            const rotation = ((viewerPage.rotate || 0) + (state.viewer.rotation || 0)) % 360;
            const viewport = viewerPage.getViewport({ scale: 1.0, rotation: rotation });
            contentWidth = viewport.width;
            contentHeight = viewport.height;
        } else {
            const rotation = state.viewer.rotation || 0;
            const isRotated = rotation % 180 !== 0;
            contentWidth = isRotated ? viewerBaseDims.h : viewerBaseDims.w;
            contentHeight = isRotated ? viewerBaseDims.w : viewerBaseDims.h;
        }

        if (contentWidth > 0 && contentHeight > 0) {
            const scaleX = availableWidth / contentWidth;
            const scaleY = availableHeight / contentHeight;
            setViewerScale(Math.min(scaleX, scaleY));
        }
    }

    function setViewerScale(s) {
        state.viewer.scale = s;
        dom.viewerScaleInput.value = Math.round(s * 100) + '%';

        if (viewerPage) {
            // Calculate new dimensions immediately for smooth zooming
            const rotation = ((viewerPage.rotate || 0) + (state.viewer.rotation || 0)) % 360;
            const viewport = viewerPage.getViewport({ scale: s, rotation: rotation });
            dom.viewerContent.style.width = `${viewport.width}px`;
            dom.viewerContent.style.height = `${viewport.height}px`;
            dom.viewerContent.style.maxWidth = 'none';
            dom.viewerContent.style.maxHeight = 'none';
            dom.viewerContent.style.minWidth = '0';
            dom.viewerContent.style.minHeight = '0';
            dom.viewerContent.style.flexShrink = '0';

            // Canvas is 100% w/h so it auto-resizes with container

            if (state.viewer.renderDebounce) clearTimeout(state.viewer.renderDebounce);
            state.viewer.renderDebounce = setTimeout(() => {
                renderViewerCanvas();
            }, 100);
        } else {
            const img = dom.viewerContent.querySelector('img');
            if (img) renderViewerImage(img);
        }
    }

    function updateViewerCursor() {
        if (state.viewer.tool === 'pan') {
            dom.viewerViewport.style.cursor = 'grab';
        } else if (state.viewer.tool === 'region') {
            dom.viewerViewport.style.cursor = 'crosshair';
        }
    }

    window.viewerToggleMode = function () {
        // Mode toggle removed as we are unifying the view logic
    }
    // Hide the mode button as it's no longer needed
    if (dom.viewerModeBtn) dom.viewerModeBtn.style.display = 'none';

    // Redesign Viewer Toolbar
    if (dom.viewerScaleInput && dom.viewerScaleInput.parentElement) {
        let toolbar = dom.viewerScaleInput.parentElement;

        // Move toolbar to root of viewer modal to detach it from any existing header structure
        // This fixes the "toolbar above another bar" issue by allowing us to hide the old header
        if (toolbar.parentElement !== dom.viewerModal) {
            const originalParent = toolbar.parentElement;
            dom.viewerModal.appendChild(toolbar);
            if (originalParent) originalParent.style.display = 'none';
        }

        // Apply floating capsule styles
        toolbar.className = "absolute top-6 left-1/2 transform -translate-x-1/2 flex items-center gap-3 px-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl rounded-full z-50 transition-all hover:scale-105 text-[var(--text-main)]";
        toolbar.innerHTML = '';

        // Page Counter
        dom.viewerCounter.className = "text-xs font-medium whitespace-nowrap text-[var(--text-sub)]";
        toolbar.appendChild(dom.viewerCounter);

        // Divider
        const div = document.createElement('div');
        div.className = "w-px h-4 bg-[var(--border)] mx-1";
        toolbar.appendChild(div);

        // Tool Toggle (Pan / Region)
        const btnRegion = document.createElement('button');
        btnRegion.id = 'btn-viewer-region';
        btnRegion.className = "w-8 h-8 rounded-full hover:bg-[var(--hover-bg)] flex items-center justify-center transition-colors text-[var(--text-sub)]";
        btnRegion.innerHTML = '<span class="relative flex items-center justify-center w-full h-full"><i class="far fa-square text-sm"></i><i class="fas fa-search absolute text-[10px] translate-x-0.5 translate-y-0.5"></i></span>';
        btnRegion.title = "Zoom to Region";
        btnRegion.onclick = () => {
            state.viewer.tool = state.viewer.tool === 'pan' ? 'region' : 'pan';
            btnRegion.classList.toggle('bg-[var(--ring-color)]', state.viewer.tool === 'region');
            btnRegion.classList.toggle('text-white', state.viewer.tool === 'region');
            updateViewerCursor();
        };
        toolbar.appendChild(btnRegion);

        // Controls
        const btnClass = "w-8 h-8 rounded-full hover:bg-[var(--hover-bg)] flex items-center justify-center transition-colors text-[var(--text-sub)]";

        const btnZoomOut = document.createElement('button');
        btnZoomOut.className = btnClass;
        btnZoomOut.innerHTML = '<i class="fas fa-minus"></i>';
        btnZoomOut.onclick = window.viewerZoomOut;
        toolbar.appendChild(btnZoomOut);

        dom.viewerScaleInput.className = "w-12 text-center bg-transparent text-sm font-mono focus:outline-none border-b border-transparent focus:border-[var(--ring-color)]";
        toolbar.appendChild(dom.viewerScaleInput);

        const btnZoomIn = document.createElement('button');
        btnZoomIn.className = btnClass;
        btnZoomIn.innerHTML = '<i class="fas fa-plus"></i>';
        btnZoomIn.onclick = window.viewerZoomIn;
        toolbar.appendChild(btnZoomIn);

        const btnFitWidth = document.createElement('button');
        btnFitWidth.className = btnClass;
        btnFitWidth.innerHTML = '<i class="fas fa-arrows-alt-h"></i>';
        btnFitWidth.onclick = window.viewerFitToWidth;
        btnFitWidth.title = "Fit Width (W)";
        toolbar.appendChild(btnFitWidth);

        const btnFitPage = document.createElement('button');
        btnFitPage.className = btnClass;
        btnFitPage.innerHTML = '<i class="fas fa-compress"></i>';
        btnFitPage.onclick = window.viewerFitPage;
        btnFitPage.title = "Fit Page (F)";
        toolbar.appendChild(btnFitPage);

        const btnClose = document.createElement('button');
        btnClose.className = "w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm ml-2";
        btnClose.innerHTML = '<i class="fas fa-times"></i>';
        btnClose.onclick = window.closeViewer;
        toolbar.appendChild(btnClose);
    }

    window.viewerPrevPage = function () { navigateViewer(-1); }
    window.viewerNextPage = function () { navigateViewer(1); }

    async function navigateViewer(dir) {
        // Flatten all pages into a single list for navigation
        const allPages = [];
        state.items.forEach(item => {
            if (item.pages) allPages.push(...item.pages);
        });

        const currentIdx = allPages.findIndex(p => p.id === state.viewer.pageId);
        if (currentIdx === -1) return;

        const newIdx = currentIdx + dir;
        if (newIdx >= 0 && newIdx < allPages.length) {
            state.viewer.pageId = allPages[newIdx].id;
            state.viewer.rotation = allPages[newIdx].rot;
            await loadAndRenderViewer();
            if (window.viewerFitPage) {
                window.viewerFitPage();
            }
        }
    }

    async function loadAndRenderViewer() {
        const pageObj = findPageObject(state.viewer.pageId);
        if (!pageObj) return;

        // dom.viewerFilename.innerText = pageObj.name;

        let globalIdx = 0, totalPages = 0;
        for (const item of state.items) {
            for (const p of item.pages) {
                totalPages++;
                if (p.id === pageObj.id) globalIdx = totalPages;
            }
        }
        dom.viewerCounter.innerText = `Page ${globalIdx} / ${totalPages}`;
        dom.viewerLoading.classList.remove('hidden');

        // Reset tasks
        if (viewerRenderTask) { viewerRenderTask.cancel(); viewerRenderTask = null; }
        viewerPage = null;

        try {
            const isPdf = pageObj.type === 'file' || (pageObj.path && pageObj.path.toLowerCase().endsWith('.pdf'));

            if (isPdf) {
                if (!pdfDocCache[pageObj.path]) {
                    const loadingTask = pdfjsLib.getDocument(pageObj.path);
                    pdfDocCache[pageObj.path] = await loadingTask.promise;
                }
                viewerPdfDoc = pdfDocCache[pageObj.path];
                viewerPage = await viewerPdfDoc.getPage(pageObj.originalIndex + 1);

                // Set base dims
                const viewport = viewerPage.getViewport({ scale: 1.0 });
                viewerBaseDims = { w: viewport.width, h: viewport.height };

                renderViewerCanvas();
            } else {
                // Image
                const img = new Image();
                img.src = pageObj.path;
                img.className = "select-none pointer-events-none block";
                await img.decode();
                viewerBaseDims = { w: img.naturalWidth, h: img.naturalHeight };
                renderViewerImage(img);
            }
        } catch (e) {
            console.error("Viewer Error:", e);
            dom.viewerContent.innerHTML = `<div class="text-red-500 p-4 bg-white rounded">Error: ${e.message}</div>`;
            dom.viewerLoading.classList.add('hidden');
        }
    }

    function renderViewerCanvas() {
        if (!viewerPage) return;

        if (viewerRenderTask) {
            viewerRenderTask.cancel();
            viewerRenderTask = null;
        }

        const rotation = ((viewerPage.rotate || 0) + (state.viewer.rotation || 0)) % 360;

        // Calculate max safe scale to prevent canvas crash (approx 16k limit)
        const MAX_CANVAS_DIM = 16384;
        const unscaledViewport = viewerPage.getViewport({ scale: 1.0, rotation: rotation });
        const maxScale = Math.min(MAX_CANVAS_DIM / unscaledViewport.width, MAX_CANVAS_DIM / unscaledViewport.height);

        // Use the smaller of requested scale or max safe scale for rendering
        const renderScale = Math.min(state.viewer.scale, maxScale);
        const renderViewport = viewerPage.getViewport({ scale: renderScale, rotation: rotation });
        const cssViewport = viewerPage.getViewport({ scale: state.viewer.scale, rotation: rotation });

        dom.viewerContent.style.width = `${cssViewport.width}px`;
        dom.viewerContent.style.height = `${cssViewport.height}px`;
        dom.viewerContent.style.maxWidth = 'none';
        dom.viewerContent.style.maxHeight = 'none';
        dom.viewerContent.style.minWidth = '0';
        dom.viewerContent.style.minHeight = '0';
        dom.viewerContent.style.flexShrink = '0';
        dom.viewerContent.style.position = 'relative';
        dom.viewerContent.style.margin = 'auto';

        // Double buffering: Create new canvas, render, then swap
        const canvas = document.createElement('canvas');
        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.maxWidth = 'none';
        canvas.style.maxHeight = 'none';
        canvas.className = "block absolute top-0 left-0";

        const renderContext = {
            canvasContext: canvas.getContext('2d'),
            viewport: renderViewport
        };

        viewerRenderTask = viewerPage.render(renderContext);
        viewerRenderTask.promise.then(() => {
            dom.viewerLoading.classList.add('hidden');
            viewerRenderTask = null;

            // Append new canvas and remove old content (old canvases or images)
            dom.viewerContent.appendChild(canvas);
            Array.from(dom.viewerContent.children).forEach(child => {
                if (child !== canvas) child.remove();
            });
        }).catch(() => { });
    }

    function renderViewerImage(img) {
        if (!dom.viewerContent.contains(img)) {
            dom.viewerContent.innerHTML = '';
            dom.viewerContent.appendChild(img);
        }

        const rotation = state.viewer.rotation || 0;
        const isRotated = rotation % 180 !== 0;

        const imgW = viewerBaseDims.w * state.viewer.scale;
        const imgH = viewerBaseDims.h * state.viewer.scale;

        const containerW = isRotated ? imgH : imgW;
        const containerH = isRotated ? imgW : imgH;

        dom.viewerContent.style.width = `${containerW}px`;
        dom.viewerContent.style.height = `${containerH}px`;
        dom.viewerContent.style.maxWidth = 'none';
        dom.viewerContent.style.maxHeight = 'none';
        dom.viewerContent.style.minWidth = '0';
        dom.viewerContent.style.minHeight = '0';
        dom.viewerContent.style.flexShrink = '0';
        dom.viewerContent.style.position = 'relative';
        dom.viewerContent.style.margin = 'auto';

        img.style.width = `${imgW}px`;
        img.style.height = `${imgH}px`;
        img.style.position = 'absolute';
        img.style.left = '50%';
        img.style.top = '50%';
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
        img.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;

        dom.viewerLoading.classList.add('hidden');
    }

    // --- VIEWER INTERACTION (Zoom & Pan) ---

    // Viewer Panning (Drag and Drop style)
    dom.viewerViewport.addEventListener('mousedown', (e) => {
        if (!state.viewer.isOpen) return;
        e.preventDefault();

        if (state.viewer.tool === 'pan') {
            state.viewer.isDragging = true;
            state.viewer.startX = e.clientX;
            state.viewer.startY = e.clientY;
            state.viewer.scrollLeft = dom.viewerViewport.scrollLeft;
            state.viewer.scrollTop = dom.viewerViewport.scrollTop;
            dom.viewerViewport.style.cursor = 'grabbing';
        } else if (state.viewer.tool === 'region') {
            state.viewer.selection = { startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY };
            selectionBox.style.left = (e.clientX - dom.viewerViewport.getBoundingClientRect().left + dom.viewerViewport.scrollLeft) + 'px';
            selectionBox.style.top = (e.clientY - dom.viewerViewport.getBoundingClientRect().top + dom.viewerViewport.scrollTop) + 'px';
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
            selectionBox.classList.remove('hidden');
        }
    });

    dom.viewerViewport.addEventListener('mouseleave', () => {
        if (state.viewer.isDragging) {
            state.viewer.isDragging = false;
            updateViewerCursor();
        }
        if (state.viewer.selection) {
            state.viewer.selection = null;
            selectionBox.classList.add('hidden');
        }
    });

    dom.viewerViewport.addEventListener('mouseup', () => {
        if (state.viewer.isDragging) {
            state.viewer.isDragging = false;
            updateViewerCursor();
        }
        if (state.viewer.selection) {
            // Commit Zoom
            const sel = state.viewer.selection;
            const x1 = Math.min(sel.startX, sel.currentX);
            const x2 = Math.max(sel.startX, sel.currentX);
            const y1 = Math.min(sel.startY, sel.currentY);
            const y2 = Math.max(sel.startY, sel.currentY);
            const w = x2 - x1;
            const h = y2 - y1;

            if (w > 10 && h > 10) {
                const rect = dom.viewerViewport.getBoundingClientRect();
                const scaleX = rect.width / w;
                const scaleY = rect.height / h;
                const factor = Math.min(scaleX, scaleY);
                const newScale = Math.min(64.0, state.viewer.scale * factor);

                // Center of selection relative to content
                const contentRect = dom.viewerContent.getBoundingClientRect();
                const cx = x1 + w / 2;
                const cy = y1 + h / 2;
                const contentX = cx - contentRect.left;
                const contentY = cy - contentRect.top;

                setViewerScale(newScale);
                dom.viewerContent.offsetHeight; // Force reflow

                // New scroll position
                const newScrollLeft = (contentX * factor) - (rect.width / 2);
                const newScrollTop = (contentY * factor) - (rect.height / 2);

                dom.viewerViewport.scrollLeft = newScrollLeft;
                dom.viewerViewport.scrollTop = newScrollTop;
            }

            state.viewer.selection = null;
            selectionBox.classList.add('hidden');
            state.viewer.tool = 'pan';
            updateViewerCursor();
            const btn = document.getElementById('btn-viewer-region');
            if (btn) { btn.classList.remove('bg-[var(--ring-color)]', 'text-white'); }
        }
    });

    dom.viewerViewport.addEventListener('mousemove', (e) => {
        if (state.viewer.isDragging) {
            e.preventDefault();
            dom.viewerViewport.style.cursor = 'grabbing';
            const walkX = (e.clientX - state.viewer.startX);
            const walkY = (e.clientY - state.viewer.startY);
            dom.viewerViewport.scrollLeft = state.viewer.scrollLeft - walkX;
            dom.viewerViewport.scrollTop = state.viewer.scrollTop - walkY;
        } else if (state.viewer.selection) {
            e.preventDefault();
            state.viewer.selection.currentX = e.clientX;
            state.viewer.selection.currentY = e.clientY;

            const rect = dom.viewerViewport.getBoundingClientRect();
            const scrollLeft = dom.viewerViewport.scrollLeft;
            const scrollTop = dom.viewerViewport.scrollTop;

            const x1 = Math.min(state.viewer.selection.startX, e.clientX);
            const x2 = Math.max(state.viewer.selection.startX, e.clientX);
            const y1 = Math.min(state.viewer.selection.startY, e.clientY);
            const y2 = Math.max(state.viewer.selection.startY, e.clientY);

            selectionBox.style.left = (x1 - rect.left + scrollLeft) + 'px';
            selectionBox.style.top = (y1 - rect.top + scrollTop) + 'px';
            selectionBox.style.width = (x2 - x1) + 'px';
            selectionBox.style.height = (y2 - y1) + 'px';
        }
    });

    // --- MODAL FUNCTIONS ---
    window.resetApp = function () {
        dom.resetModal.classList.remove('hidden');
        const btn = dom.resetModal.querySelector('button');
        if (btn) btn.focus();
    }
    window.closeResetModal = function () { dom.resetModal.classList.add('hidden'); }
    window.confirmResetApp = function () {
        state.items = []; state.selected.clear(); state.lastSelectedId = null; state.history = []; state.future = [];
        state.history.push("[]\n");
        pdfDocCache = {}; // Clear memory cache
        render();
        closeResetModal();
        updateToolbarState();
    }
    function showMessageModal(title, desc, isError) {
        const iconBg = document.getElementById('msg-icon-bg');
        const icon = document.getElementById('msg-icon');
        document.getElementById('msg-title').innerText = title;
        document.getElementById('msg-desc').innerText = desc;

        if (isError === 'info') {
            iconBg.className = "w-12 h-12 rounded-full bg-blue-100 text-blue-500 flex items-center justify-center flex-shrink-0";
            icon.className = "fas fa-info text-xl";
        } else if (isError) {
            iconBg.className = "w-12 h-12 rounded-full bg-red-100 text-red-500 flex items-center justify-center flex-shrink-0"; icon.className = "fas fa-times text-xl";
        } else {
            iconBg.className = "w-12 h-12 rounded-full bg-green-100 text-green-500 flex items-center justify-center flex-shrink-0"; icon.className = "fas fa-check text-xl";
        }
        dom.messageModal.classList.remove('hidden');
        const btn = dom.messageModal.querySelector('button');
        if (btn) btn.focus();
    }
    window.closeMessageModal = function () { dom.messageModal.classList.add('hidden'); }

    // --- RENDERERS & LOGIC ---
    function sanitizeItems() {
        if (!state.items) state.items = [];
        state.items = state.items.filter(item => !!item);
        state.items.forEach(item => { if (item.pages) item.pages = item.pages.filter(p => !!p); });

        // CLEANUP LOGIC:
        // 1. Remove "loose" single-page wrappers if empty (created during drag or delete)
        // 2. KEEP "file" containers (isMultiPage=true) even if empty, for "Revert" functionality.
        state.items = state.items.filter(item => {
            if (!item.id) return false;
            if (item.pages && item.pages.length > 0) return true; // Has pages -> Keep
            // Is empty.
            // If it's a PDF container (isMultiPage=true), Keep it.
            if (item.isMultiPage) return true;
            // Otherwise (single image wrapper or loose container), Delete it.
            return false;
        });
    }

    function render() {
        sanitizeItems(); // Auto-cleanup before render

        // View Toggling
        if (state.items.length === 0) {
            dom.startView.classList.remove('hidden');
            dom.gridView.classList.add('hidden');
            dom.listView.classList.add('hidden');
        } else {
            dom.startView.classList.add('hidden');
            dom.gridView.classList.toggle('hidden', state.view !== 'grid');
            dom.listView.classList.toggle('hidden', state.view !== 'list');
        }

        // Button States
        const baseClass = "w-7 h-7 rounded text-xs transition-all flex items-center justify-center";
        const activeClass = "bg-white dark:bg-gray-600 shadow-sm text-[var(--text-main)]";
        const inactiveClass = "text-[var(--text-sub)] hover:text-[var(--text-main)] bg-transparent";
        document.getElementById('btn-grid').className = `${baseClass} ${state.view === 'grid' ? activeClass : inactiveClass}`;
        document.getElementById('btn-list').className = `${baseClass} ${state.view === 'list' ? activeClass : inactiveClass}`;

        if (state.view === 'grid') renderGrid(); else renderList();
        updateSelectionVisuals();
        renderPdfThumbnails();
    }

    async function renderPdfThumbnails() {
        const canvasesToProcess = Array.from(document.querySelectorAll('canvas.pdf-thumb-pending'));
        if (canvasesToProcess.length === 0) return;

        // FIX: Use a stable worker queue model to prevent resource overload.
        const CONCURRENT_LIMIT = 2; // A safer limit to avoid crashing the browser renderer.

        const worker = async () => {
            while (canvasesToProcess.length > 0) {
                const canvas = canvasesToProcess.shift();
                if (!canvas) continue;

                canvas.classList.remove('pdf-thumb-pending');
                const url = canvas.dataset.url;
                const pageIdx = parseInt(canvas.dataset.pageIndex);
                const pageId = canvas.dataset.id;

                try {
                    let pdfDoc = pdfDocCache[url];
                    if (!pdfDoc) {
                        const loadingTask = pdfjsLib.getDocument(url);
                        pdfDoc = await loadingTask.promise;
                        pdfDocCache[url] = pdfDoc;
                    }
                    const page = await pdfDoc.getPage(pageIdx + 1);
                    const viewport = page.getViewport({ scale: 1 });
                    const MAX_DIMENSION = 1500;
                    const scale = Math.min(MAX_DIMENSION / viewport.width, MAX_DIMENSION / viewport.height, 3);
                    const pageObjRot = findPageObject(pageId)?.rot || 0;
                    const totalRot = (page.rotate + pageObjRot) % 360;
                    const rotatedViewport = page.getViewport({ scale: scale, rotation: totalRot });
                    canvas.width = rotatedViewport.width; canvas.height = rotatedViewport.height;
                    const context = canvas.getContext('2d');
                    context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, canvas.width, canvas.height);

                    // FIX: Add a timeout to prevent a single bad page from hanging the entire render queue.
                    const renderPromise = page.render({
                        canvasContext: context,
                        viewport: rotatedViewport,
                        renderInteractiveForms: true // Enable rendering of annotations and forms
                    }).promise;
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Render timed out after 10 seconds')), 10000)
                    );
                    await Promise.race([renderPromise, timeoutPromise]);

                    const pageObj = findPageObject(pageId);
                    if (pageObj) pageObj.thumbSrc = canvas.toDataURL();
                } catch (error) {
                    const thumbContainer = canvas.parentElement;
                    if (thumbContainer) thumbContainer.innerHTML = `<i class="fas fa-file-pdf text-4xl opacity-40 text-gray-500"></i>`;
                    console.error(`PDF thumbnail generation failed for page ${pageId}:`, error);
                }
            }
        }

        const workers = Array.from({ length: CONCURRENT_LIMIT }, () => worker());
        await Promise.all(workers);
    }

    function findPageObject(id) {
        for (const item of state.items) {
            if (item.id === id) return item;
            for (const page of item.pages) if (page.id === id) return page;
        }
        return null;
    }

    // --- FIXED SELECTION LOGIC ---
    function getVisibleItems() {
        const visible = [];
        state.items.forEach(item => {
            // If it's a single page/image wrapper (not a folder), the rendered selectable is the PAGE itself
            if (!item.isMultiPage && item.pages.length > 0) {
                visible.push(item.pages[0].id);
            } else {
                // It's a container/folder
                visible.push(item.id);
                if (item.expanded && item.pages.length > 0) {
                    item.pages.forEach(p => visible.push(p.id));
                }
            }
        });
        return visible;
    }

    function handleItemClick(e, id) {
        // Standardize ID if clicking container vs page
        if (e.shiftKey && state.lastSelectedId) {
            const visible = getVisibleItems();
            const startIdx = visible.indexOf(state.lastSelectedId);
            const endIdx = visible.indexOf(id);

            if (startIdx !== -1 && endIdx !== -1) {
                const min = Math.min(startIdx, endIdx);
                const max = Math.max(startIdx, endIdx);
                if (!e.ctrlKey) state.selected.clear();
                for (let i = min; i <= max; i++) {
                    state.selected.add(visible[i]);
                }
            }
        } else if (e.ctrlKey || e.metaKey) {
            if (state.selected.has(id)) {
                state.selected.delete(id);
                state.lastSelectedId = null;
            } else {
                state.selected.add(id);
                state.lastSelectedId = id;
            }
        } else {
            state.selected.clear();
            state.selected.add(id);
            state.lastSelectedId = id;
        }

        // Auto-collapse logic: if clicking something outside the expanded container
        if (state.expandedContainerId && !state.keepExpanded) {
            let isInside = (id === state.expandedContainerId);
            if (!isInside) {
                const expandedItem = state.items.find(i => i.id === state.expandedContainerId);
                if (expandedItem && expandedItem.pages && expandedItem.pages.some(p => p.id === id)) {
                    isInside = true;
                }
            }
            if (!isInside) {
                state.expandedContainerId = null;
                render();
                // Return early since render() will rebuild the grid/list and visuals
                return;
            }
        }

        updateSelectionVisuals();
    }

    function renderGrid() {
        dom.gridView.innerHTML = '';
        dom.gridView.className = `grid grid-cols-${state.gridCols} gap-6 pb-24 transition-opacity duration-200`;
        const isAnyExpanded = state.expandedContainerId !== null;

        state.items.forEach((item, parentIdx) => {
            const isExpanded = item.id === state.expandedContainerId;
            const isCompressed = isAnyExpanded && !isExpanded;

            const el = document.createElement('div');

            if (item.isMultiPage) {
                const spanVal = Math.min(state.gridCols, 3);
                let size = isExpanded ? `col-span-${spanVal} row-span-2` : "col-span-1";
                let visuals = isExpanded ? "ring-2 ring-[var(--ring-color)] shadow-xl scale-[1.01] z-10" : "hover:border-gray-300";
                if (isCompressed) visuals = "compressed-state border-transparent";
                let heightClass = isExpanded ? "h-auto" : "aspect-[3/4] w-full flex flex-col";

                el.className = `selectable-item flex flex-col bg-[var(--bg-container)] border border-[var(--border)] rounded-xl overflow-hidden shadow-md ${size} ${visuals} relative grid-item-transition ${heightClass}`;
                el.dataset.id = item.id;
                el.dataset.type = 'container';
                el.dataset.idx = parentIdx;
                el.draggable = !isExpanded;

                el.onclick = (e) => { e.stopPropagation(); handleItemClick(e, item.id); };
                el.ondblclick = (e) => toggleContainerExpansion(item.id, e);

                const icon = item.type === 'img' ? 'fa-image' : 'fa-file-pdf';

                el.innerHTML = `
                    <div class="flex items-center px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border)] gap-3 select-none">
                        <div class="w-8 h-8 rounded flex items-center justify-center ${item.thumbBg} text-[var(--text-sub)] item-icon">
                            <i class="fas ${icon}"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="text-sm font-semibold truncate item-name">${item.name}</div>
                            <div class="text-xs text-[var(--text-sub)] item-info">${item.pages.length} pages</div>
                        </div>
                        <button onclick="duplicateItem('${item.id}', event)" title="Duplicate PDF" class="w-8 h-8 rounded hover:bg-black/5 flex items-center justify-center text-[var(--text-sub)] transition-transform">
                            <i class="fas fa-clone"></i>
                        </button>
                        <button onclick="toggleContainerExpansion('${item.id}', event)" title="${isExpanded ? 'Collapse' : 'Expand'}" class="w-8 h-8 rounded hover:bg-black/5 flex items-center justify-center text-[var(--text-sub)] transition-transform">
                            <i class="fas ${isExpanded ? 'fa-compress-alt' : 'fa-expand-alt'}"></i>
                        </button>
                        <div class="w-1.5 h-8 rounded-full ${item.color}"></div>
                    </div>
                `;

                const body = document.createElement('div');
                // Use min-height and flex-grow to better fill the expanded space
                const height = isExpanded ? "min-h-[500px] flex-1" : "flex-1";
                body.className = `p-3 grid gap-2 ${height} overflow-y-auto content-start transition-all grid-container-body flex-grow`;
                // Dynamic grid columns: fits as many 100px cards as possible, preventing them from becoming too small
                body.style.gridTemplateColumns = "repeat(auto-fill, minmax(100px, 1fr))";

                item.pages.forEach((page, pIdx) => {
                    body.appendChild(createPageCard(page, item, parentIdx, pIdx, false));
                });
                el.appendChild(body);
                el.addEventListener('dragstart', handleDragStart);
                el.addEventListener('dragend', handleDragEnd);

            } else {
                if (item.pages.length > 0) {
                    dom.gridView.appendChild(createPageCard(item.pages[0], item, parentIdx, 0, true, isCompressed));
                }
                return;
            }
            dom.gridView.appendChild(el);
        });
        updateGridDensity();
    }

    function createPageCard(page, parent, parentIdx, pageIdx, isTopLevel, isCompressed = false) {
        const el = document.createElement('div');
        const base = "selectable-item relative group flex flex-col gap-2 cursor-grab active:cursor-grabbing select-none bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg hover:shadow-md transition-all";
        // FIX: Apply aspect ratio to the top-level card itself, and ensure padding is part of it.
        // The inner thumbnail will be flex-1 to fill the remaining space.
        const size = isTopLevel ? "p-3 col-span-1 aspect-[3/4]" : "p-2";
        const stateClass = isCompressed ? "compressed-state" : "";
        el.className = `${base} ${size} ${stateClass}`;
        el.draggable = true;
        el.dataset.type = isTopLevel ? 'card-toplevel' : 'card-inner';
        el.dataset.parentIdx = parentIdx;
        el.dataset.pageIdx = pageIdx;
        el.dataset.id = page.id;

        let revertBtn = '';
        if (page.type !== 'img' && page.originalFileId && page.originalFileId !== parent.id) {
            revertBtn = `<button onclick="revertPage('${page.id}', event)" title="Revert to Original File" class="w-6 h-6 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-sub)] flex items-center justify-center"><i class="fas fa-reply text-xs"></i></button>`;
        }
        const colorDot = page.type === 'img' ? '' : `<div class="w-2 h-2 rounded-full ${page.originalColor || parent.color}"></div>`;

        let thumbContent;
        const isPDF = page.type === 'file' && page.path.toLowerCase().endsWith('.pdf');
        if (page.thumbSrc) {
            thumbContent = `<div class="w-full h-full flex items-center justify-center bg-gray-100"><img src="${page.thumbSrc}" alt="Page Thumbnail" class="w-full h-full object-contain" style="transform: none"></div>`;
        } else if (page.type === 'img') {
            thumbContent = `<div class="w-full h-full flex items-center justify-center bg-gray-100"><img src="${page.path}" alt="Image File" class="w-full h-full object-contain" style="transform: rotate(${page.rot}deg)"></div>`;
        } else if (isPDF) {
            thumbContent = `<div class="w-full h-full flex items-center justify-center bg-white"><canvas class="pdf-thumb-pending w-full h-full object-contain" data-url="${page.path}" data-page-index="${page.originalIndex}" data-id="${page.id}"></canvas></div>`;
        } else {
            const icon = page.type === 'img' ? 'fa-image' : 'fa-file-pdf';
            thumbContent = `<div class="transition-transform duration-300"><i class="fas ${icon} ${isTopLevel ? 'text-4xl' : 'text-2xl'} opacity-40 text-gray-500"></i></div>`;
        }

        el.innerHTML = `
            <!-- The thumbnail container is now flex-1 to fill space left by the footer -->
            <div class="flex-1 w-full ${page.originalThumbBg || 'bg-gray-100'} rounded-md flex items-center justify-center overflow-hidden relative min-h-0">
                ${thumbContent}
            </div>
            <div class="flex items-center gap-2 mt-auto">
                ${colorDot}
                <span class="text-xs font-semibold text-[var(--text-sub)] truncate flex-1 item-name">${page.name}</span>
            </div>
            <div class="flex items-center justify-end gap-1 pt-2 border-t border-[var(--border)]" ondblclick="event.stopPropagation()">
                ${revertBtn}
                <button onclick="duplicateItem('${page.id}', event)" title="Duplicate" class="w-6 h-6 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-sub)] flex items-center justify-center"><i class="fas fa-clone text-xs"></i></button>
                <span class="text-[10px] text-[var(--text-sub)] font-mono ml-1">${page.rot}°</span>
                <button onclick="rotatePage('${page.id}', event)" title="Rotate 90°" class="w-6 h-6 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-sub)] flex items-center justify-center"><i class="fas fa-redo-alt text-xs"></i></button>
            </div>
        `;
        el.onclick = (e) => { e.stopPropagation(); handleItemClick(e, page.id); };
        // Add double click to open viewer
        el.ondblclick = (e) => { e.stopPropagation(); openViewer(page.id); };
        el.addEventListener('dragstart', handleDragStart);
        el.addEventListener('dragend', handleDragEnd);
        return el;
    }

    function renderList() {
        dom.listView.innerHTML = '';
        state.items.forEach((item, idx) => {
            const el = document.createElement('div');
            el.className = "flex flex-col bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg overflow-hidden list-row shadow-sm";
            const header = document.createElement('div');

            // Unified ID Logic for selection: Single page wrapper -> Page ID. Folder -> Item ID.
            let headerId = (!item.isMultiPage && item.pages.length === 1) ? item.pages[0].id : item.id;

            header.className = "selectable-item flex items-center p-3 gap-3 cursor-grab hover:bg-black/5 dark:hover:bg-white/5 list-parent-header transition-colors";
            header.draggable = true;
            header.dataset.type = item.isMultiPage ? 'list-parent' : 'card-toplevel';
            header.dataset.idx = idx;
            header.dataset.id = headerId;

            if (!item.isMultiPage && item.pages.length === 1) { header.dataset.parentIdx = idx; header.dataset.pageIdx = 0; }

            const chevron = (item.isMultiPage)
                ? `<button onclick="toggleExpandList(${idx})" class="w-6 h-6 text-[var(--text-sub)] transition-transform ${item.expanded ? 'rotate-90' : ''} flex-shrink-0"><i class="fas fa-chevron-right text-xs"></i></button>`
                : `<div class="w-6 flex-shrink-0"></div>`;

            let revertBtn = '', rotateBtn = '', duplicateBtn = '', rotText = '', colorDot = `<div class="w-2 h-8 rounded-l ${item.color} flex-shrink-0"></div>`;

            if (!item.isMultiPage && item.pages.length === 1) {
                const page = item.pages[0];
                if (page && page.type === 'img') colorDot = '<div class="w-2 h-8 flex-shrink-0"></div>';
                else if (page && page.originalFileId && page.originalFileId !== item.id) { revertBtn = `<button onclick="revertPage('${page.id}', event)" title="Revert" class="w-8 h-8 rounded-full hover:bg-black/10 flex items-center justify-center text-[var(--text-sub)]"><i class="fas fa-reply text-xs"></i></button>`; }
                if (page) { rotText = `<span class="text-[10px] text-[var(--text-sub)] font-mono ml-1 w-6 text-center">${page.rot}°</span>`; rotateBtn = `<button onclick="rotatePage('${page.id}', event)" title="Rotate 90°" class="w-8 h-8 rounded-full hover:bg-black/10 flex items-center justify-center text-[var(--text-sub)]"><i class="fas fa-redo-alt text-xs"></i></button>`; duplicateBtn = `<button onclick="duplicateItem('${page.id}', event)" title="Duplicate" class="w-8 h-8 rounded-full hover:bg-black/10 flex items-center justify-center text-[var(--text-sub)]"><i class="fas fa-clone text-xs"></i></button>`; }
            } else if (item.isMultiPage) {
                duplicateBtn = `<button onclick="duplicateItem('${item.id}', event)" title="Duplicate PDF" class="w-8 h-8 rounded-full hover:bg-black/10 flex items-center justify-center text-[var(--text-sub)]"><i class="fas fa-clone text-xs"></i></button>`;
            }

            if (!revertBtn) revertBtn = '<div class="w-8 h-8"></div>';
            if (!rotText) rotText = '<div class="w-6 ml-1"></div>';
            if (!rotateBtn) rotateBtn = '<div class="w-8 h-8"></div>';

            let thumbContent;
            if (!item.isMultiPage && item.pages[0]?.thumbSrc) {
                thumbContent = `<div class="w-8 h-8 rounded flex items-center justify-center bg-gray-100 overflow-hidden border border-[var(--border)] flex-shrink-0"><img src="${item.pages[0].thumbSrc}" alt="Page Thumbnail" class="w-full h-full object-contain" style="transform: none"></div>`;
            }
            else if (!item.isMultiPage && item.pages[0]?.type === 'img') {
                thumbContent = `<div class="w-8 h-8 rounded flex items-center justify-center bg-gray-100 overflow-hidden border border-[var(--border)] flex-shrink-0"><img src="${item.pages[0].path}" alt="Image File" class="w-full h-full object-contain" style="transform: rotate(${item.pages[0].rot}deg)"></div>`;
            }
            else {
                const icon = item.type === 'img' ? 'fa-image' : 'fa-file-pdf';
                thumbContent = `<div class="w-8 h-8 rounded flex items-center justify-center ${item.thumbBg} text-[var(--text-sub)] flex-shrink-0"><i class="fas ${icon}"></i></div>`;
            }

            const actionsContainer = `
                <div class="flex items-center justify-end gap-1 flex-shrink-0" style="min-width: 200px;" ondblclick="event.stopPropagation()">
                    ${revertBtn} ${duplicateBtn} ${rotText} ${rotateBtn}
                    <div class="text-xs text-[var(--text-sub)] w-12 text-right">${item.isMultiPage ? item.pages.length + ' pgs' : ''}</div>
                    ${colorDot}
                </div>
            `;

            header.innerHTML = `${chevron}${thumbContent}<div class="flex-1 font-medium text-sm text-[var(--text-sub)] min-w-0 truncate">${item.name}</div>${actionsContainer}`;
            header.onclick = (e) => handleItemClick(e, headerId);
            // Add double click to open viewer (if it's a single page item)
            if (!item.isMultiPage && item.pages.length === 1) {
                header.ondblclick = (e) => { e.stopPropagation(); openViewer(item.pages[0].id); };
            }
            header.addEventListener('dragstart', handleDragStart);
            header.addEventListener('dragend', handleDragEnd);
            el.appendChild(header);

            if (item.isMultiPage && item.expanded) {
                const body = document.createElement('div');
                body.className = "bg-black/5 dark:bg-white/5 pl-12 pr-4 py-2 grid gap-1 border-t border-[var(--border)] list-child-body transition-all";
                item.pages.forEach((page, pIdx) => {
                    const row = document.createElement('div');
                    row.className = "selectable-item flex items-center p-2 rounded hover:bg-white/50 dark:hover:bg-black/20 cursor-grab gap-3 list-child-row transition-colors";
                    row.draggable = true;
                    row.dataset.type = 'list-child'; row.dataset.parentIdx = idx; row.dataset.pageIdx = pIdx;
                    row.dataset.id = page.id;

                    let childRevert = '';
                    if (page.originalFileId && page.originalFileId !== item.id) {
                        childRevert = `<button onclick="revertPage('${page.id}', event)" title="Revert" class="w-6 h-6 rounded-full hover:bg-black/10 flex items-center justify-center text-[var(--text-sub)]"><i class="fas fa-reply text-xs"></i></button>`;
                    }
                    const childRotText = `<span class="text-[10px] text-[var(--text-sub)] font-mono ml-1">${page.rot}°</span>`;
                    row.innerHTML = `<div class="w-2 h-2 rounded-full ${page.originalColor || item.color}"></div><span class="text-sm text-[var(--text-sub)] flex-1 truncate">${page.name}</span><div class="flex items-center gap-2" ondblclick="event.stopPropagation()">${childRevert}<button onclick="duplicateItem('${page.id}', event)" title="Duplicate" class="w-6 h-6 rounded-full hover:bg-black/10 flex items-center justify-center text-[var(--text-sub)]"><i class="fas fa-clone text-xs"></i></button>${childRotText}<button onclick="rotatePage('${page.id}', event)" title="Rotate 90°" class="w-6 h-6 rounded-full hover:bg-black/10 flex items-center justify-center text-[var(--text-sub)]"><i class="fas fa-redo-alt text-xs"></i></button></div>`;
                    row.onclick = (e) => { e.stopPropagation(); handleItemClick(e, page.id); };
                    // Add double click to open viewer
                    row.ondblclick = (e) => { e.stopPropagation(); openViewer(page.id); };
                    row.addEventListener('dragstart', handleDragStart);
                    row.addEventListener('dragend', handleDragEnd);
                    body.appendChild(row);
                });
                el.appendChild(body);
            }
            dom.listView.appendChild(el);
        });

        // Add the dedicated drop zone at the end of the list
        const dropTail = document.createElement('div');
        dropTail.id = 'list-drop-tail';
        dropTail.className = 'rounded-lg'; // Remove idle styles, rely on CSS
        dom.listView.appendChild(dropTail);
    }

    function handleDragStart(e) {
        e.stopPropagation();
        const id = this.dataset.id;
        // If the dragged item isn't selected, clear selection and select only this item.
        if (!state.selected.has(id)) {
            state.selected.clear();
            state.selected.add(id);
            updateSelectionVisuals();
        }
        activeDrag = { type: 'internal' }; // Set the global drag state.
        dragSource = { type: this.dataset.type, parentIdx: parseInt(this.dataset.parentIdx ?? this.dataset.idx), pageIdx: this.dataset.pageIdx !== undefined ? parseInt(this.dataset.pageIdx) : null, selectedIds: Array.from(state.selected) };

        // FIX: Set a custom data transfer type to reliably identify internal drags.
        e.dataTransfer.setData('application/x-combine-plus-internal', 'true');

        this.classList.add('dragging');
    }

    // FIX: Aggressively clean up visual artifacts in handleDragEnd
    function handleDragEnd(e) {
        activeDrag = null; // Reset the global drag state.
        // FIX: Always reset dragSource on drag end to prevent conflicts with external file drops.
        dragSource = null;
        dropTarget = null;
        this.classList.remove('dragging');
        resetMarkers();
        document.querySelectorAll('.drop-target-bg').forEach(el => el.classList.remove('drop-target-bg'));
        dom.mainScroll.classList.remove('border-dashed', 'border-4', 'border-[var(--ring-color)]', 'border-opacity-50');
    }

    function handleItemReorderDragOver(e) {
        e.preventDefault();

        // This function is now only called for internal drags.
        if (!dragSource) return;

        resetMarkers();
        document.querySelectorAll('.drop-target-bg').forEach(el => el.classList.remove('drop-target-bg'));
        if (state.view === 'grid') {
            gridDragOver(e);
        } else {
            listDragOver(e);
        }
    }

    function gridDragOver(e) {
        const containerEl = e.target.closest('[data-type="container"]');
        const isPageDrag = dragSource.type.includes('card') || dragSource.type === 'list-child' || dragSource.type === 'list-parent';
        const gapSize = 8;

        if (isPageDrag && containerEl) {
            const cIdx = parseInt(containerEl.dataset.idx);
            const containerBody = containerEl.querySelector('.grid-container-body');
            if (!containerBody) return;
            const cards = Array.from(containerBody.children);
            if (cards.length === 0 || e.target === containerBody) {
                containerBody.classList.add('drop-target-bg');
                dropTarget = { action: 'insert-into-container', destIdx: cIdx, innerIdx: cards.length };
                return;
            }
            let closest = { dist: Infinity, el: null, side: 'left', idx: 0 };
            cards.forEach((c, i) => {
                const rect = c.getBoundingClientRect();
                const dist = Math.hypot(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
                if (dist < closest.dist) closest = { dist, el: c, idx: i, side: e.clientX > (rect.left + rect.width / 2) ? 'right' : 'left', rect };
            });
            if (closest.el) {
                const targetInnerIdx = closest.side === 'left' ? closest.idx : closest.idx + 1;
                const rect = closest.el.getBoundingClientRect();
                const x = closest.side === 'left' ? rect.left - (gapSize / 2) : rect.right + (gapSize / 2);
                positionMarkerV(x, rect.top, rect.height);
                dropTarget = { action: 'insert-into-container', destIdx: cIdx, innerIdx: targetInnerIdx };
            }
            return;
        }

        const containers = Array.from(dom.gridView.children);
        let closest = { dist: Infinity, el: null, side: 'left' };
        containers.forEach((c, i) => {
            const rect = c.getBoundingClientRect();
            const dist = Math.hypot(e.clientX - (rect.left + rect.width / 2), e.clientY - rect.top);
            if (dist < closest.dist) closest = { dist, el: c, idx: i, side: e.clientX > (rect.left + rect.width / 2) ? 'right' : 'left', rect };
        });
        if (closest.el) {
            let destIdx = closest.side === 'left' ? closest.idx : closest.idx + 1;
            const rect = closest.el.getBoundingClientRect();
            const outerGapSize = 24;
            let x = closest.side === 'left' ? rect.left - (outerGapSize / 2) : rect.right + (outerGapSize / 2);

            // FIX: Allow dropping at the very beginning of the list.
            if (closest.idx === 0 && closest.side === 'left') {
                destIdx = 0;
                x = rect.left - (outerGapSize / 2);
            }

            positionMarkerV(x, rect.top, rect.height);
            dropTarget = { action: 'reorder-top', destIdx };
        }
    }

    function listDragOver(e) {
        const row = e.target.closest('.list-row');
        const childRow = e.target.closest('.list-child-row');
        const outerGapSize = 8;
        const innerGapSize = 4;
        const isPageDrag = dragSource.type.includes('card') || dragSource.type === 'list-child' || dragSource.type === 'list-parent';

        // NEW: Check for the dedicated drop zone at the end of the list first.
        const dropTailEl = e.target.closest('#list-drop-tail');
        if (dropTailEl) {
            const rect = dropTailEl.getBoundingClientRect();
            //positionMarkerH(rect.left, rect.width, rect.top + (outerGapSize / 2));
            dropTarget = { action: 'reorder-list-top', destIdx: state.items.length };
            // Add visual feedback to the drop tail itself
            dropTailEl.classList.add('drop-target-bg');
            return;
        }

        if (childRow) {
            const rect = childRow.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const pIdx = parseInt(childRow.dataset.parentIdx);
            const cIdx = parseInt(childRow.dataset.pageIdx);
            const isAfter = e.clientY > midY;
            const y = isAfter ? rect.bottom + (innerGapSize / 2) : rect.top - (innerGapSize / 2);
            positionMarkerH(rect.left, rect.width, y);
            dropTarget = { action: 'insert-into-container', destIdx: pIdx, innerIdx: isAfter ? cIdx + 1 : cIdx };
            return;
        }
        if (row) {
            const header = row.querySelector('.list-parent-header');
            const rect = header.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const idx = parseInt(header.dataset.idx);
            if (isPageDrag && state.items[idx].isMultiPage && e.clientY > rect.top + 5 && e.clientY < rect.bottom - 5) {
                header.classList.add('drop-target-bg');
                dropTarget = { action: 'insert-into-container', destIdx: idx, innerIdx: state.items[idx].pages.length };
                return;
            }
            if (e.clientY < midY) {
                const y = rect.top - (outerGapSize / 2);
                positionMarkerH(rect.left, rect.width, y);
                dropTarget = { action: 'reorder-list-top', destIdx: idx };
                return;
            } else {
                const y = rect.bottom + (outerGapSize / 2);
                positionMarkerH(rect.left, rect.width, y);
                dropTarget = { action: 'reorder-list-top', destIdx: idx + 1 };
                return;
            }
        }

        // Check if dragging below the last item in an expanded container.
        const listBounds = dom.listView.getBoundingClientRect();
        if (row && state.items[idx].isMultiPage && state.items[idx].expanded) {
            const body = row.querySelector('.list-child-body');
            if (body) {
                const bodyRect = body.getBoundingClientRect();
                if (e.clientY > bodyRect.bottom - 5) { // Use a small tolerance
                    const y = row.getBoundingClientRect().bottom + (outerGapSize / 2);
                    positionMarkerH(listBounds.left, listBounds.width, y);
                    dropTarget = { action: 'reorder-list-top', destIdx: idx + 1 };
                    return;
                }
            }
        }

        // If no row is found, check if we are at the very top of the list view area.
        if (!row && e.clientY < listBounds.top + 20) {
            positionMarkerH(listBounds.left, listBounds.width, listBounds.top + (outerGapSize / 2));
            dropTarget = { action: 'reorder-list-top', destIdx: 0 };
            return;
        }
    }

    function handleItemReorderDrop(e) {
        e.preventDefault(); e.stopPropagation();

        // FIX: Aggressively clean up visual artifacts at start of Drop
        resetMarkers();
        document.querySelectorAll('.drop-target-bg').forEach(el => el.classList.remove('drop-target-bg'));
        dom.mainScroll.classList.remove('border-dashed', 'border-4', 'border-[var(--ring-color)]', 'border-opacity-50');

        if (!dropTarget || !dragSource) return;

        // Wrap in try/catch to ensure UI doesn't freeze if logic errors out
        try {
            saveState();

            const idsToMove = new Set(dragSource.selectedIds);
            const itemsToMove = [];
            const originalTopLevelIndices = [];
            for (let i = state.items.length - 1; i >= 0; i--) {
                const item = state.items[i];

                // Remove selected pages from within a container
                if (item.pages) {
                    for (let j = item.pages.length - 1; j >= 0; j--) {
                        if (idsToMove.has(item.pages[j].id)) {
                            itemsToMove.unshift(item.pages.splice(j, 1)[0]);
                        }
                    }
                }

                // Remove a selected top-level container
                if (idsToMove.has(item.id)) {
                    originalTopLevelIndices.unshift(i);
                    itemsToMove.unshift(state.items.splice(i, 1)[0]);
                }
            }

            // 3. Determine the correct insertion point.
            let destIdx = dropTarget.destIdx;
            if (dropTarget.action.includes('reorder')) {
                // FIX: Correct the destination index by accounting for items that were removed from before the drop target.
                const itemsBeforeDrop = originalTopLevelIndices.filter(i => i < dropTarget.destIdx).length;
                destIdx -= itemsBeforeDrop;
            }

            // 4. Perform the insertion.
            if (dropTarget.action.includes('insert-into-container')) {
                const container = state.items[destIdx];
                if (!container) { // Failsafe if container is gone
                    dropTarget.action = 'reorder-top'; // Fallback to reordering
                } else {
                    const pagesToAdd = [];
                    itemsToMove.forEach(movedItem => {
                        if (movedItem.pages) pagesToAdd.push(...movedItem.pages); // Unpack containers
                        else pagesToAdd.push(movedItem); // Add single pages
                    });
                    container.pages.splice(dropTarget.innerIdx, 0, ...pagesToAdd);
                    container.expanded = true;
                    container.isMultiPage = true;
                }
            }

            if (dropTarget.action.includes('reorder')) {
                const newItems = itemsToMove.map(movedItem => {
                    // If it's already a container (multi-page or single-page wrapper), move it as is.
                    if (movedItem.pages) return movedItem;
                    // If it's a bare page object, wrap it in a new single-page container.
                    const page = movedItem;
                    return {
                        id: 'loose_' + Date.now() + Math.random().toString(36).substr(2, 5), type: page.type || 'page', name: page.name || 'Page',
                        expanded: true, isMultiPage: false, color: page.originalColor, thumbBg: page.originalThumbBg, pages: [page]
                    };
                }).filter(item => item && item.pages && item.pages.length > 0);

                if (newItems.length > 0) state.items.splice(destIdx, 0, ...newItems);
            }
            state.selected.clear(); render();

        } catch (err) {
            console.error("Drop Error:", err);
            // Ensure render happens to reset confusing state even on error
            render();
        } finally {
            dragSource = null;
            dropTarget = null;
        }
    }

    function updateSelectionVisuals() {
        document.querySelectorAll('.selectable-item').forEach(el => { if (state.selected.has(el.dataset.id)) el.classList.add('is-selected'); else el.classList.remove('is-selected'); });
        dom.statusMsg.innerText = state.selected.size > 0 ? `${state.selected.size} item selected` : "";
        const delBtn = document.getElementById('btn-delete'); if (delBtn) delBtn.disabled = state.selected.size === 0;
    }
    window.handleBgClick = function (e) { if (e.target === dom.gridView || e.target === dom.listView) { state.selected.clear(); updateSelectionVisuals(); } }
    function positionMarkerV(x, y, h) { const r = dom.mainScroll.getBoundingClientRect(); dom.markerV.style.left = (x - r.left - 2) + 'px'; dom.markerV.style.top = (y - r.top + dom.mainScroll.scrollTop) + 'px'; dom.markerV.style.height = h + 'px'; dom.markerV.classList.remove('hidden'); }
    function positionMarkerH(x, w, y) { const r = dom.mainScroll.getBoundingClientRect(); dom.markerH.style.left = (x - r.left) + 'px'; dom.markerH.style.top = (y - r.top + dom.mainScroll.scrollTop - 2) + 'px'; dom.markerH.style.width = w + 'px'; dom.markerH.classList.remove('hidden'); }
    function resetMarkers() { dom.markerV.classList.add('hidden'); dom.markerH.classList.add('hidden'); }

    // --- KEYBOARD HELPER FUNCTIONS ---
    function rotateSelected() {
        if (state.selected.size === 0) return;
        saveState();
        let changed = false;
        state.selected.forEach(id => {
            const item = state.items.find(i => i.id === id);
            if (item) {
                // Rotate all pages in container
                item.pages.forEach(p => { p.rot = (p.rot + 90) % 360; p.thumbSrc = null; });
                changed = true;
            } else {
                // Check if it's a page
                for (const it of state.items) {
                    const p = it.pages.find(pg => pg.id === id);
                    if (p) {
                        p.rot = (p.rot + 90) % 360;
                        p.thumbSrc = null;
                        changed = true;
                        break;
                    }
                }
            }
        });
        if (changed) render();
    }

    function moveSelected(dir) {
        if (!state.lastSelectedId) return;

        // 1. Check if we are moving a Top-Level Item
        // This includes Containers (matched by ID) AND Single-Page Wrappers (matched by Page ID)
        let itemIdx = state.items.findIndex(i => i.id === state.lastSelectedId);
        if (itemIdx === -1) {
            // Check for single-page wrapper where the Page ID is the selected ID
            itemIdx = state.items.findIndex(i => !i.isMultiPage && i.pages.some(p => p.id === state.lastSelectedId));
        }

        if (itemIdx !== -1) {
            const newIdx = itemIdx + dir;
            if (newIdx >= 0 && newIdx < state.items.length) {
                saveState();
                const temp = state.items[itemIdx];
                state.items[itemIdx] = state.items[newIdx];
                state.items[newIdx] = temp;
                render();
                ensureVisible(state.lastSelectedId);
            }
            return;
        }

        // 2. Try moving a page inside a Multi-Page Container
        for (let i = 0; i < state.items.length; i++) {
            const item = state.items[i];
            if (!item.isMultiPage) continue; // Skip single-page wrappers as they are handled above
            const pIdx = item.pages.findIndex(p => p.id === state.lastSelectedId);
            if (pIdx !== -1) {
                const newIdx = pIdx + dir;
                if (newIdx >= 0 && newIdx < item.pages.length) {
                    saveState();
                    const temp = item.pages[pIdx];
                    item.pages[pIdx] = item.pages[newIdx];
                    item.pages[newIdx] = temp;
                    render();
                    ensureVisible(state.lastSelectedId);
                } else {
                    // Move out of container
                    saveState();
                    const [page] = item.pages.splice(pIdx, 1);
                    const newLooseItem = {
                        id: 'loose_' + Date.now() + Math.random().toString(36).substr(2, 5),
                        type: page.type || 'page', name: page.name || 'Page',
                        expanded: true, isMultiPage: false,
                        color: page.originalColor, thumbBg: page.originalThumbBg,
                        pages: [page]
                    };
                    const insertIdx = (dir === -1) ? i : i + 1;
                    state.items.splice(insertIdx, 0, newLooseItem);
                    render();
                    ensureVisible(state.lastSelectedId);
                }
                return;
            }
        }
    }

    function getTopLevelItems() {
        return state.items.map(item => {
            if (!item.isMultiPage && item.pages.length > 0) return item.pages[0].id;
            return item.id;
        });
    }

    function navigateGrid(key, onlyTopLevel) {
        if (!state.lastSelectedId) {
            const visible = onlyTopLevel ? getTopLevelItems() : getVisibleItems();
            if (visible.length > 0) selectId(visible[0]);
            return;
        }

        const currentEl = document.querySelector(`.selectable-item[data-id="${state.lastSelectedId}"]`);
        if (!currentEl) return;

        let currentRect = currentEl.getBoundingClientRect();
        // If container, use header for spatial reference
        if (currentEl.dataset.type === 'container') {
            const isExpanded = state.expandedContainerId === currentEl.dataset.id;
            if (isExpanded) {
                const header = currentEl.firstElementChild;
                if (header) currentRect = header.getBoundingClientRect();
            }
        }

        const currentCenter = {
            x: currentRect.left + currentRect.width / 2,
            y: currentRect.top + currentRect.height / 2
        };

        // Prioritize navigation within the same container for pages
        if (!onlyTopLevel && currentEl.dataset.type === 'card-inner') {
            const parentIdx = parseInt(currentEl.dataset.parentIdx);
            const container = dom.gridView.children[parentIdx];
            if (container) {
                const siblings = Array.from(container.querySelectorAll('.selectable-item'));
                let bestSibling = null;
                let minSiblingDist = Infinity;
                const threshold = 10;

                siblings.forEach(el => {
                    if (el === currentEl) return;
                    const rect = el.getBoundingClientRect();
                    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

                    let isDir = false;
                    if (key === 'ArrowUp') {
                        if (center.y < currentCenter.y - threshold) isDir = true;
                    } else {
                        if (center.y > currentCenter.y + threshold) isDir = true;
                    }

                    if (isDir) {
                        const dx = center.x - currentCenter.x;
                        const dy = center.y - currentCenter.y;
                        const dist = (dx * dx) + (dy * dy);

                        if (dist < minSiblingDist) {
                            minSiblingDist = dist;
                            bestSibling = el;
                        }
                    }
                });

                if (bestSibling) {
                    selectId(bestSibling.dataset.id);
                    return;
                }
            }
        }

        const allItems = Array.from(dom.gridView.querySelectorAll('.selectable-item'));
        let bestCandidate = null;
        let minDistance = Infinity;

        allItems.forEach(el => {
            if (el.dataset.id === state.lastSelectedId) return;

            if (onlyTopLevel) {
                const type = el.dataset.type;
                if (type !== 'container' && type !== 'card-toplevel') return;
            }

            let rect = el.getBoundingClientRect();
            if (el.dataset.type === 'container') {
                const isExpanded = state.expandedContainerId === el.dataset.id;
                if (isExpanded) {
                    const header = el.firstElementChild;
                    if (header) rect = header.getBoundingClientRect();
                }
            }

            const center = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            };

            let isDirection = false;
            const threshold = 10;

            if (key === 'ArrowUp') {
                if (center.y < currentCenter.y - threshold) isDirection = true;
            } else {
                if (center.y > currentCenter.y + threshold) isDirection = true;
            }

            if (isDirection) {
                const dx = center.x - currentCenter.x;
                const dy = center.y - currentCenter.y;
                const dist = (dx * dx) + (dy * dy);

                if (dist < minDistance) {
                    minDistance = dist;
                    bestCandidate = el;
                }
            }
        });

        if (bestCandidate) {
            selectId(bestCandidate.dataset.id);
        }
    }

    function navigateSelection(dir, onlyTopLevel) {
        if (state.items.length === 0) return;

        const visible = onlyTopLevel ? getTopLevelItems() : getVisibleItems();
        if (visible.length === 0) return;

        if (!state.lastSelectedId) {
            // If nothing selected: Right/Down -> First, Left/Up -> Last
            const id = (dir === 1) ? visible[0] : visible[visible.length - 1];
            selectId(id);
            return;
        }

        let currIdx = visible.indexOf(state.lastSelectedId);

        if (onlyTopLevel && currIdx === -1) {
            const parent = state.items.find(i => i.pages.some(p => p.id === state.lastSelectedId));
            if (parent) {
                const parentId = (!parent.isMultiPage && parent.pages.length > 0) ? parent.pages[0].id : parent.id;
                currIdx = visible.indexOf(parentId);
            }
        }

        if (currIdx !== -1) {
            let newIdx = currIdx + dir;
            if (newIdx < 0) newIdx = 0;
            if (newIdx >= visible.length) newIdx = visible.length - 1;
            selectId(visible[newIdx]);
        } else {
            // If selection is lost (e.g. inside collapsed folder), select first visible
            selectId(visible[0]);
        }
    }

    function selectId(id) {
        state.selected.clear();
        state.selected.add(id);
        state.lastSelectedId = id;
        updateSelectionVisuals();
        ensureVisible(id);
    }

    function ensureVisible(id) {
        setTimeout(() => {
            const el = document.querySelector(`[data-id="${id}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 0);
    }

    // Initial load
    document.getElementById('resize-chk').checked = state.resizeToFit;
    document.getElementById('keep-expanded-chk').checked = state.keepExpanded;
    if (!state.items) state.items = [];

    if (state.items.length === 0) {
        state.history = ["[]\n"];
        dom.startView.classList.remove('hidden');
        dom.gridView.classList.add('hidden');
        dom.listView.classList.add('hidden');
    } else {
        switchView(state.view);
    }
    updateToolbarState();
});