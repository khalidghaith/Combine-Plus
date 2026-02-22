import sys

with open('logic.js', 'r', encoding='utf-8') as f:
    logic_code = f.read()

# Bug 6: totalRot in renderPdfThumbnails
target_thumb = """                    const rot = findPageObject(pageId)?.rot || 0;
                    const rotatedViewport = page.getViewport({ scale: scale, rotation: rot });"""
replace_thumb = """                    const pageObjRot = findPageObject(pageId)?.rot || 0;
                    const totalRot = (page.rotate + pageObjRot) % 360;
                    const rotatedViewport = page.getViewport({ scale: scale, rotation: totalRot });"""
logic_code = logic_code.replace(target_thumb, replace_thumb)

# Bug 5: duplicateItem updating originalFileId
target_dup = """            const newItemId = 'copy_f_' + Date.now() + Math.random().toString(36).substr(2, 5);
            const newPages = originalItem.pages.map(p => ({
                ...p, id: 'copy_p_' + Date.now() + Math.random().toString(36).substr(2, 5) + '_' + Math.random().toString(36).substr(2, 3),
            }));"""
replace_dup = """            const newItemId = 'copy_f_' + Date.now() + Math.random().toString(36).substr(2, 5);
            const newPages = originalItem.pages.map(p => ({
                ...p, id: 'copy_p_' + Date.now() + Math.random().toString(36).substr(2, 5) + '_' + Math.random().toString(36).substr(2, 3),
                originalFileId: newItemId
            }));"""
logic_code = logic_code.replace(target_dup, replace_dup)

# Bug 4: Multiple rotate, duplicate, revert
# For rotatePage
target_rotate = """    window.rotatePage = function(pageId, e) {
        if(e) e.stopPropagation();
        saveState();
        for(let item of state.items) {
            for(let p of item.pages) {
                if(p.id === pageId) {
                    p.rot = (p.rot + 90) % 360;
                    p.thumbSrc = null; 
                    render(); return;
                }
            }
        }
    }"""
replace_rotate = """    window.rotatePage = function(pageId, e) {
        if(e) e.stopPropagation();
        saveState();
        let targets = state.selected.has(pageId) ? Array.from(state.selected) : [pageId];
        let changed = false;
        for(let item of state.items) {
            for(let p of item.pages) {
                if(targets.includes(p.id)) {
                    p.rot = (p.rot + 90) % 360;
                    p.thumbSrc = null;
                    changed = true;
                }
            }
        }
        if(changed) render();
    }"""
logic_code = logic_code.replace(target_rotate, replace_rotate)

# For duplicateItem
target_duplicate = """    window.duplicateItem = function(id, e) {
        if(e) e.stopPropagation();
        saveState();
        // Duplicate File/Container
        const itemIdx = state.items.findIndex(item => item.id === id);
        if (itemIdx !== -1) {
            const originalItem = state.items[itemIdx];
            const newItemId = 'copy_f_' + Date.now() + Math.random().toString(36).substr(2, 5);
            const newPages = originalItem.pages.map(p => ({
                ...p, id: 'copy_p_' + Date.now() + Math.random().toString(36).substr(2, 5) + '_' + Math.random().toString(36).substr(2, 3),
            }));
            const newItem = { ...originalItem, id: newItemId, pages: newPages };
            state.items.splice(itemIdx + 1, 0, newItem);
            render();
            return;
        }
        // Duplicate Page
        for(let i=0; i<state.items.length; i++) {
            const item = state.items[i];
            const pageIdx = item.pages.findIndex(p => p.id === id);
            if (pageIdx !== -1) {
                if (!item.isMultiPage) {
                    state.history.pop();
                    duplicateItem(item.id, null); 
                    return;
                }
                const originalPage = item.pages[pageIdx];
                const newPage = { ...originalPage, id: 'copy_p_' + Date.now() + Math.random().toString(36).substr(2, 5) };
                item.pages.splice(pageIdx + 1, 0, newPage);
                render();
                return;
            }
        }
    }"""
replace_duplicate = """    window.duplicateItem = function(id, e) {
        if(e) e.stopPropagation();
        saveState();
        let targets = state.selected.has(id) ? Array.from(state.selected) : [id];
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
            
            for(let i=0; i<state.items.length; i++) {
                const item = state.items[i];
                const pageIdx = item.pages.findIndex(p => p.id === targetId);
                if (pageIdx !== -1) {
                    if (!item.isMultiPage && targets.length === 1) {
                        state.history.pop();
                        duplicateItem(item.id, null); 
                        return;
                    } else if (item.isMultiPage) {
                        const originalPage = item.pages[pageIdx];
                        const newPage = { ...originalPage, id: 'copy_p_' + Date.now() + Math.random().toString(36).substr(2, 5) };
                        item.pages.splice(pageIdx + 1, 0, newPage);
                        changed = true;
                    }
                    break;
                }
            }
        }
        if(changed) render();
    }"""
