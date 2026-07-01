export async function onRequestPost(context) {
    const { request, env } = context;

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { taskId, pausedAuto } = body;
    if (!taskId) {
        return Response.json({ ok: false, error: 'Missing taskId' }, { status: 400 });
    }

    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    try {
        const raw = await env.SUBMISSIONS.get(taskId);
        if (!raw) {
            return Response.json({ ok: false, error: 'Task not found' }, { status: 404 });
        }

        const task = JSON.parse(raw);
        task.pausedAuto = !!pausedAuto;

        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), {
            metadata: { kind: 'studio', mode: task.mode, timestamp: task.timestamp }
        });

        return Response.json({ ok: true });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}
