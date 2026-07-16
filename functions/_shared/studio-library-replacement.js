export function normalizeLibraryReplacement(value) {
    if (!value || typeof value !== 'object') return null;
    const sourceKey = String(value.sourceKey || '').trim();
    const targetKey = String(value.targetKey || '').trim();
    const targetName = String(value.targetName || '').trim();
    const contentType = value.contentType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    if (!sourceKey.startsWith('library/') || !targetKey.startsWith('library/') || !targetName) return null;
    return { sourceKey, targetKey, targetName, contentType };
}

export function isSilentLibraryReplacement(task) {
    return task?.silent === true && Boolean(normalizeLibraryReplacement(task.libraryReplacement));
}

export function isAdminLibraryCutoutTask(task) {
    return task?.mode === 'cutout' && task?.category === '资料库自动去除背景';
}

export function ensureSilentLibraryReplacement(task) {
    if (isSilentLibraryReplacement(task)) return true;
    if (!isAdminLibraryCutoutTask(task)) return false;
    const source = Array.isArray(task.refKeys) ? task.refKeys.find(item => item?.key?.startsWith('library/')) : null;
    if (!source?.key) return false;

    const sourceName = String(task.imageName || source.name || decodeKeyName(source.key) || '图片.png');
    const outputFormat = task.cutoutOutputFormat === 'jpg' ? 'jpg' : 'png';
    const keepsName = outputFormat === 'jpg' ? /\.jpe?g$/i.test(sourceName) : /\.png$/i.test(sourceName);
    const targetName = keepsName
        ? sourceName
        : `${sourceName.replace(/\.[^.]+$/, '') || '图片'}-去背景.${outputFormat}`;
    const targetKey = keepsName ? source.key : source.key.replace(/[^/]+$/, encodeURIComponent(targetName));
    task.silent = true;
    task.libraryReplacement = {
        sourceKey: source.key,
        targetKey,
        targetName,
        contentType: outputFormat === 'jpg' ? 'image/jpeg' : 'image/png'
    };
    task.dingtalkNotified = true;
    task.r2AutoNotified = true;
    return true;
}

export async function replaceLibraryImage(env, task, bytes) {
    if (!env.SUBMISSION_FILES) throw new Error('R2 storage not configured');
    const replacement = normalizeLibraryReplacement(task?.libraryReplacement);
    if (!replacement) throw new Error('Library replacement target is invalid');

    await retryStorageOperation(() => env.SUBMISSION_FILES.put(replacement.targetKey, bytes, {
        httpMetadata: { contentType: replacement.contentType }
    }));
    if (replacement.targetKey !== replacement.sourceKey) {
        await retryStorageOperation(() => env.SUBMISSION_FILES.delete(replacement.sourceKey));
    }
    return { key: replacement.targetKey, name: replacement.targetName };
}

export function completeSilentLibraryReplacement(task, result) {
    task.resultKeys = [result];
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.completeNote = '资料库原图已自动替换';
    task.dingtalkNotified = true;
    task.r2AutoNotified = true;
    task.dingtalkNotificationState = 'silent';
    task.dingtalkNotificationStartedAt = '';
}

async function retryStorageOperation(operation) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 300));
        }
    }
    throw lastError || new Error('R2 operation failed');
}

function decodeKeyName(key) {
    try { return decodeURIComponent(String(key).split('/').pop() || ''); }
    catch { return String(key).split('/').pop() || ''; }
}
