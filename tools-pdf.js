import * as pdfjsLib from '/assets/vendor/pdf.min.mjs';
import { composePageImagesPdf, composePdfImage } from '/tools-pdf-compose.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdf.worker.min.mjs';

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_BYTES = 20 * 1024 * 1024;

const elements = {
    card: document.getElementById('pdfToolCard'),
    fileInput: document.getElementById('pdfFileInput'),
    imageInput: document.getElementById('pdfImageInput'),
    fileBox: document.getElementById('pdfFileBox'),
    imageBox: document.getElementById('pdfImageBox'),
    fileName: document.getElementById('pdfFileName'),
    imageName: document.getElementById('pdfImageName'),
    editor: document.getElementById('pdfEditor'),
    empty: document.getElementById('pdfEmptyPreview'),
    shell: document.getElementById('pdfPreviewShell'),
    stage: document.getElementById('pdfStage'),
    canvas: document.getElementById('pdfPreviewCanvas'),
    overlay: document.getElementById('pdfImageOverlay'),
    overlayImage: document.getElementById('pdfOverlayImage'),
    resizeHandle: document.getElementById('pdfResizeHandle'),
    prevPage: document.getElementById('pdfPrevPage'),
    nextPage: document.getElementById('pdfNextPage'),
    pageLabel: document.getElementById('pdfPageLabel'),
    targetPage: document.getElementById('pdfTargetPage'),
    zoomLabel: document.getElementById('pdfZoomLabel'),
    scaleRange: document.getElementById('pdfScaleRange'),
    scaleOutput: document.getElementById('pdfScaleOutput'),
    opacityRange: document.getElementById('pdfOpacityRange'),
    opacityOutput: document.getElementById('pdfOpacityOutput'),
    blendToggle: document.getElementById('pdfBlendToggle'),
    blendOutput: document.getElementById('pdfBlendOutput'),
    exportFormats: [...document.querySelectorAll('input[name="pdfExportFormat"]')],
    centerImage: document.getElementById('pdfCenterImage'),
    removeImage: document.getElementById('pdfRemoveImage'),
    sendButton: document.getElementById('pdfSendButton'),
    clearButton: document.getElementById('pdfClearButton'),
    progress: document.getElementById('pdfProgress'),
    progressText: document.getElementById('pdfProgressText'),
    progressPercent: document.getElementById('pdfProgressPercent'),
    progressBar: document.getElementById('pdfProgressBar')
};

const state = {
    sourceFile: null,
    sourceBytes: null,
    documentType: '',
    pdfDocument: null,
    wordPages: [],
    pageCount: 0,
    imageFile: null,
    imageUrl: '',
    pageNumber: 1,
    targetPage: 1,
    renderWidth: 0,
    renderHeight: 0,
    renderScale: 1,
    renderTask: null,
    overlay: null,
    blendMode: 'normal',
    sending: false
};

elements.card.addEventListener('click', () => {
    window.selectToolsPanel?.('pdf');
    requestAnimationFrame(() => {
        if (state.sourceFile) renderCurrentPage();
        else elements.fileInput.focus({ preventScroll: true });
    });
});

elements.fileInput.addEventListener('change', () => loadDocument(elements.fileInput.files?.[0]));
elements.imageInput.addEventListener('change', () => loadImage(elements.imageInput.files?.[0]));
bindDropZone(elements.fileBox, loadDocument, file => /\.(pdf|docx?|DOCX?)$/i.test(file.name) || /pdf|wordprocessingml/i.test(file.type));
bindDropZone(elements.imageBox, loadImage, file => /^image\/(png|jpeg|webp)$/i.test(file.type));

