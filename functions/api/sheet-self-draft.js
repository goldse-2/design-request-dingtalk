const DRAFT_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function onRequestGet(context) {
    const { request, env } = context;
    if (!env.SUBMISSIONS) return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    const unionId = cleanUnionId(new URL(request.url).searchParams.get('unionId'));
    if (!unionId) return Response.json({ ok: false, error: '缺少用户信息' }, { status: 400 });
    const raw = await env.SUBMISSIONS.get(draftKey(unionId));
    return Response.json({ ok: true, draft: raw ? safeJson(raw) : null }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPut(context) {
    const { request, env } = context;
    if (!env.SUBMISSIONS) return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }
    const unionId = cleanUnionId(body.unionId);
    if (!unionId) return Response.json({ ok: false, error: '缺少用户信息' }, { status: 400 });

    const draft = normalizeDraft(body.draft);
    const key = draftKey(unionId);
    const oldRaw = await env.SUBMISSIONS.get(key).catch(() => null);
    const oldDraft = oldRaw ? safeJson(oldRaw) : null;
    await env.SUBMISSIONS.put(key, JSON.stringify(draft), { expirationTtl: DRAFT_TTL_SECONDS });

    if (env.SUBMISSION_FILES) {
        const retained = collectKeys(draft);
        const removed = [...collectKeys(oldDraft)].filter(fileKey => !retained.has(fileKey));
        await Promise.all(removed.map(fileKey => env.SUBMISSION_FILES.delete(fileKey).catch(() => {})));
    }
    return Response.json({ ok: true, savedAt: draft.savedAt });
}

export async function onRequestDelete(context) {
    const { request, env } = context;
    if (!env.SUBMISSIONS) return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    let body;
    try { body = await request.json(); }
    catch { body = {}; }
    const unionId = cleanUnionId(body.unionId);
    if (!unionId) return Response.json({ ok: false, error: '缺少用户信息' }, { status: 400 });
    const key = draftKey(unionId);
    const raw = await env.SUBMISSIONS.get(key).catch(() => null);
    if (raw && body.preserveFiles !== true && env.SUBMISSION_FILES) {
        const draft = safeJson(raw);
        await Promise.all([...collectKeys(draft)].map(fileKey => env.SUBMISSION_FILES.delete(fileKey).catch(() => {})));
    }
    await env.SUBMISSIONS.delete(key);
    return Response.json({ ok: true });
}

function normalizeDraft(value) {
    const slots = Array.isArray(value?.slots) ? value.slots.slice(0, 6).map((slot, index) => ({
        index,
        photographer: slot?.photographer === true,
        productName: cleanText(slot?.productName, 100),
        title: cleanText(slot?.title, 100),
        subtitle: cleanText(slot?.subtitle, 100),
        otherText: cleanText(slot?.otherText, 300),
        referenceKey: normalizeFileKey(slot?.referenceKey),
        productKeys: Array.isArray(slot?.productKeys) ? slot.productKeys.slice(0, 2).map(normalizeFileKey).filter(Boolean) : []
    })) : [];
    while (slots.length < 6) slots.push({ index: slots.length, photographer: false, productName: '', title: '', subtitle: '', otherText: '', referenceKey: null, productKeys: [] });
    return { version: 1, slots, savedAt: new Date().toISOString() };
}

function normalizeFileKey(value) {
    const key = String(value?.key || '').trim();
    if (!key.startsWith('studio/sheet-self/')) return null;
    return { key, name: cleanText(value?.name || '图片.jpg', 160) };
}

function collectKeys(draft) {
    const keys = new Set();
    (draft?.slots || []).forEach(slot => {
        if (slot?.referenceKey?.key) keys.add(slot.referenceKey.key);
        (slot?.productKeys || []).forEach(item => { if (item?.key) keys.add(item.key); });
    });
    return keys;
}

function draftKey(unionId) { return `sheet-self:draft:${unionId}`; }
function cleanUnionId(value) { return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 160); }
function cleanText(value, maxLength) { return String(value || '').trim().slice(0, maxLength); }
function safeJson(raw) { try { return JSON.parse(raw); } catch { return null; } }
