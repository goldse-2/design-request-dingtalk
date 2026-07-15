import { studioTaskPutOptions } from '../_shared/studio-task-storage.js';

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

        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task));
        if (!task.pausedAuto
            && task.kind === 'studio'
            && ['free', 'program', 'retouch'].includes(task.mode)
            && task.status === 'pending'
            && !task.sentToRpa) {
            await appendQueue(env.SUBMISSIONS, 'studio:rpaQueue:v2', taskId);
        }

        return Response.json({ ok: true });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}

async function appendQueue(kv, key, taskId) {
    const raw = await kv.get(key).catch(() => null);
    let ids = [];
    if (raw) {
        try { ids = JSON.parse(raw); } catch { ids = []; }
    }
    if (!Array.isArray(ids)) ids = [];
    if (!ids.includes(taskId)) ids.push(taskId);
    await kv.put(key, JSON.stringify(ids.slice(-500)));
}