elements.prevPage.addEventListener('click', () => changePage(state.pageNumber - 1));
elements.nextPage.addEventListener('click', () => changePage(state.pageNumber + 1));
elements.targetPage.addEventListener('change', () => {
    state.targetPage = Number(elements.targetPage.value) || 1;
    changePage(state.targetPage);
});
elements.scaleRange.addEventListener('input', () => setOverlayWidth(Number(elements.scaleRange.value) / 100));
elements.opacityRange.addEventListener('input', () => {
    if (!state.overlay) return;
    state.overlay.opacity = Number(elements.opacityRange.value) / 100;
    updateOverlayElement();
});
elements.blendToggle.addEventListener('change', () => {
    state.blendMode = elements.blendToggle.checked ? 'multiply' : 'normal';
    elements.blendOutput.textContent = elements.blendToggle.checked ? '正片叠底' : '无叠加';
    updateOverlayElement();
});
elements.centerImage.addEventListener('click', centerOverlay);
elements.removeImage.addEventListener('click', removeImage);
elements.clearButton.addEventListener('click', () => resetPdfTool());
elements.sendButton.addEventListener('click', sendFileToDingTalk);

bindOverlayPointerEvents();
window.addEventListener('resize', debounce(() => {
    if (!state.sourceFile || document.getElementById('pdfToolPanel').hidden) return;
    renderCurrentPage();
}, 180));

async function loadDocument(file) {
    clearProgress();
    if (!file) return;
    if (/\.doc$/i.test(file.name)) {
        showProgress('暂不支持旧版 .doc，请在 Word 中另存为 .docx 后上传', 100, 'error');
        elements.fileInput.value = '';
        return;
    }
    const documentType = isPdfFile(file) ? 'pdf' : isDocxFile(file) ? 'docx' : '';
    if (!documentType) {
        showProgress('请选择 PDF 或 Word（.docx）文件', 100, 'error');
        elements.fileInput.value = '';
        return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
        showProgress('文件不能超过 20MB', 100, 'error');
        elements.fileInput.value = '';
        return;
    }

    clearDocumentState();
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        showProgress(documentType === 'pdf' ? '正在读取 PDF 文件' : '正在读取 Word 文件', 12);

        if (documentType === 'pdf') {
            const documentTask = pdfjsLib.getDocument({ data: bytes.slice() });
            state.pdfDocument = await documentTask.promise;
            state.pageCount = state.pdfDocument.numPages;
        } else {
            state.wordPages = await renderWordPages(bytes);
            state.pageCount = state.wordPages.length;
        }
        if (!state.pageCount) throw new Error('文件没有可预览的页面');

        state.sourceFile = file;
        state.sourceBytes = bytes;
        state.documentType = documentType;
        state.pageNumber = 1;
        state.targetPage = 1;
        elements.fileName.textContent = `${file.name} · ${formatBytes(file.size)}`;
        elements.fileBox.classList.add('ready');
        populateTargetPages(state.pageCount);
        elements.empty.hidden = true;
        elements.editor.hidden = false;
        await renderCurrentPage();
        clearProgress();
        updateReadyState();
    } catch (error) {
        clearDocumentState();
        elements.fileInput.value = '';
        elements.fileName.textContent = '支持 PDF、Word（.docx）';
        elements.fileBox.classList.remove('ready');
        elements.editor.hidden = true;
        elements.empty.hidden = false;
        showProgress(error.message || '文件读取失败，请更换文件', 100, 'error');
        updateReadyState();
    }
}

