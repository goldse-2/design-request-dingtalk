export async function onRequestPost(context) {
    const { request, env } = context;

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { order } = body;
    if (!order || !Array.isArray(order) || order.length === 0) {
        return Response.json({ ok: false, error: 'Missing order array' }, { status: 400 });
    }

    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    try {
        for (let i = 0; i < order.length; i++) {
            const id = order[i];
            const raw = await env.SUBMISSIONS.get(id);
            if (!raw) continue;
            try {
                const submission = JSON.parse(raw);
                submission.priority = i;
                await env.SUBMISSIONS.put(id, JSON.stringify(submission), {
                    metadata: { taskType: submission.taskType, timestamp: submission.timestamp }
                });
            } catch(e) { continue; }
        }
        await env.SUBMISSIONS.put('__lastUpdated', String(Date.now()));
        return Response.json({ ok: true });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}
