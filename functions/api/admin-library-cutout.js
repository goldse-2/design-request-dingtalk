import { onRequestPost as submitStudioRequest } from './studio-submit.js';

export async function onRequestPost(context) {
    const { request } = context;
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

    const productName = String(body.productName || '').trim();
    const category = String(body.category || '').trim();
    const files = Array.isArray(body.files) ? body.files.slice(0, 20).filter(validLibraryImage) : [];
    if (!productName || !files.length) {
        return Response.json({ ok: false, error: '缺少产品名称或图片' }, { status: 400 });
    }

    const tasks = [];
    const failures = [];
    for (const file of files) {
        const libraryReplacement = buildLibraryReplacement(file);
        const studioRequest = new Request(new URL('/api/studio-submit', request.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: 'cutout',
                submitter: { name: '资料库管理员' },
                category: '资料库自动去除背景',
                note: `资料库：${category || '未分类'}/${productName}`,
                productName,
                imageName: file.name,
                productKeys: [],
                refKeys: [{ key: file.key, name: file.name }],
                modelKeys: [],
                cutoutOutputFormat: libraryReplacement.contentType === 'image/jpeg' ? 'jpg' : 'png'
            })
        });
        try {
            const response = await submitStudioRequest({
                ...context,
                request: studioRequest,
                internalTaskOptions: { silent: true, libraryReplacement }
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `提交失败 (${response.status})`);
            tasks.push({ file: file.name, id: result.id, autoSent: result.autoSent === true });
        } catch (error) {
            failures.push({ file: file.name, error: error.message || String(error) });
        }
    }

    if (!tasks.length) {
        return Response.json({ ok: false, error: failures[0]?.error || '提交失败', failures }, { status: 502 });
    }
    return Response.json({ ok: true, tasks, failures });
}

function validLibraryImage(file) {
    return file
        && typeof file.key === 'string'
        && file.key.startsWith('library/')
        && typeof file.name === 'string'
        && /\.(png|jpe?g|webp)$/i.test(file.name);
}

function buildLibraryReplacement(file) {
    const isJpeg = /\.jpe?g$/i.test(file.name);
    const isWebp = /\.webp$/i.test(file.name);
    const targetName = isWebp ? file.name.replace(/\.webp$/i, '-去背景.png') : file.name;
    const targetKey = isWebp
        ? file.key.replace(/[^/]+$/, encodeURIComponent(targetName))
        : file.key;
    return {
        sourceKey: file.key,
        targetKey,
        targetName,
        contentType: isJpeg ? 'image/jpeg' : 'image/png'
    };
}