async function renderWordPages(bytes) {
    if (!window.docx?.renderAsync || !window.html2canvas) {
        throw new Error('Word 处理组件加载失败，请刷新页面重试');
    }
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;width:max-content;z-index:-1;pointer-events:none;background:#fff;';
    document.body.appendChild(host);
    try {
        await window.docx.renderAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), host, host, {
            inWrapper: true,
            breakPages: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            useBase64URL: true,
            renderHeaders: true,
            renderFooters: true
        });
        await waitForImages(host);
        if (document.fonts?.ready) await document.fonts.ready;
        const pageElements = [...host.querySelectorAll('.docx-wrapper > section.docx')];
        if (!pageElements.length) pageElements.push(...host.querySelectorAll('section.docx'));
        if (!pageElements.length) throw new Error('Word 文件没有可预览的页面');

        const pages = [];
        for (let index = 0; index < pageElements.length; index++) {
            showProgress(`正在生成 Word 预览（${index + 1}/${pageElements.length}）`, 18 + ((index + 1) / pageElements.length) * 62);
            const pageElement = pageElements[index];
            const bounds = pageElement.getBoundingClientRect();
            const canvas = await window.html2canvas(pageElement, {
                backgroundColor: '#ffffff',
                scale: 1.5,
                useCORS: true,
                allowTaint: false,
                logging: false
            });
            pages.push({
                canvas,
                width: Math.max(1, bounds.width),
                height: Math.max(1, bounds.height)
            });
        }
        return pages;
    } finally {
        host.remove();
    }
}

async function loadImage(file) {
    clearProgress();
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
        showProgress('请选择 PNG、JPG 或 WebP 图片', 100, 'error');
        elements.imageInput.value = '';
        return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
        showProgress('图片不能超过 8MB', 100, 'error');
        elements.imageInput.value = '';
        return;
    }

    try {
        const imageUrl = URL.createObjectURL(file);
        releaseImageUrl();
        state.imageUrl = imageUrl;
        const dimensions = await readImageDimensions(imageUrl);
        state.imageFile = file;
        state.targetPage = state.pageNumber;
        state.overlay = createDefaultOverlay(dimensions.width / dimensions.height);
        elements.overlayImage.src = imageUrl;
        elements.imageName.textContent = `${file.name} · ${formatBytes(file.size)}`;
        elements.imageBox.classList.add('ready');
        elements.targetPage.value = String(state.targetPage);
        elements.scaleRange.value = String(Math.round(state.overlay.width * 100));
        elements.opacityRange.value = '100';
        updateOverlayElement();
        updateReadyState();
    } catch (error) {
        removeImage();
        showProgress(error.message || '图片读取失败，请更换图片', 100, 'error');
    }
}

async function renderCurrentPage() {
    if (!state.sourceFile) return;
    if (state.documentType === 'pdf') await renderPdfPreview();
    else renderWordPreview();
    updatePageControls();
    updateOverlayElement();
}

async function renderPdfPreview() {
    if (state.renderTask) {
        state.renderTask.cancel();
        state.renderTask = null;
    }
    const page = await state.pdfDocument.getPage(state.pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = previewAvailableWidth();
    const scale = Math.min(1.45, availableWidth / baseViewport.width);
    const viewport = page.getViewport({ scale });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const context = preparePreviewCanvas(viewport.width, viewport.height, pixelRatio);
    state.renderScale = scale;

    const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0]
    });
    state.renderTask = renderTask;
    try {
        await renderTask.promise;
    } catch (error) {
        if (error?.name !== 'RenderingCancelledException') throw error;
    } finally {
        if (state.renderTask === renderTask) state.renderTask = null;
    }
}

function renderWordPreview() {
    const page = state.wordPages[state.pageNumber - 1];
    if (!page) return;
    const scale = Math.min(1.45, previewAvailableWidth() / page.width);
    const width = page.width * scale;
    const height = page.height * scale;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const context = preparePreviewCanvas(width, height, pixelRatio);
    context.drawImage(page.canvas, 0, 0, elements.canvas.width, elements.canvas.height);
    state.renderScale = scale;
}

function preparePreviewCanvas(width, height, pixelRatio) {
    state.renderWidth = width;
    state.renderHeight = height;
    elements.canvas.width = Math.ceil(width * pixelRatio);
    elements.canvas.height = Math.ceil(height * pixelRatio);
    elements.canvas.style.width = `${width}px`;
    elements.canvas.style.height = `${height}px`;
    elements.stage.style.width = `${width}px`;
    elements.stage.style.height = `${height}px`;
    const context = elements.canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
    return context;
}

