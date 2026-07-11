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
            metadata: studioTaskMetadata(task)
        });

        return Response.json({ ok: true });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}

function studioTaskMetadata(task) {
    return {
        kind: 'studio',
        mode: task.mode,
        status: task.status,
        timestamp: task.timestamp,
        unionId: task.submitter?.unionId || '',
        sentToRpa: Boolean(task.sentToRpa),
        sentToRpaAt: task.sentToRpaAt || '',
        pausedAuto: Boolean(task.pausedAuto),
        overdueNotified: Boolean(task.overdueNotified),
        dingtalkNotified: Boolean(task.dingtalkNotified),
        r2AutoNotified: Boolean(task.r2AutoNotified)
    };
}
