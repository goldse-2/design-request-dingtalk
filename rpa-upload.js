const passwordEl = document.getElementById('uploadPassword');
const taskIdEl = document.getElementById('taskId');
const drop = document.getElementById('resultDrop');
const fileInput = document.getElementById('resultFiles');
const previewList = document.getElementById('previewList');
const uploadBtn = document.getElementById('uploadBtn');
const statusEl = document.getElementById('uploadStatus');
let pendingFiles = [];
let currentUploadPercent = 0;

function setStatus(text, ok = null) {
    statusEl.textContent = text;
    statusEl.style.color = ok === true ? '#16a34a' : ok === false ? '#ef4444' : '#6b7280';
}

function renderUploadProgress(title, percent, detail = '', countText = '', state = '') {
    const nextPercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    currentUploadPercent = state === 'error' ? nextPercent : Math.max(currentUploadPercent, nextPercent);
    const shownPercent = state === 'error' ? nextPercent : currentUploadPercent;
    statusEl.className = `rpa-upload-status rpa-submit-progress${state ? ` is-${state}` : ''}`;
    statusEl.style.color = '';
    statusEl.innerHTML = `<div class="rpa-submit-progress-head"><strong>${escapeHtml(title)}</strong><span>${shownPercent}%</span></div>
        <div class="rpa-submit-progress-track" role="progressbar" aria-label="上传进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${shownPercent}"><span class="rpa-submit-progress-bar" style="width:${shownPercent}%"></span></div>
        <div class="rpa-submit-progress-meta"><span>${escapeHtml(detail)}</span><span>${escapeHtml(countText)}</span></div>`;
}

function addFiles(files) {
    const accepted = Array.from(files).filter(file => file.type.startsWith('image/') || isVectorFile(file));
    if (!accepted.length) {
        setStatus('请选择图片、SVG 或 Adobe Illustrator（.ai）文件', false);
        return;
    }
    pendingFiles.push(...accepted);
    renderPreview();
}

function renderPreview() {
    previewList.innerHTML = '';
    previewList.hidden = !pendingFiles.length;
    pendingFiles.forEach((file, idx) => {
        const item = document.createElement('div');
        item.className = 'rpa-preview-item';
        const isAi = isAdobeAiFile(file);
        const isSvg = isSvgFile(file);
        const url = isAi ? '' : URL.createObjectURL(file);
        const preview = isAi
            ? '<div aria-hidden="true" style="width:58px;height:58px;border-radius:9px;background:#fff7ed;color:#9a3412;display:grid;place-items:center;font-weight:900;font-size:1rem;border:1px solid #fed7aa">AI</div>'
            : `<img src="${url}" alt="">`;
        const formatLabel = isAi ? 'Adobe Illustrator · ' : isSvg ? 'SVG 矢量图 · ' : '';
        item.innerHTML = `${preview}<div><strong>${escapeHtml(file.name)}</strong><small>${formatLabel}${formatSize(file.size)}</small></div><button type="button">×</button>`;
        item.querySelector('button').onclick = () => {
            pendingFiles.splice(idx, 1);
            if (url) URL.revokeObjectURL(url);
            renderPreview();
        };
        previewList.appendChild(item);
    });
}

function formatSize(size) {
    if (size < 1024 * 1024) return Math.round(size / 1024) + ' KB';
    return (size / 1024 / 1024).toFixed(1) + ' MB';
}

function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function getUploadTaskMode(taskId, password) {
    return retryRequest(async () => {
        const res = await fetch('/api/studio-result-upload', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, password }),
            cache: 'no-store'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw requestError(json.error || res.status, res.status);
        return {
            mode: json.mode,
            cutoutMode: json.cutoutMode === 'vector' ? 'vector' : 'normal',
            outputFormat: json.outputFormat || (json.mode === 'cutout' ? 'png' : ''),
            aPlusDouble: json.aPlusDouble === true,
            libraryReplacement: json.libraryReplacement === true
        };
    });
}

function requestError(message, status) {
    const error = new Error(String(message || 'Failed to fetch'));
    error.status = Number(status) || 0;
    return error;
}

function canRetry(error) {
    return error instanceof TypeError || !error.status || error.status === 429 || error.status >= 500;
}

async function retryRequest(request, attempts = 3, onRetry) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await request();
        } catch (error) {
            lastError = error;
            if (!canRetry(error) || attempt === attempts) throw error;
            onRetry?.({ attempt: attempt + 1, maxAttempts: attempts, error });
            await new Promise(resolve => setTimeout(resolve, attempt * 700));
        }
    }
    throw lastError;
}