function previewAvailableWidth() {
    return Math.max(260, elements.shell.clientWidth - (window.innerWidth <= 760 ? 22 : 38));
}

function populateTargetPages(count) {
    elements.targetPage.innerHTML = '';
    for (let page = 1; page <= count; page++) {
        const option = document.createElement('option');
        option.value = String(page);
        option.textContent = String(page);
        elements.targetPage.appendChild(option);
    }
}

function changePage(nextPage) {
    if (!state.sourceFile) return;
    state.pageNumber = Math.min(state.pageCount, Math.max(1, Number(nextPage) || 1));
    renderCurrentPage();
}

function updatePageControls() {
    const count = state.pageCount || 1;
    elements.pageLabel.textContent = `第 ${state.pageNumber} / ${count} 页`;
    elements.prevPage.disabled = state.pageNumber <= 1;
    elements.nextPage.disabled = state.pageNumber >= count;
    elements.zoomLabel.textContent = `${Math.round(state.renderScale * 100)}%`;
}

function createDefaultOverlay(aspectRatio) {
    const width = 0.25;
    const canvasRatio = state.renderWidth > 0 && state.renderHeight > 0
        ? state.renderWidth / state.renderHeight
        : 0.72;
    const height = Math.min(0.8, (width * canvasRatio) / Math.max(aspectRatio, 0.05));
    return {
        x: (1 - width) / 2,
        y: (1 - height) / 2,
        width,
        height,
        aspectRatio,
        opacity: 1
    };
}

function setOverlayWidth(requestedWidth) {
    if (!state.overlay || !state.renderWidth || !state.renderHeight) return;
    const width = clamp(requestedWidth, 0.05, 1);
    const height = (width * state.renderWidth / state.overlay.aspectRatio) / state.renderHeight;
    const fittedWidth = height > 1 ? width / height : width;
    const fittedHeight = Math.min(1, height);
    state.overlay.width = fittedWidth;
    state.overlay.height = fittedHeight;
    state.overlay.x = clamp(state.overlay.x, 0, 1 - fittedWidth);
    state.overlay.y = clamp(state.overlay.y, 0, 1 - fittedHeight);
    updateOverlayElement();
}

function centerOverlay() {
    if (!state.overlay) return;
    state.overlay.x = (1 - state.overlay.width) / 2;
    state.overlay.y = (1 - state.overlay.height) / 2;
    updateOverlayElement();
}

function removeImage() {
    releaseImageUrl();
    state.imageFile = null;
    state.overlay = null;
    elements.imageInput.value = '';
    elements.imageName.textContent = 'PNG、JPG 或 WebP';
    elements.imageBox.classList.remove('ready');
    elements.overlayImage.removeAttribute('src');
    elements.overlay.hidden = true;
    updateReadyState();
}

function updateOverlayElement() {
    const overlay = state.overlay;
    const visible = Boolean(overlay && state.imageFile && state.pageNumber === state.targetPage && state.renderWidth && state.renderHeight);
    elements.overlay.hidden = !visible;
    elements.centerImage.disabled = !state.imageFile;
    elements.removeImage.disabled = !state.imageFile;
    elements.overlayImage.style.mixBlendMode = state.blendMode;
    if (!visible) return;

    elements.overlay.style.left = `${overlay.x * state.renderWidth}px`;
    elements.overlay.style.top = `${overlay.y * state.renderHeight}px`;
    elements.overlay.style.width = `${overlay.width * state.renderWidth}px`;
    elements.overlay.style.height = `${overlay.height * state.renderHeight}px`;
    elements.overlayImage.style.opacity = String(overlay.opacity);
    elements.scaleRange.value = String(Math.round(overlay.width * 100));
    elements.scaleOutput.textContent = `${Math.round(overlay.width * 100)}%`;
    elements.opacityOutput.textContent = `${Math.round(overlay.opacity * 100)}%`;
}

