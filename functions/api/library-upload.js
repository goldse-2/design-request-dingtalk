export async function onRequestPost(context) {
    const { request, env } = context;
    if (!env.SUBMISSION_FILES) {
        return Response.json({ ok: false, error: 'R2 not configured' }, { status: 500 });
    }

    let body;
    try { body = await request.json(); } catch {
        return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { product, category, files } = body;
    if (!product || !files || !files.length) {
        return Response.json({ ok: false, error: 'Missing product or files' }, { status: 400 });
    }
    const cat = category || '未分类';

    const results = [];
    for (const file of files) {
        const { name, base64, mimeType } = file;
        if (!name || !base64) continue;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const key = `library/${encodeURIComponent(cat)}/${encodeURIComponent(product)}/${encodeURIComponent(name)}`;
        await env.SUBMISSION_FILES.put(key, bytes, {
            httpMetadata: { contentType: mimeType || 'application/octet-stream' }
        });
        results.push({ key, name });
    }

    return Response.json({ ok: true, uploaded: results });
}

export async function onRequestDelete(context) {
    const { request, env } = context;
    if (!env.SUBMISSION_FILES) {
        return Response.json({ ok: false, error: 'R2 not configured' }, { status: 500 });
    }
    let body;
    try { body = await request.json(); } catch {
        return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }
    const { key } = body;
    if (!key) return Response.json({ ok: false, error: 'Missing key' }, { status: 400 });
    await env.SUBMISSION_FILES.delete(key);
    return Response.json({ ok: true });
}