function uploadResultFiles({ password, taskId, uploadId, files, onProgress }) {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('password', password);
        form.append('taskId', taskId);
        form.append('uploadId', uploadId);
        files.forEach(file => form.append('files', file, file.name));
        const request = new XMLHttpRequest();
        request.open('POST', '/api/studio-result-upload');
        request.timeout = 180000;
        request.upload.onprogress = event => {
            if (event.lengthComputable) onProgress(event.loaded / event.total);
        };
        request.onload = () => {
            let data = {};
            try { data = JSON.parse(request.responseText || '{}'); } catch {}
            if (request.status >= 200 && request.status < 300 && data.ok) {
                onProgress(1);
                resolve(data);
                return;
            }
            reject(requestError(data.error || request.status || '上传失败', request.status));
        };
        request.onerror = () => reject(requestError('网络连接中断', 0));
        request.ontimeout = () => reject(requestError('上传超时', 408));
        request.send(form);
    });
}

function createUploadId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function isPngFile(file) {
    return file.type === 'image/png' || /\.png$/i.test(file.name || '');
}

function isJpegFile(file) {
    return file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name || '');
}

function isAdobeAiFile(file) {
    const type = String(file?.type || '').toLowerCase();
    return /\.ai$/i.test(file?.name || '') || ['application/postscript', 'application/illustrator', 'application/vnd.adobe.illustrator'].includes(type);
}

function isSvgFile(file) {
    return /\.svg$/i.test(file?.name || '') || String(file?.type || '').toLowerCase() === 'image/svg+xml';
}

function isVectorFile(file) {
    return isAdobeAiFile(file) || isSvgFile(file);
}

async function convertImageFile(file, mimeType, extension, fillWhite) {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    if (fillWhite) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, mimeType === 'image/jpeg' ? 0.92 : undefined));
    if (!blob) throw new Error(`图片转 ${extension.toUpperCase()} 失败：${file.name}`);
    const baseName = String(file.name || 'result').replace(/\.[^.]+$/, '') || 'result';
    return new File([blob], `${baseName}.${extension}`, { type: mimeType, lastModified: Date.now() });
}

async function normalizeUploadFile(file, taskInfo) {
    if (isVectorFile(file)) return file;
    let normalized = file;
    if (taskInfo.mode === 'cutout') {
        if (taskInfo.outputFormat === 'jpg') {
            normalized = isJpegFile(file) ? file : await convertImageFile(file, 'image/jpeg', 'jpg', true);
        } else {
            normalized = isPngFile(file) ? file : await convertImageFile(file, 'image/png', 'png', false);
        }
    } else if (isPngFile(file)) {
        normalized = await convertImageFile(file, 'image/jpeg', 'jpg', true);
    }
    return resizeLegacyAPlusFile(normalized);
}

async function resizeLegacyAPlusFile(file) {
    if (/\.gif$/i.test(file.name || '') || file.type === 'image/gif') return file;
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(dataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width !== 1472 || height !== 608) return file;

    const mimeType = isPngFile(file)
        ? 'image/png'
        : file.type === 'image/webp' || /\.webp$/i.test(file.name || '') ? 'image/webp' : 'image/jpeg';
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const canvas = document.createElement('canvas');
    canvas.width = 1464;
    canvas.height = 600;
    const context = canvas.getContext('2d');
    if (mimeType === 'image/jpeg') {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, mimeType === 'image/jpeg' ? 0.94 : undefined));
    if (!blob) throw new Error(`图片转为 1464 × 600 失败：${file.name}`);
    const baseName = String(file.name || 'result').replace(/\.[^.]+$/, '') || 'result';
    return new File([blob], `${baseName}.${extension}`, { type: mimeType, lastModified: Date.now() });
}

async function splitAPlusDoubleFile(file) {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(dataUrl);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (sourceWidth < 2 || sourceHeight < 2) throw new Error('A+ 连续双图成品无法读取尺寸');

    const sourceHalfHeight = sourceHeight / 2;
    const baseName = String(file.name || 'A+连续双图').replace(/\.[^.]+$/, '') || 'A+连续双图';
    const names = [`${baseName}-上半部分.jpg`, `${baseName}-下半部分.jpg`];
    const results = [];
    for (let index = 0; index < 2; index++) {
        const canvas = document.createElement('canvas');
        canvas.width = 1464;
        canvas.height = 600;
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
            image,
            0,
            index * sourceHalfHeight,
            sourceWidth,
            sourceHalfHeight,
            0,
            0,
            canvas.width,
            canvas.height
        );
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
        if (!blob) throw new Error(`A+ ${index === 0 ? '上半部分' : '下半部分'}导出失败`);
        results.push(new File([blob], names[index], { type: 'image/jpeg', lastModified: Date.now() }));
    }
    return results;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('读取图片失败：' + file.name));
        reader.readAsDataURL(file);
    });
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('解析图片失败'));
        image.src = src;
    });
}

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('is-dragover'); });
drop.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('is-dragover');
    addFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => {
    addFiles(e.target.files);
    e.target.value = '';
});