function bindOverlayPointerEvents() {
    let interaction = null;
    elements.overlay.addEventListener('pointerdown', event => {
        if (!state.overlay || event.target === elements.resizeHandle) return;
        event.preventDefault();
        elements.overlay.setPointerCapture(event.pointerId);
        interaction = {
            mode: 'move',
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x: state.overlay.x,
            y: state.overlay.y
        };
    });
    elements.resizeHandle.addEventListener('pointerdown', event => {
        if (!state.overlay) return;
        event.preventDefault();
        event.stopPropagation();
        elements.resizeHandle.setPointerCapture(event.pointerId);
        interaction = {
            mode: 'resize',
            pointerId: event.pointerId,
            startX: event.clientX,
            width: state.overlay.width
        };
    });
    window.addEventListener('pointermove', event => {
        if (!interaction || event.pointerId !== interaction.pointerId || !state.overlay) return;
        if (interaction.mode === 'move') {
            state.overlay.x = clamp(interaction.x + ((event.clientX - interaction.startX) / state.renderWidth), 0, 1 - state.overlay.width);
            state.overlay.y = clamp(interaction.y + ((event.clientY - interaction.startY) / state.renderHeight), 0, 1 - state.overlay.height);
            updateOverlayElement();
            return;
        }
        setOverlayWidth(interaction.width + ((event.clientX - interaction.startX) / state.renderWidth));
    });
    window.addEventListener('pointerup', event => {
        if (interaction?.pointerId === event.pointerId) interaction = null;
    });
    elements.overlay.addEventListener('keydown', event => {
        if (!state.overlay || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = event.shiftKey ? 0.02 : 0.005;
        if (event.key === 'ArrowLeft') state.overlay.x -= step;
        if (event.key === 'ArrowRight') state.overlay.x += step;
        if (event.key === 'ArrowUp') state.overlay.y -= step;
        if (event.key === 'ArrowDown') state.overlay.y += step;
        state.overlay.x = clamp(state.overlay.x, 0, 1 - state.overlay.width);
        state.overlay.y = clamp(state.overlay.y, 0, 1 - state.overlay.height);
        updateOverlayElement();
    });
}

async function sendFileToDingTalk() {
    if (state.sending || !state.sourceFile || !state.imageFile || !state.overlay) return;
    const user = readCurrentUser();
    if (!user?.unionId) {
        showProgress('请先在钉钉中登录网站', 100, 'error');
        return;
    }

    state.sending = true;
    updateReadyState();
    try {
        const format = selectedExportFormat();
        showProgress(`正在生成 ${format.toUpperCase()} 文件`, 18);
        const output = await createOutputFile(format);
        if (output.blob.size > MAX_RESULT_BYTES) {
            throw new Error('处理后的文件超过 20MB，请使用较小的文件或图片');
        }

        showProgress('文件已生成，正在发送到钉钉', 68);
        const formData = new FormData();
        formData.append('file', output.blob, output.fileName);
        formData.append('fileName', output.fileName);
        formData.append('unionId', user.unionId);
        const response = await fetch('/api/tools-send-pdf', { method: 'POST', body: formData });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `发送失败（HTTP ${response.status}）`);

        resetPdfTool({ keepProgress: true });
        showProgress('已发送到你的钉钉', 100, 'success');
    } catch (error) {
        showProgress(error.message || '发送失败，请重试', 100, 'error');
    } finally {
        state.sending = false;
        updateReadyState();
    }
}