logic_code = logic_code.replace(target_duplicate, replace_duplicate)

# For revertPage
target_revert = """    window.revertPage = function(pageId, e) {
        if(e) e.stopPropagation();
        saveState();
        let pageData = null;
        
        outer: for(let i=0; i<state.items.length; i++) {
            if (state.items[i].pages.length === 1 && state.items[i].pages[0].id === pageId && !state.items[i].isMultiPage) {
                pageData = state.items[i].pages[0];
                state.items.splice(i, 1); 
                break outer;
            }
            for(let j=0; j<state.items[i].pages.length; j++) {
                 if (state.items[i].pages[j].id === pageId) {
                     pageData = state.items[i].pages[j];
                     state.items[i].pages.splice(j, 1);
                     break outer;
                 }
            }
        }
        if(!pageData) { state.history.pop(); updateToolbarState(); return; }

        const original = state.items.find((it, idx) => it.id === pageData.originalFileId);
        
        if(original) {
            let insertIndex = original.pages.findIndex(p => p.originalIndex > pageData.originalIndex);
            if (insertIndex === -1) insertIndex = original.pages.length; 
            pageData.rot = 0; pageData.thumbSrc = null;
            original.pages.splice(insertIndex, 0, pageData);
            original.expanded = true; original.isMultiPage = true;
        } else {
            const newLooseItem = {
                id: 'restored_'+Date.now() + Math.random().toString(36).substr(2, 5), 
                type: pageData.type, name: pageData.name,
                expanded: true, isMultiPage: false,
                color: pageData.originalColor, thumbBg: pageData.originalThumbBg,
                pages: [pageData]
            };
            pageData.rot = 0; pageData.thumbSrc = null;
            state.items.push(newLooseItem);
        }
        render();
    }"""
replace_revert = """    window.revertPage = function(pageId, e) {
        if(e) e.stopPropagation();
        saveState();
        let targets = state.selected.has(pageId) ? Array.from(state.selected) : [pageId];
        let changed = false;
        
        for (let targetId of targets) {
            let pageData = null;
            
            outer: for(let i=state.items.length-1; i>=0; i--) {
                if (state.items[i].pages.length === 1 && state.items[i].pages[0].id === targetId && !state.items[i].isMultiPage) {
                    pageData = state.items[i].pages[0];
                    state.items.splice(i, 1); 
                    break outer;
                }
                for(let j=state.items[i].pages.length-1; j>=0; j--) {
                     if (state.items[i].pages[j].id === targetId) {
                         pageData = state.items[i].pages[j];
                         state.items[i].pages.splice(j, 1);
                         break outer;
                     }
                }
            }
            if(!pageData) continue;

            const original = state.items.find(it => it.id === pageData.originalFileId);
            
            if(original) {
                let insertIndex = original.pages.findIndex(p => p.originalIndex > pageData.originalIndex);
                if (insertIndex === -1) insertIndex = original.pages.length; 
                pageData.rot = 0; pageData.thumbSrc = null;
                original.pages.splice(insertIndex, 0, pageData);
                original.expanded = true; original.isMultiPage = true;
                changed = true;
            } else {
                const newLooseItem = {
                    id: 'restored_'+Date.now() + Math.random().toString(36).substr(2, 5), 
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
        if (changed) render();
        else { state.history.pop(); updateToolbarState(); }
    }"""
logic_code = logic_code.replace(target_revert, replace_revert)

# Bug 2: loadAndRenderViewer speed (use MuPDF via main.js)
target_viewer = """            if (isPdf) {
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
            } else {"""
replace_viewer = """            if (isPdf) {
                if (isElectron) {
                    // Fast MuPDF rendering via main thread
                    dom.viewerLoading.classList.remove('hidden');
                    const dpiScale = state.viewer.scale;
                    const res = await ipcRenderer.invoke('render-page-view', {
                        filePath: pageObj.path,
                        pageIndex: pageObj.originalIndex,
                        mode: 'fast',
                        scale: dpiScale
                    });
                    
                    if (res.success) {
                        // Create object URL from returned PNG buffer
                        const blob = new Blob([res.data], { type: 'image/png' });
                        const url = URL.createObjectURL(blob);
                        const img = new Image();
                        img.onload = () => {
                            // Calculate base dimensions relative to a 1.0 scale
                            viewerBaseDims = { w: img.naturalWidth / dpiScale, h: img.naturalHeight / dpiScale };
                            URL.revokeObjectURL(url);
                        };
                        img.src = url;
                        // Provide default size so it shows up before load
                        img.className = "select-none pointer-events-none block max-w-full m-auto";
                        renderViewerImage(img);
                        dom.viewerLoading.classList.add('hidden');
                    } else {
                        throw new Error(res.error);
                    }
                } else {
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
                }
            } else {"""
logic_code = logic_code.replace(target_viewer, replace_viewer)

with open('logic.js', 'w', encoding='utf-8') as f:
    f.write(logic_code)

print("Patching logic.js complete.")
