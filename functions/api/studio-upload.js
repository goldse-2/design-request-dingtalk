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

    if (!file || typeof file === 'string') {
        return Response.json({ ok: false, error: 'No file provided' }, { status: 400 });
    }
    if (!file.type?.startsWith('image/')) {
        return Response.json({ ok: false, error: 'Only image files are allowed' }, { status: 400 });
    }
    const maxSize = prefix === 'studio/resize'
        ? 20 * 1024 * 1024
        : (prefix === 'studio/retouch' || prefix === 'studio/variant' || prefix === 'shoot/complete')
            ? 15 * 1024 * 1024
            : 8 * 1024 * 1024;
    if (file.size > maxSize) {
        return Response.json({ ok: false, error: `Image must not exceed ${Math.round(maxSize / 1024 / 1024)}MB` }, { status: 413 });
    }

    const ext = (file.name || 'img.png').split('.').pop().toLowerCase();
    const key = `${prefix}/${crypto.randomUUID()}.${ext}`;
    const bytes = await file.arrayBuffer();

    await env.SUBMISSION_FILES.put(key, bytes, {
        httpMetadata: { contentType: file.type || 'image/png' }
    });

    return Response.json({ ok: true, key, name: file.name });
}