async function createOutputFile(format) {
    if (format === 'jpg') {
        const canvas = await createTargetPageCanvas();
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.96);
        return { blob, fileName: resultFileName(state.sourceFile.name, 'jpg') };
    }

    let bytes;
    if (state.documentType === 'pdf') {
        if (!window.PDFLib?.PDFDocument) throw new Error('PDF 处理组件加载失败，请刷新页面重试');
        const imageBytes = await normalizedImageBytes(state.imageFile);
        bytes = await composePdfImage({
            PDFDocument: window.PDFLib.PDFDocument,
            BlendMode: window.PDFLib.BlendMode,
            pdfBytes: state.sourceBytes,
            imageBytes: imageBytes.bytes,
            imageType: imageBytes.type,
            targetPage: state.targetPage,
            placement: state.overlay,
            blendMode: state.blendMode
        });
    } else {
        bytes = await createWordResultPdf();
    }
    return {
        blob: new Blob([bytes], { type: 'application/pdf' }),
        fileName: resultFileName(state.sourceFile.name, 'pdf')
    };
}

async function createWordResultPdf() {
    if (!window.PDFLib?.PDFDocument) throw new Error('PDF 处理组件加载失败，请刷新页面重试');
    const targetCanvas = await createTargetPageCanvas();
    const pages = [];
    for (let index = 0; index < state.wordPages.length; index++) {
        showProgress(`正在生成 PDF（${index + 1}/${state.wordPages.length}）`, 20 + ((index + 1) / state.wordPages.length) * 35);
        const source = state.wordPages[index];
        const canvas = index === state.targetPage - 1 ? targetCanvas : source.canvas;
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
        pages.push({
            bytes: new Uint8Array(await blob.arrayBuffer()),
            type: 'image/jpeg',
            width: source.width * 0.75,
            height: source.height * 0.75
        });
    }
    return composePageImagesPdf({ PDFDocument: window.PDFLib.PDFDocument, pages });
}

async function createTargetPageCanvas() {
    let baseCanvas;
    if (state.documentType === 'pdf') {
        baseCanvas = await renderPdfPageCanvas(state.targetPage, 2);
    } else {
        baseCanvas = state.wordPages[state.targetPage - 1]?.canvas;
    }
    if (!baseCanvas) throw new Error('所选页面不存在');

    const canvas = document.createElement('canvas');
    canvas.width = baseCanvas.width;
    canvas.height = baseCanvas.height;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(baseCanvas, 0, 0, canvas.width, canvas.height);

    const bitmap = await createImageBitmap(state.imageFile);
    context.save();
    context.globalAlpha = clamp(state.overlay.opacity, 0, 1);
    context.globalCompositeOperation = state.blendMode === 'multiply' ? 'multiply' : 'source-over';
    context.drawImage(
        bitmap,
        state.overlay.x * canvas.width,
        state.overlay.y * canvas.height,
        state.overlay.width * canvas.width,
        state.overlay.height * canvas.height
    );
    context.restore();
    bitmap.close();
    return canvas;
}

async function renderPdfPageCanvas(pageNumber, scale) {
    const page = await state.pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas;
}

async function normalizedImageBytes(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.type === 'image/jpeg') return { bytes, type: 'image/jpeg' };
    if (file.type === 'image/png') return { bytes, type: 'image/png' };

    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvasToBlob(canvas, 'image/png');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/png' };
}

function clearDocumentState() {
    if (state.renderTask) state.renderTask.cancel();
    state.pdfDocument?.destroy?.();
    Object.assign(state, {
        sourceFile: null,
        sourceBytes: null,
        documentType: '',
        pdfDocument: null,
        wordPages: [],
        pageCount: 0,
        pageNumber: 1,
        targetPage: 1,
        renderWidth: 0,
        renderHeight: 0,
        renderScale: 1,
        renderTask: null
    });
}

