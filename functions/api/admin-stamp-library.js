import { listStampFiles, stampCompanyNameFromFileName, stampFilePutOptions, STAMP_LIBRARY_PREFIX } from '../_shared/stamp-workflow.js';

const MAX_STAMP_BYTES = 8 * 1024 * 1024;

export async function onRequestGet({ env }) {
    try {
        const stamps = await listStampFiles(env);
        return json({ ok: true, stamps: stamps.map(stamp => ({
            ...stamp,
            url: `/api/admin-stamp-file/${encodeURIComponent(stamp.key)}`
        })) });
    } catch (error) {
        return json({ ok: false, error: error.message }, 500);
    }
}

export async function onRequestPost({ request, env }) {
    if (!env.SUBMISSION_FILES) return json({ ok: false, error: '文件存储未配置' }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: '请求内容无效' }, 400); }
    const files = Array.isArray(body.files) ? body.files : [];
    if (!files.length) return json({ ok: false, error: '请先选择公章图片' }, 400);

    const uploaded = [];
    for (const file of files.slice(0, 100)) {
        const name = cleanFileName(file.name);
        const mimeType = normalizeMimeType(file.mimeType, name);
        if (!name || !['image/png', 'image/jpeg'].includes(mimeType)) {
            return json({ ok: false, error: `${name || '文件'} 只支持 PNG 或 JPG` }, 415);
        }
        if (!file.base64) return json({ ok: false, error: `${name} 文件内容为空` }, 400);
        const binary = atob(file.base64);
        if (binary.length > MAX_STAMP_BYTES) return json({ ok: false, error: `${name} 超过 8MB` }, 413);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const companyName = stampCompanyNameFromFileName(name);
        const key = `${STAMP_LIBRARY_PREFIX}${encodeURIComponent(companyName)}/${encodeURIComponent(name)}`;
        await env.SUBMISSION_FILES.put(key, bytes, stampFilePutOptions(env.SUBMISSION_FILES, mimeType, {
            kind: 'stamp-library',
            companyName,
            name,
            size: bytes.byteLength,
            uploadedAt: new Date().toISOString(),
            version: crypto.randomUUID()
        }));
        uploaded.push({ key, companyName, name });
    }
    return json({ ok: true, uploaded });
}

export async function onRequestDelete({ request, env }) {
    if (!env.SUBMISSION_FILES) return json({ ok: false, error: '文件存储未配置' }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: '请求内容无效' }, 400); }
    const key = String(body.key || '');
    if (!key.startsWith(STAMP_LIBRARY_PREFIX)) return json({ ok: false, error: '公章文件地址无效' }, 400);
    await env.SUBMISSION_FILES.delete(key);
    return json({ ok: true });
}

function cleanFileName(value) {
    return String(value || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 160).trim();
}

function normalizeMimeType(value, name) {
    if (value === 'image/png' || /\.png$/i.test(name)) return 'image/png';
    if (value === 'image/jpeg' || /\.jpe?g$/i.test(name)) return 'image/jpeg';
    return '';
}

function json(body, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
