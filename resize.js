const SIZE_PRESETS = {
    aplus: { sourceWidth: 1536, sourceHeight: 608, width: 1464, height: 600 }
};

const imageInput = document.getElementById('imageInput');
const sizePreset = document.getElementById('sizePreset');
const dropZone = document.getElementById('dropZone');
const status = document.getElementById('status');
const downloadBtn = document.getElementById('downloadBtn');
const emptyPreview = document.getElementById('emptyPreview');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
let sourceName = 'aplus-image';
let outputType = 'image/png';

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
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${sourceName}-1464x600.${outputType === 'image/jpeg' ? 'jpg' : 'png'}`;
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
        const preset = SIZE_PRESETS[sizePreset.value];
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
        context.drawImage(image, 0, 0, preset.width, preset.height);
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

function resetOutput() {
    downloadBtn.disabled = true;
    canvas.style.display = 'none';
    emptyPreview.hidden = false;
    status.className = 'status';
    status.textContent = '正在读取图片...';
}

function showError(message) {
    status.className = 'status error';
    status.textContent = message;
}