function resetPdfTool(options = {}) {
    clearDocumentState();
    releaseImageUrl();
    Object.assign(state, {
        imageFile: null,
        imageUrl: '',
        overlay: null,
        blendMode: 'normal'
    });
    elements.fileInput.value = '';
    elements.imageInput.value = '';
    elements.fileName.textContent = '支持 PDF、Word（.docx）';
    elements.imageName.textContent = 'PNG、JPG 或 WebP';
    elements.fileBox.classList.remove('ready');
    elements.imageBox.classList.remove('ready');
    elements.editor.hidden = true;
    elements.empty.hidden = false;
    elements.overlay.hidden = true;
    elements.overlayImage.removeAttribute('src');
    elements.overlayImage.style.mixBlendMode = 'normal';
    elements.targetPage.innerHTML = '';
    elements.scaleRange.value = '25';
    elements.opacityRange.value = '100';
    elements.scaleOutput.textContent = '25%';
    elements.opacityOutput.textContent = '100%';
    elements.blendToggle.checked = false;
    elements.blendOutput.textContent = '无叠加';
    elements.exportFormats.forEach(input => { input.checked = input.value === 'pdf'; });
    const context = elements.canvas.getContext('2d');
    context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    if (!options.keepProgress) clearProgress();
    updateReadyState();
}

function updateReadyState() {
    elements.sendButton.disabled = state.sending || !state.sourceFile || !state.imageFile || !state.overlay;
    elements.clearButton.disabled = state.sending;
    elements.fileInput.disabled = state.sending;
    elements.imageInput.disabled = state.sending;
    elements.blendToggle.disabled = state.sending;
    elements.exportFormats.forEach(input => { input.disabled = state.sending; });
    elements.sendButton.innerHTML = state.sending
        ? '<span>正在发送...</span>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>发送';
}

function selectedExportFormat() {
    return elements.exportFormats.find(input => input.checked)?.value || 'pdf';
}

function showProgress(message, percent, type = '') {
    elements.progress.hidden = false;
    elements.progress.classList.toggle('error', type === 'error');
    elements.progress.classList.toggle('success', type === 'success');
    elements.progressText.textContent = message;
    elements.progressPercent.textContent = `${Math.round(percent)}%`;
    elements.progressBar.style.width = `${clamp(percent, 0, 100)}%`;
}

function clearProgress() {
    elements.progress.hidden = true;
    elements.progress.classList.remove('error', 'success');
    elements.progressText.textContent = '';
    elements.progressPercent.textContent = '0%';
    elements.progressBar.style.width = '0%';
}

function readCurrentUser() {
    try {
        const raw = sessionStorage.getItem('dt_user') || localStorage.getItem('dt_user');
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function bindDropZone(element, onFile, accepts) {
    ['dragenter', 'dragover'].forEach(type => element.addEventListener(type, event => {
        event.preventDefault();
        if (!state.sending) element.classList.add('ready');
    }));
    ['dragleave', 'drop'].forEach(type => element.addEventListener(type, event => {
        event.preventDefault();
        if (!element.querySelector('input').files?.length) element.classList.remove('ready');
    }));
    element.addEventListener('drop', event => {
        if (state.sending) return;
        const file = event.dataTransfer?.files?.[0];
        if (!file || !accepts(file)) {
            showProgress('文件类型不支持，请重新选择', 100, 'error');
            return;
        }
        onFile(file);
    });
}

function waitForImages(container) {
    const pending = [...container.querySelectorAll('img')]
        .filter(image => !image.complete)
        .map(image => new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
        }));
    return Promise.all(pending);
}

function readImageDimensions(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('图片读取失败，请更换图片'));
        image.src = url;
    });
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('文件生成失败，请重试')), type, quality);
    });
}

function releaseImageUrl() {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = '';
}

function resultFileName(originalName, extension) {
    const base = String(originalName || '处理后的文件')
        .replace(/\.(pdf|docx?)$/i, '')
        .replace(/[\\/:*?"<>|\r\n]+/g, '_')
        .slice(0, 80) || '处理后的文件';
    return `${base}-已添加图片.${extension}`;
}

function isPdfFile(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isDocxFile(file) {
    return /\.docx$/i.test(file.name) || /wordprocessingml/i.test(file.type);
}

function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function debounce(callback, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => callback(...args), delay);
    };
}

updateReadyState();
