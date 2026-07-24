import * as pdfjsLib from '/assets/vendor/pdf.min.mjs';
import { composePdfImage } from '/tools-pdf-compose.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdf.worker.min.mjs';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
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
    pdfFile: null,
    sourceBytes: null,
    pdfDocument: null,
    imageFile: null,
    imageUrl: '',
    pageNumber: 1,
    targetPage: 1,
    renderWidth: 0,
    renderHeight: 0,
    renderScale: 1,
    renderTask: null,
    overlay: null,
    sending: false
};

elements.card.addEventListener('click', () => {
    window.selectToolsPanel?.('pdf');
    requestAnimationFrame(() => {
        if (state.pdfDocument) renderCurrentPage();
        else elements.fileInput.focus({ preventScroll: true });
    });
});

elements.fileInput.addEventListener('change', () => loadPdf(elements.fileInput.files?.[0]));
elements.imageInput.addEventListener('change', () => loadImage(elements.imageInput.files?.[0]));
bindDropZone(elements.fileBox, file => loadPdf(file), file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
bindDropZone(elements.imageBox, file => loadImage(file), file => /^image\/(png|jpeg|webp)$/i.test(file.type));

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
elements.centerImage.addEventListener('click', centerOverlay);
elements.removeImage.addEventListener('click', removeImage);
elements.clearButton.addEventListener('click', () => resetPdfTool());
elements.sendButton.addEventListener('click', sendPdfToDingTalk);

bindOverlayPointerEvents();
window.addEventListener('resize', debounce(() => {
    if (!state.pdfDocument || document.getElementById('pdfToolPanel').hidden) return;
    renderCurrentPage();
}, 180));

async function loadPdf(file) {
    clearProgress();
    if (!file) return;
    if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
        showProgress('请选择 PDF 文件', 100, 'error');
        elements.fileInput.value = '';
        return;
    }
    if (file.size > MAX_PDF_BYTES) {
        showProgress('PDF 文件不能超过 20MB', 100, 'error');
        elements.fileInput.value = '';
        return;
    }

    try {
        showProgress('正在读取 PDF 文件', 18);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const documentTask = pdfjsLib.getDocument({ data: bytes.slice() });
        const pdfDocument = await documentTask.promise;
        if (!pdfDocument.numPages) throw new Error('PDF 文件没有可预览的页面');

        state.pdfFile = file;
        state.sourceBytes = bytes;
        state.pdfDocument = pdfDocument;
        state.pageNumber = 1;
        state.targetPage = 1;
        elements.fileName.textContent = `${file.name} · ${formatBytes(file.size)}`;
        elements.fileBox.classList.add('ready');
        populateTargetPages(pdfDocument.numPages);
        elements.empty.hidden = true;
        elements.editor.hidden = false;
        await renderCurrentPage();
        clearProgress();
        updateReadyState();
    } catch (error) {
        state.pdfFile = null;
        state.sourceBytes = null;
        state.pdfDocument = null;
        elements.fileInput.value = '';
        elements.fileName.textContent = '支持 20MB 以内文件';
        elements.fileBox.classList.remove('ready');
        elements.editor.hidden = true;
        elements.empty.hidden = false;
        showProgress(error.message || 'PDF 文件读取失败，请更换文件', 100, 'error');
        updateReadyState();
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
    if (!state.pdfDocument) return;
    if (state.renderTask) {
        state.renderTask.cancel();
        state.renderTask = null;
    }

    const page = await state.pdfDocument.getPage(state.pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(260, elements.shell.clientWidth - (window.innerWidth <= 760 ? 22 : 38));
    const scale = Math.min(1.45, availableWidth / baseViewport.width);
    const viewport = page.getViewport({ scale });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const context = elements.canvas.getContext('2d', { alpha: false });

    state.renderWidth = viewport.width;
    state.renderHeight = viewport.height;
    state.renderScale = scale;
    elements.canvas.width = Math.ceil(viewport.width * pixelRatio);
    elements.canvas.height = Math.ceil(viewport.height * pixelRatio);
    elements.canvas.style.width = `${viewport.width}px`;
    elements.canvas.style.height = `${viewport.height}px`;
    elements.stage.style.width = `${viewport.width}px`;
    elements.stage.style.height = `${viewport.height}px`;

    const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0]
    });
    state.renderTask = renderTask;
    try { await renderTask.promise; }
    catch (error) {
        if (error?.name !== 'RenderingCancelledException') throw error;
    } finally {
        if (state.renderTask === renderTask) state.renderTask = null;
    }
    updatePageControls();
    updateOverlayElement();
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
    if (!state.pdfDocument) return;
    state.pageNumber = Math.min(state.pdfDocument.numPages, Math.max(1, Number(nextPage) || 1));
    renderCurrentPage();
}

