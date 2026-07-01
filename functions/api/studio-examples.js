export async function onRequestGet(context) {
    const { env, request } = context;
    const url = new URL(request.url);
    const includeAll = url.searchParams.get('all') === '1';
    const builtin = await getBuiltinExamples(context);
    const custom = await getCustomExamples(env);
    const visibleCustom = includeAll ? custom : custom.filter(x => x.status === 'approved');
    return Response.json({ ok: true, examples: [...visibleCustom, ...builtin] });
}

export async function onRequestPost(context) {
    const { request, env } = context;
    if (!env.SUBMISSION_FILES || !env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { prompt, file } = body;
    if (!prompt || !file || !file.base64) {
        return Response.json({ ok: false, error: 'Missing prompt or image' }, { status: 400 });
    }

    const id = 'example-' + crypto.randomUUID();
    const title = makeTitle(prompt);
    const ext = mimeToExt(file.mimeType || 'image/png');
    const key = `studio-examples/${id}${ext}`;

    const bytes = base64ToBytes(file.base64);
    await env.SUBMISSION_FILES.put(key, bytes, {
        httpMetadata: { contentType: file.mimeType || 'image/png' }
    });

    const item = {
        id,
        title,
        image: `/api/library-file/${encodeURIComponent(key)}`,
        imageKey: key,
        prompt,
        source: 'custom',
        status: 'pending',
        createdAt: new Date().toISOString()
    };

    const list = await getCustomExamples(env);
    list.unshift(item);
    await env.SUBMISSIONS.put('studio-examples-index', JSON.stringify(list));

    return Response.json({ ok: true, example: item });
}

export async function onRequestPatch(context) {
    const { request, env } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { id, action, prompt } = body;
    if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });

    const list = await getCustomExamples(env);
    const target = list.find(x => x.id === id);
    if (!target) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });

    if (action === 'approve') target.status = 'approved';
    else if (action === 'reject') target.status = 'pending';
    if (typeof prompt === 'string' && prompt.trim()) {
        target.prompt = prompt.trim();
        target.title = makeTitle(prompt);
    }

    await env.SUBMISSIONS.put('studio-examples-index', JSON.stringify(list));
    return Response.json({ ok: true, example: target });
}

export async function onRequestDelete(context) {
    const { request, env } = context;
    if (!env.SUBMISSION_FILES || !env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { id } = body;
    if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });

    const list = await getCustomExamples(env);
    const target = list.find(x => x.id === id);
    const next = list.filter(x => x.id !== id);
    if (target && target.imageKey) await env.SUBMISSION_FILES.delete(target.imageKey).catch(() => {});
    await env.SUBMISSIONS.put('studio-examples-index', JSON.stringify(next));
    return Response.json({ ok: true });
}

async function getCustomExamples(env) {
    if (!env.SUBMISSIONS) return [];
    const raw = await env.SUBMISSIONS.get('studio-examples-index');
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
}

async function getBuiltinExamples(context) {
    try {
        const url = new URL('/assets/studio-examples/examples.json', context.request.url);
        const res = await fetch(url);
        if (!res.ok) return [];
        const list = await res.json();
        return list.map((x, i) => ({ ...x, id: x.id || `builtin-${i}`, source: 'builtin' }));
    } catch {
        return [];
    }
}

function makeTitle(prompt) {
    return String(prompt)
        .replace(/\s+/g, ' ')
        .replace(/[\[\]{}<>"'`]/g, '')
        .trim()
        .slice(0, 18) || '未命名案例';
}

function mimeToExt(mime) {
    if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
    if (mime.includes('webp')) return '.webp';
    if (mime.includes('gif')) return '.gif';
    return '.png';
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
