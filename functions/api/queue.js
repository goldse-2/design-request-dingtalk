let cache = { data: null, time: 0 };
const CACHE_TTL = 60000;

export async function onRequestGet({ env }) {
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    try {
        const now = Date.now();
        if (!cache.data || now - cache.time >= CACHE_TTL) {
            const list = await env.SUBMISSIONS.list({ limit: 1000 });
            const raws = await Promise.all(list.keys.map(key => env.SUBMISSIONS.get(key.name)));
            cache = {
                time: now,
                data: raws.map(parseSubmission).filter(Boolean).filter(isRegularSubmission).map(toPublicQueueItem)
            };
        }
        return Response.json({ ok: true, submissions: cache.data });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}

function parseSubmission(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function isRegularSubmission(sub) {
    return sub && sub.kind !== 'studio' && !String(sub.id || '').startsWith('studio-') && !sub.mode;
}

function toPublicQueueItem(sub) {
    const info = sub.data?.basicInfo || {};
    return {
        id: sub.id,
        taskType: sub.taskType || '',
        status: sub.status || 'pending',
        archived: Boolean(sub.archived),
        timestamp: sub.timestamp || 0,
        createdAt: sub.createdAt || '',
        processingStartTime: sub.processingStartTime || 0,
        eta: sub.eta || '',
        priority: sub.priority,
        submitter: {
            name: sub.submitter?.name || '',
            avatar: sub.submitter?.avatar || ''
        },
        data: { basicInfo: { '型号': info['型号'] || '' } }
    };
}
