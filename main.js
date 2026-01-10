const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
 const sharp = require('sharp');
const PDFDocumentKit = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');

let mainWindow;
let isRendererReady = false;
let pendingFiles = [];

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        frame: true, 
        backgroundColor: '#FDFCF8',
        title: '',
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.setMenu(null);
    mainWindow.loadFile('index.html');

    mainWindow.webContents.once('did-finish-load', () => {
        isRendererReady = true;
        if (pendingFiles.length > 0) {
            mainWindow.webContents.send('add-files-from-system', pendingFiles);
            pendingFiles = [];
        }
    });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
            
            // Handle files passed to the second instance
            // Filter out flags (arguments starting with --)
            const files = commandLine.slice(1).filter(arg => !arg.startsWith('--'));
            if (files.length > 0) {
                if (isRendererReady) {
                    mainWindow.webContents.send('add-files-from-system', files);
                } else {
                    pendingFiles.push(...files);
                }
            }
        }
    });

    app.whenReady().then(() => {
        createWindow();

        // Handle files passed on initial startup (e.g. "Open With")
        const files = process.argv.slice(1).filter(arg => !arg.startsWith('--'));
        if (files.length > 0) {
            pendingFiles.push(...files);
        }
    });
}

ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Supported Files', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'svg', 'tif', 'tiff', 'avif', 'bmp', 'gif'] }]
    });
    return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('save-file-dialog', async () => {
    return await dialog.showSaveDialog({
        title: 'Export Combined PDF',
        defaultPath: 'combined_document.pdf',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
});

ipcMain.handle('merge-files', async (event, data) => {
    const { items, outputPath, resizeToFit } = data;
    const tempDir = path.join(app.getPath('temp'), 'combine-plus-temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const processedItems = [];
    const failedFiles = [];

    // Path Logic: Use EXE in production, PY in development
    const isPackaged = app.isPackaged;
    const enginePath = isPackaged 
        ? path.join(process.resourcesPath, 'bin', 'merge_engine.exe')
        : path.resolve(app.getAppPath(), 'merge_engine.py');

    try {
        for (const item of items) {
            const ext = path.extname(item.path).toLowerCase();
            const isImage = item.type === 'img' || /\.(jpg|jpeg|png|webp|svg|tif|tiff|avif|bmp|gif)$/i.test(item.path);
            
            if (isImage) {
                try {
                    const tempPdfPath = path.join(tempDir, `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.pdf`);
                    let imgData = item.path;
                    
                    // Convert formats that PDFKit doesn't natively support (everything except JPG/PNG)
                    if (['.webp', '.avif', '.tiff', '.tif', '.bmp', '.gif'].includes(ext)) {
                        imgData = await sharp(item.path).png().toBuffer();
                    }

                    const metadata = await sharp(imgData).metadata();
                    const doc = new PDFDocumentKit({ size: [metadata.width, metadata.height], margin: 0 });

                    // AUTOMATED FONT LOOKUP: Reduces user labor by scanning common system font paths
                    const fontPaths = [
                        'C:/Windows/Fonts/',
                        '/Library/Fonts/',
                        '/usr/share/fonts/'
                    ];
                    
                    const registerFontIfFound = (fontName) => {
                        const variations = [
                            `${fontName}.ttf`, `${fontName}.otf`, 
                            `${fontName} Regular.ttf`, `${fontName.replace(/\s/g, '')}.ttf`
                        ];
                        for (const dir of fontPaths) {
                            for (const v of variations) {
                                const fullPath = path.join(dir, v);
                                if (fs.existsSync(fullPath)) {
                                    try { doc.registerFont(fontName, fullPath); return true; } catch(e){}
                                }
                            }
                        }
                        return false;
                    };

                    const stream = fs.createWriteStream(tempPdfPath);
                    doc.pipe(stream);

                    if (ext === '.svg') {
                        const svgString = fs.readFileSync(item.path, 'utf8');
                        // Extract font families used in SVG to try and auto-register them
                        const fontMatches = svgString.match(/font-family="([^"]+)"/g);
                        if (fontMatches) {
                            fontMatches.forEach(m => registerFontIfFound(m.split('"')[1]));
                        }

                        SVGtoPDF(doc, svgString, 0, 0, {
                            width: metadata.width,
                            height: metadata.height,
                            useFont: (f) => registerFontIfFound(f) ? f : 'Helvetica'
                        });
                    } else {
                        doc.image(imgData, 0, 0, { width: metadata.width, height: metadata.height });
                    }

                    doc.end();
                    await new Promise((res, rej) => { stream.on('finish', res); stream.on('error', rej); });
                    processedItems.push({ path: tempPdfPath, originalIndex: 0, rot: item.rot || 0, isTemp: true });
                } catch (e) {
                    failedFiles.push(path.basename(item.path));
                }
            } else {
                processedItems.push({ path: item.path, originalIndex: item.originalIndex, rot: item.rot || 0 });
            }
        }

        const payload = JSON.stringify({ items: processedItems, outputPath, resizeToFit: !!resizeToFit });

        return new Promise((resolve) => {
            const runArgs = isPackaged ? [payload] : [enginePath, payload];
            const runCmd = isPackaged ? enginePath : 'python';

            execFile(runCmd, runArgs, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
                processedItems.filter(i => i.isTemp).forEach(i => { try { fs.unlinkSync(i.path); } catch (e) {} });
                if (error) return resolve({ success: false, error: stderr || error.message });
                try {
                    resolve({ ...JSON.parse(stdout.trim()), failedFiles });
                } catch (e) {
                    resolve({ success: false, error: "Engine output error: " + stdout.substring(0, 100) });
                }
            });
        });

    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('render-page-view', async (event, { filePath, pageIndex, mode, scale }) => {
    let doc;
    let page;
    try {
        // The mupdf package exports a factory function that returns a promise.
        const mupdfModule = await import('mupdf');
        let mupdf = mupdfModule.default || mupdfModule;

        // MuPDF JS expects a buffer, not a file path
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = ext === '.pdf' ? "application/pdf" : undefined;
        doc = mupdf.Document.openDocument(data, contentType);
        page = doc.loadPage(pageIndex); // JS API uses 0-based indexing

        // Calculate DPI based on zoom scale.
        // Base DPI is 72. If scale is 1.0, we render at 72 DPI.
        // If scale is 10.0 (1000%), we render at 720 DPI.
        // We cap at 400 DPI to prevent memory exhaustion on extreme zooms, 
        // while still providing very crisp "vector-like" quality for screen viewing.
        let dpiScale = Math.min(scale, 400/72); 
        
        const matrix = mupdf.Matrix.scale(dpiScale, dpiScale);
        const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
        const pngBuffer = pixmap.asPNG();
        
        if (pixmap.destroy) pixmap.destroy();
        return { success: true, data: pngBuffer, type: 'png' };
    } catch (err) {
        console.error("MuPDF NPM error:", err);
        return { success: false, error: err.message };
    } finally {
        if (page && page.destroy) page.destroy();
        if (doc && doc.destroy) doc.destroy();
    }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });