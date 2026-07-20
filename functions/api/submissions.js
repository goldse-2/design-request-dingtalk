import { RECORD_RETENTION_MS } from '../_shared/studio-task-storage.js';

let _cache = { data: null, time: 0 };
const CACHE_TTL = 60000; // 60 seconds

export async function onRequestPatch(context) {
    const { env, request } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const id = body.id || body.submissionId;
    const action = String(body.action || '').trim();
    const productName = String(body.productName || '').trim();
    if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });

    const raw = await env.SUBMISSIONS.get(id);
    if (!raw) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });

    const sub = JSON.parse(raw);
    sub.data = sub.data || {};
    sub.data.basicInfo = sub.data.basicInfo || {};
    if (action === 'replaceProductImages') {
        const images = normalizeReplacementImages(body.images);
        if (!images.length) return Response.json({ ok: false, error: '请至少上传一张产品图片' }, { status: 400 });

        const previous = Array.isArray(sub.data.images) ? sub.data.images : [];
        sub.data.images = images.map((image, index) => ({
            ...(previous[index] || {}),
            序号: previous[index]?.序号 || `图${index + 1}`,
            区域: previous[index]?.区域 || '产品图',
            photoKey: image.key,
            photoName: image.name
        }));
        if (sub.data.designInfo) sub.data.designInfo.productImages = images;
        if (sub.data.packagingInfo) sub.data.packagingInfo.productImages = images;
        if (Array.isArray(sub.data.directPhotoKeys)) sub.data.directPhotoKeys = images;
    } else {
        if (!productName) return Response.json({ ok: false, error: 'Missing productName' }, { status: 400 });
        sub.data.basicInfo['型号'] = productName;
    }
    sub.updatedAt = Date.now();

    await env.SUBMISSIONS.put(id, JSON.stringify(sub), {
        metadata: { taskType: sub.taskType, timestamp: sub.timestamp, archived: sub.archived || false, archivedAt: sub.archivedAt || 0 }
    });

    _cache = { data: null, time: 0 };
    return Response.json({ ok: true, id, productName, submission: sanitizeSubmissionForResponse(sub) });
}

function normalizeReplacementImages(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.reduce((images, item) => {
        const key = String(item?.key || '').trim();
        const name = String(item?.name || '').trim().replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 160);
        if (!key.startsWith('design/product/') || seen.has(key) || !name || images.length >= 20) return images;
        seen.add(key);
        images.push({ key, name });
        return images;
    }, []);
}

function sanitizeSubmissionForResponse(submission) {
    const copy = structuredClone(submission);
    if (Array.isArray(copy.data?.images)) {
        copy.data.images = copy.data.images.map(({ imageData, imageData2, ...image }) => image);
    }
    return copy;
}

export async function onRequestDelete(context) {
    const { env, request } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const id = body.id || body.submissionId;
    if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });

    const raw = await env.SUBMISSIONS.get(id);
    if (!raw) return Response.json({ ok: true, deleted: true });

    try {
        const sub = JSON.parse(raw);
        if (env.SUBMISSION_FILES) {
            if (sub.fileKey) await env.SUBMISSION_FILES.delete(sub.fileKey).catch(() => {});
            if (sub.data?.directPhotoKeys) {
                for (const k of sub.data.directPhotoKeys) await env.SUBMISSION_FILES.delete(k.key).catch(() => {});
            }
            if (sub.completionKeys) {
                for (const k of sub.completionKeys) await env.SUBMISSION_FILES.delete(k.key).catch(() => {});
            }
        }
    } catch {}

    await env.SUBMISSIONS.delete(id);
    return Response.json({ ok: true, deleted: true });
}

export async function onRequestGet(context) {
    const { env, request } = context;

    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    const url = new URL(request.url);
    const history = url.searchParams.get('history') === '1';

    try {
        // Use cache to reduce KV list() calls
        const now = Date.now();
        let results;
        if (_cache.data && (now - _cache.time) < CACHE_TTL) {
            results = _cache.data;
        } else {
            const list = await env.SUBMISSIONS.list({ limit: 1000 });
            results = await Promise.all(
                list.keys.map(key => env.SUBMISSIONS.get(key.name))
            );
            _cache.data = results;
            _cache.time = now;
        }

        let submissions = results
            .filter(Boolean)
            .map(data => { try { return JSON.parse(data); } catch { return null; } })
            .filter(Boolean)
            .filter(sub => sub.kind !== 'studio')
            .filter(sub => !String(sub.id || '').startsWith('studio-') && !sub.mode && !sub.sentToRpa && !sub.productKeys && !sub.refKeys)
            .filter(sub => {
                const info = sub.data?.basicInfo || {};
                const productName = String(info['型号'] || '').trim();
                const imageNeeds = Array.isArray(sub.data?.images) ? sub.data.images.length : 0;
                const directPhotos = Array.isArray(sub.data?.directPhotoKeys) ? sub.data.directPhotoKeys.length : 0;
                return Boolean(productName) || imageNeeds > 0 || directPhotos > 0 || Boolean(sub.fileKey) || Boolean(sub.taskType) || Boolean(sub.remarks) || Boolean(sub.submitter);
            })
            .map(sub => {
                if (sub.data?.images) {
                    sub.data.images = sub.data.images.map(({ imageData, imageData2, ...rest }) => rest);
                }
                return sub;
            });

        if (history) {
            const cutoff = Date.now() - RECORD_RETENTION_MS;
            submissions = submissions.filter(sub => sub.archived && (sub.archivedAt || sub.timestamp || 0) >= cutoff);
        } else {
            submissions = submissions.filter(sub => !sub.archived);
        }

        submissions.sort((a, b) => {
            if (history) {
                return (b.archivedAt || b.timestamp) - (a.archivedAt || a.timestamp);
            } else {
                // Sort by priority if available, otherwise by timestamp
                const prioA = a.priority ?? a.timestamp;
                const prioB = b.priority ?? b.timestamp;
                return prioA - prioB;
            }
        });

        const stats = {
            total: submissions.length
        };

        return Response.json({ ok: true, submissions, stats });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}
