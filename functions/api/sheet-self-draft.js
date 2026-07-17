const DRAFT_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_SLOT_COUNT = 3;
const MAX_SLOT_COUNT = 8;

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
    const legacyProductName = Array.isArray(value?.slots)
        ? value.slots.find(slot => String(slot?.productName || '').trim())?.productName
        : '';
    const sourceSlots = Array.isArray(value?.slots) ? value.slots.slice(0, MAX_SLOT_COUNT) : [];
    const highestContentIndex = sourceSlots.reduce((highest, slot, index) => draftSlotHasContent(slot) ? index : highest, -1);
    const requestedCount = Number(value?.visibleSlotCount);
    const visibleSlotCount = Math.min(
        MAX_SLOT_COUNT,
        Math.max(DEFAULT_SLOT_COUNT, Number.isInteger(requestedCount) ? requestedCount : highestContentIndex + 1)
    );
    const slots = Array.from({ length: visibleSlotCount }, (_, index) => {
        const slot = sourceSlots[index] || {};
        const requestedSize = normalizeSize(slot.size);
        const aPlusDouble = slot.aPlusDouble === true || requestedSize === '1464x1200';
        return {
            index,
            photographer: draftSlotHasContent(slot) ? slot.photographer === true : true,
            size: aPlusDouble ? '1464x1200' : requestedSize,
            aPlusDouble,
            title: cleanText(slot.title, 100),
            subtitle: cleanText(slot.subtitle, 100),
            otherText: cleanText(slot.otherText, 300),
            referenceKey: normalizeFileKey(slot.referenceKey),
            productKeys: Array.isArray(slot.productKeys) ? slot.productKeys.slice(0, 2).map(normalizeFileKey).filter(Boolean) : []
        };
    });
    return {
        version: 2,
        productName: cleanText(value?.productName || legacyProductName, 100),
        visibleSlotCount,
        slots,
        savedAt: new Date().toISOString()
    };
}

function normalizeSize(value) {
    const size = String(value || '').replace(/[×\s]/g, 'x').toLowerCase();
    return ['1600x1600', '1464x600', '1464x1200'].includes(size) ? size : '1600x1600';
}

function draftSlotHasContent(slot) {
    return Boolean(cleanText(slot?.productName, 100)
        || cleanText(slot?.title, 100)
        || cleanText(slot?.subtitle, 100)
        || cleanText(slot?.otherText, 300)
        || normalizeSize(slot?.size) !== '1600x1600'
        || slot?.aPlusDouble === true
        || slot?.referenceKey?.key
        || (Array.isArray(slot?.productKeys) && slot.productKeys.some(item => item?.key)));
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