function updatePageControls() {
    const count = state.pdfDocument?.numPages || 1;
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

async function sendPdfToDingTalk() {
    if (state.sending || !state.sourceBytes || !state.imageFile || !state.overlay) return;
    const user = readCurrentUser();
    if (!user?.unionId) {
        showProgress('请先在钉钉中登录网站', 100, 'error');
        return;
    }

    state.sending = true;
    updateReadyState();
    try {
        showProgress('正在生成 PDF 文件', 18);
        const resultBytes = await createResultPdf();
        showProgress('文件已生成，正在发送到钉钉', 68);
        if (resultBytes.byteLength > MAX_RESULT_BYTES) {
            throw new Error('处理后的 PDF 超过 20MB，请使用较小的 PDF 或图片');
        }

        const fileName = resultFileName(state.pdfFile.name);
        const formData = new FormData();
        formData.append('file', new Blob([resultBytes], { type: 'application/pdf' }), fileName);
        formData.append('fileName', fileName);
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

async function createResultPdf() {
    if (!window.PDFLib?.PDFDocument) throw new Error('PDF 处理组件加载失败，请刷新页面重试');
    const imageBytes = await normalizedImageBytes(state.imageFile);
    return composePdfImage({
        PDFDocument: window.PDFLib.PDFDocument,
        pdfBytes: state.sourceBytes,
        imageBytes: imageBytes.bytes,
        imageType: imageBytes.type,
        targetPage: state.targetPage,
        placement: state.overlay
    });
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
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片转换失败')), 'image/png'));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/png' };
}

function resetPdfTool(options = {}) {
    if (state.renderTask) state.renderTask.cancel();
    state.pdfDocument?.destroy?.();
    releaseImageUrl();
    Object.assign(state, {
        pdfFile: null,
        sourceBytes: null,
        pdfDocument: null,
        imageFile: null,
        imageUrl: '',
        pageNumber: 1,
        targetPage: 1,
        renderWidth: 0,
        renderHeight: 0,
        renderScale: 1,
        renderTask: null,
        overlay: null
    });
    elements.fileInput.value = '';
    elements.imageInput.value = '';
    elements.fileName.textContent = '支持 20MB 以内文件';
    elements.imageName.textContent = 'PNG、JPG 或 WebP';
    elements.fileBox.classList.remove('ready');
    elements.imageBox.classList.remove('ready');
    elements.editor.hidden = true;
    elements.empty.hidden = false;
    elements.overlay.hidden = true;
    elements.overlayImage.removeAttribute('src');
    elements.targetPage.innerHTML = '';
    elements.scaleRange.value = '25';
    elements.opacityRange.value = '100';
    elements.scaleOutput.textContent = '25%';
    elements.opacityOutput.textContent = '100%';
    const context = elements.canvas.getContext('2d');
    context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    if (!options.keepProgress) clearProgress();
    updateReadyState();
}

function updateReadyState() {
    elements.sendButton.disabled = state.sending || !state.sourceBytes || !state.imageFile || !state.overlay;
    elements.clearButton.disabled = state.sending;
    elements.fileInput.disabled = state.sending;
    elements.imageInput.disabled = state.sending;
    elements.sendButton.innerHTML = state.sending
        ? '<span>正在发送...</span>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>发送到我的钉钉';
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

function readImageDimensions(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('图片读取失败，请更换图片'));
        image.src = url;
    });
}

function releaseImageUrl() {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = '';
}

function resultFileName(originalName) {
    const base = String(originalName || 'PDF文件').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80) || 'PDF文件';
    return `${base}-已添加图片.pdf`;
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
