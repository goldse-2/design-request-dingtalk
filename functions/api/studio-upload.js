export async function onRequestPost(context) {
    const { request, env } = context;

    if (!env.SUBMISSION_FILES) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    let formData;
    try { formData = await request.formData(); }
    catch { return Response.json({ ok: false, error: 'Invalid form data' }, { status: 400 }); }

    const file = formData.get('file');
    const prefix = String(formData.get('prefix') || 'studio/upload');
    const uploadId = normalizeUploadId(formData.get('uploadId'));

    if (!file || typeof file === 'string') {
        return Response.json({ ok: false, error: 'No file provided' }, { status: 400 });
    }
    if (!file.type?.startsWith('image/')) {
        return Response.json({ ok: false, error: 'Only image files are allowed' }, { status: 400 });
    }
    const maxSize = prefix === 'studio/resize'
        ? 20 * 1024 * 1024
        : (['studio/retouch', 'studio/cutout', 'studio/variant', 'studio/translation', 'studio/watermark', 'studio/sheet-self', 'shoot/complete'].includes(prefix))
            ? 15 * 1024 * 1024
            : 8 * 1024 * 1024;
    if (file.size > maxSize) {
        return Response.json({ ok: false, error: `Image must not exceed ${Math.round(maxSize / 1024 / 1024)}MB` }, { status: 413 });
    }

    const ext = safeImageExtension(file.name, file.type);
    const key = `${prefix}/${uploadId || crypto.randomUUID()}.${ext}`;

    try {
        const bytes = await file.arrayBuffer();
        await env.SUBMISSION_FILES.put(key, bytes, {
            httpMetadata: { contentType: file.type || 'image/png' }
        });
    } catch (error) {
        console.error('Studio image upload failed:', error?.message || error);
        return Response.json({
            ok: false,
            error: '图片存储暂时不可用，请稍后重试'
        }, {
            status: 503,
            headers: { 'Retry-After': '1' }
        });
    }

    return Response.json({ ok: true, key, name: file.name });
}

function normalizeUploadId(value) {
    const id = String(value || '').trim();
    return /^[a-z0-9-]{8,80}$/i.test(id) ? id : '';
}

function safeImageExtension(name, type) {
    const extension = String(name || '').split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return extension;
    if (type === 'image/jpeg') return 'jpg';
    if (type === 'image/webp') return 'webp';
    return 'png';
}
