const SIZE_PRESETS = {
    aplus1464: { sourceWidth: 1464, sourceHeight: 600, width: 1464, height: 600 },
    wide2560: { sourceWidth: 2560, sourceHeight: 1024, width: 1464, height: 600 },
    square2k: { sourceWidth: 2048, sourceHeight: 2048, width: 1600, height: 1600 }
};

const imageInput = document.getElementById('imageInput');
const sizePreset = document.getElementById('sizePreset');
const dropZone = document.getElementById('dropZone');
const status = document.getElementById('status');
const downloadBtn = document.getElementById('downloadBtn');
const emptyPreview = document.getElementById('emptyPreview');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
const dropText = document.getElementById('dropText');
const outputBadge = document.getElementById('outputBadge');
let sourceName = 'aplus-image';
let outputType = 'image/png';

function initSidebarUser() {
    try {
        const stored = sessionStorage.getItem('dt_user') || localStorage.getItem('dt_user');
        if (!stored) return;
        const user = JSON.parse(stored);
        const avatar = document.getElementById('userAvatar');
        const loginIcon = document.getElementById('loginIcon');
        const userLink = document.getElementById('resizeUserLink');
        if (avatar && user.avatar) {
            avatar.src = user.avatar;
            avatar.hidden = false;
            loginIcon.hidden = true;
        }
        if (userLink && user.name) userLink.title = `${user.name}（进入图片制作）`;
    } catch {}
}

sizePreset.addEventListener('change', () => {
    updatePresetText();
    resetIdle();
});

imageInput.addEventListener('change', () => {
    if (imageInput.files[0]) loadFile(imageInput.files[0]);
    imageInput.value = '';
});

['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.add('dragging');
}));

['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
}));

dropZone.addEventListener('drop', event => {
    const file = event.dataTransfer.files[0];
    if (file) loadFile(file);
});

downloadBtn.addEventListener('click', () => {
    canvas.toBlob(blob => {
        if (!blob) return;
        const preset = getCurrentPreset();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${sourceName}-${preset.width}x${preset.height}.${outputType === 'image/jpeg' ? 'jpg' : 'png'}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, outputType, 0.95);
});

function loadFile(file) {
    resetOutput();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        showError('请选择 JPG、PNG 或 WebP 图片。');
        return;
    }
    if (file.size > 20 * 1024 * 1024) {
        showError('图片不能超过 20 MB。');
        return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
        URL.revokeObjectURL(url);
        const preset = getCurrentPreset();
        if (image.naturalWidth !== preset.sourceWidth || image.naturalHeight !== preset.sourceHeight) {
            showError(`当前图片是 ${image.naturalWidth} × ${image.naturalHeight}，请上传 ${preset.sourceWidth} × ${preset.sourceHeight} 图片。`);
            return;
        }
        sourceName = file.name.replace(/\.[^.]+$/, '') || 'aplus-image';
        outputType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
        canvas.width = preset.width;
        canvas.height = preset.height;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.clearRect(0, 0, preset.width, preset.height);
        drawWithoutVerticalCrop(image, preset);
        canvas.style.display = 'block';
        emptyPreview.hidden = true;
        downloadBtn.disabled = false;
        status.className = 'status ready';
        status.textContent = `转换完成：${preset.sourceWidth} × ${preset.sourceHeight} → ${preset.width} × ${preset.height}`;
    };
    image.onerror = () => {
        URL.revokeObjectURL(url);
        showError('图片读取失败，请重新选择。');
    };
    image.src = url;
}

function getCurrentPreset() {
    return SIZE_PRESETS[sizePreset.value] || SIZE_PRESETS.aplus1464;
}

function drawWithoutVerticalCrop(image, preset) {
    const scaledWidth = image.naturalWidth * (preset.height / image.naturalHeight);
    const drawX = (preset.width - scaledWidth) / 2;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, preset.width, preset.height);
    if (scaledWidth < preset.width) {
        context.drawImage(image, 0, 0, preset.width, preset.height);
        return;
    }
    context.drawImage(image, drawX, 0, scaledWidth, preset.height);
}

function updatePresetText() {
    const preset = getCurrentPreset();
    dropText.textContent = `上传 ${preset.sourceWidth} × ${preset.sourceHeight} 图片`;
    downloadBtn.textContent = `下载 ${preset.width} × ${preset.height} 图片`;
    if (outputBadge) outputBadge.textContent = `${preset.width} × ${preset.height}`;
}

function resetOutput() {
    downloadBtn.disabled = true;
    canvas.style.display = 'none';
    emptyPreview.hidden = false;
    status.className = 'status';
    status.textContent = '正在读取图片...';
}

function resetIdle() {
    downloadBtn.disabled = true;
    canvas.style.display = 'none';
    emptyPreview.hidden = false;
    status.className = 'status';
    status.textContent = '等待上传图片';
}

function showError(message) {
    status.className = 'status error';
    status.textContent = message;
}

updatePresetText();
initSidebarUser();