uploadBtn.addEventListener('click', async () => {
    const password = passwordEl.value.trim();
    const taskId = taskIdEl.value.trim();
    if (!password) { setStatus('请输入上传密码', false); passwordEl.focus(); return; }
    if (!taskId) { setStatus('请输入任务 ID', false); taskIdEl.focus(); return; }
    if (!pendingFiles.length) { setStatus('请选择成品文件', false); return; }

    uploadBtn.disabled = true;
    uploadBtn.textContent = '上传中...';
    currentUploadPercent = 0;
    renderUploadProgress('正在读取任务类型', 5, '确认任务需要的图片格式和处理方式', '准备上传');

    try {
        const taskInfo = await getUploadTaskMode(taskId, password);
        const containsVector = pendingFiles.some(isVectorFile);
        if (taskInfo.aPlusDouble && containsVector) throw new Error('A+ 连续双图需要上传可拆分的位图，不能上传 AI 或 SVG 文件');
        if (taskInfo.libraryReplacement && containsVector) throw new Error('资料库替换任务需要上传位图，不能上传 AI 或 SVG 文件');
        if (taskInfo.mode === 'cutout' && taskInfo.cutoutMode === 'vector' && pendingFiles.some(file => !isVectorFile(file))) {
            throw new Error('矢量图白底任务请上传 Adobe Illustrator（.ai）或 SVG 文件');
        }
        if (taskInfo.mode === 'cutout' && taskInfo.cutoutMode !== 'vector' && containsVector) {
            throw new Error('普通白底抠图任务需要上传 PNG 或 JPG 位图');
        }
        if (taskInfo.aPlusDouble) {
            if (pendingFiles.length !== 1) throw new Error('A+ 连续双图任务请只上传一张完整成品图');
            renderUploadProgress('正在处理成品图片', 16, '自动拆分为上下两张 1464 × 600 JPG', '处理 1/1');
        } else if (taskInfo.mode === 'cutout' && taskInfo.cutoutMode === 'vector') {
            renderUploadProgress('正在检查矢量图文件', 16, '确认 AI 或 SVG 文件可以上传', `处理 0/${pendingFiles.length}`);
        } else if (taskInfo.mode === 'cutout') {
            renderUploadProgress('正在处理成品图片', 16, `白底抠图任务将导出 ${taskInfo.outputFormat.toUpperCase()}`, `处理 0/${pendingFiles.length}`);
        } else {
            renderUploadProgress('正在处理成品图片', 16, 'PNG 将自动转换为 JPG', `处理 0/${pendingFiles.length}`);
        }

        const uploadFiles = [];
        if (taskInfo.aPlusDouble) {
            uploadFiles.push(...await splitAPlusDoubleFile(pendingFiles[0]));
        } else {
            for (let index = 0; index < pendingFiles.length; index += 1) {
                const file = pendingFiles[index];
                renderUploadProgress('正在处理成品图片', 16 + (index / pendingFiles.length) * 16, file.name, `处理 ${index}/${pendingFiles.length}`);
                uploadFiles.push(await normalizeUploadFile(file, taskInfo));
            }
        }

        renderUploadProgress(`准备上传 ${uploadFiles.length} 个文件`, 34, '上传完成后会自动通知用户', `已上传 0/${uploadFiles.length}`);
        const uploadId = createUploadId();
        const json = await retryRequest(() => uploadResultFiles({
            password,
            taskId,
            uploadId,
            files: uploadFiles,
            onProgress: ratio => renderUploadProgress(
                '正在上传并通知用户',
                35 + ratio * 60,
                uploadFiles.length === 1 ? uploadFiles[0].name : `${uploadFiles.length} 个文件正在上传`,
                ratio >= 1 ? `已上传 ${uploadFiles.length}/${uploadFiles.length}` : `已上传 ${Math.floor(ratio * uploadFiles.length)}/${uploadFiles.length}`
            )
        }), 3, ({ attempt, maxAttempts, error }) => renderUploadProgress(
            `上传中断，正在自动重试 ${attempt}/${maxAttempts}`,
            currentUploadPercent,
            error.message,
            '文件已保留',
            'retrying'
        ));
        renderUploadProgress('上传完成', 100, '成品已保存并通知用户', `已完成 ${json.uploaded.length}/${json.uploaded.length}`, 'success');
        pendingFiles = [];
        renderPreview();
    } catch (err) {
        renderUploadProgress('上传失败', currentUploadPercent, err.message, '文件仍然保留', 'error');
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '上传并通知用户';
    }
});
