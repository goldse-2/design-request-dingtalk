const passwordEl = document.getElementById('uploadPassword');
const taskIdEl = document.getElementById('taskId');
const drop = document.getElementById('resultDrop');
const fileInput = document.getElementById('resultFiles');
const previewList = document.getElementById('previewList');
const uploadBtn = document.getElementById('uploadBtn');
const statusEl = document.getElementById('uploadStatus');
let pendingFiles = [];

function setStatus(text, ok = null) {
    statusEl.textContent = text;
    statusEl.style.color = ok === true ? '#16a34a' : ok === false ? '#ef4444' : '#6b7280';
}

function addFiles(files) {
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    pendingFiles.push(...imgs);
    renderPreview();
}

function renderPreview() {
    previewList.innerHTML = '';
    previewList.hidden = !pendingFiles.length;
    pendingFiles.forEach((file, idx) => {
        const item = document.createElement('div');
        item.className = 'rpa-preview-item';
        const url = URL.createObjectURL(file);
        item.innerHTML = `<img src="${url}" alt=""><div><strong>${escapeHtml(file.name)}</strong><small>${formatSize(file.size)}</small></div><button type="button">×</button>`;
        item.querySelector('button').onclick = () => {
            pendingFiles.splice(idx, 1);
            URL.revokeObjectURL(url);
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
    const res = await fetch('/api/studio-result-upload', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, password }),
        cache: 'no-store'
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || res.status);
    return {
        mode: json.mode,
        outputFormat: json.outputFormat || (json.mode === 'cutout' ? 'png' : '')
    };
}

function isPngFile(file) {
    return file.type === 'image/png' || /\.png$/i.test(file.name || '');
}

function isJpegFile(file) {
    return file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name || '');
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
    if (taskInfo.mode === 'cutout') {
        if (taskInfo.outputFormat === 'jpg') {
            return isJpegFile(file) ? file : convertImageFile(file, 'image/jpeg', 'jpg', true);
        }
        return isPngFile(file) ? file : convertImageFile(file, 'image/png', 'png', false);
    }
    if (!isPngFile(file)) return file;
    return convertImageFile(file, 'image/jpeg', 'jpg', true);
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
    if (!pendingFiles.length) { setStatus('请选择成品图片', false); return; }

    uploadBtn.disabled = true;
    uploadBtn.textContent = '上传中...';
    setStatus('正在读取任务类型...', null);

    try {
        const taskInfo = await getUploadTaskMode(taskId, password);
        if (taskInfo.mode === 'cutout') {
            setStatus(`白底抠图任务将导出 ${taskInfo.outputFormat.toUpperCase()}，正在处理...`, null);
        } else {
            setStatus('正在处理图片，PNG 将自动转换为 JPG...', null);
        }

        const form = new FormData();
        form.append('password', password);
        form.append('taskId', taskId);
        const uploadFiles = [];
        for (const file of pendingFiles) {
            uploadFiles.push(await normalizeUploadFile(file, taskInfo));
        }
        uploadFiles.forEach(file => form.append('files', file, file.name));

        setStatus('正在上传并通知用户...', null);
        const res = await fetch('/api/studio-result-upload', { method: 'POST', body: form });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error || res.status);
        setStatus('上传成功，已通知用户，共 ' + json.uploaded.length + ' 张图片', true);
        pendingFiles = [];
        renderPreview();
    } catch (err) {
        const message = err instanceof TypeError && /fetch/i.test(err.message || '')
            ? '网络或 Cloudflare 存储连接中断，请稍后再试'
            : err.message;
        setStatus('上传失败：' + message, false);
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '上传并通知用户';
    }
});
