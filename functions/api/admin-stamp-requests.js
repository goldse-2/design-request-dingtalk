import { loadStampTask, saveStampTask } from '../_shared/stamp-workflow.js';

const VISIBLE_STATUSES = new Set(['pending_approval', 'approved_waiting', 'processing', 'send_failed']);

export async function onRequestGet({ env, request }) {
    if (!env.SUBMISSIONS) return json({ ok: false, error: '任务存储未配置' }, 503);
    const limitValue = Number(new URL(request.url).searchParams.get('limit'));
    const limit = Number.isInteger(limitValue) ? Math.max(1, Math.min(100, limitValue)) : 50;
    const listed = await env.SUBMISSIONS.list({ prefix: 'stamp-request-', limit: 100 });
    const ids = (listed.keys || [])
        .filter(key => VISIBLE_STATUSES.has(key.metadata?.status))
        .sort((a, b) => Number(a.metadata?.timestamp || 0) - Number(b.metadata?.timestamp || 0))
        .slice(0, limit)
        .map(key => key.name);
    const tasks = (await Promise.all(ids.map(id => loadStampTask(env.SUBMISSIONS, id))))
        .filter(Boolean)
        .map(toAdminTask);
    return json({ ok: true, tasks });
}

export async function onRequestPost({ env, request }) {
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) return json({ ok: false, error: '存储未配置' }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: '请求内容无效' }, 400); }
    const task = await loadStampTask(env.SUBMISSIONS, body.id);
    if (!task) return json({ ok: false, error: '盖章任务不存在' }, 404);
    const action = String(body.action || '').trim();

    if (action === 'approve') {
        if (!['pending_approval', 'send_failed'].includes(task.status)) return json({ ok: false, error: '当前任务不能审核' }, 409);
        const stampKey = String(body.stampKey || '').trim();
        const selected = task.matchedStamps?.find(stamp => stamp.key === stampKey);
        if (!selected) return json({ ok: false, error: '请选择匹配的公章' }, 400);
        task.status = 'approved_waiting';
        task.approvedAt = new Date().toISOString();
        task.approvedStamp = selected;
        task.autoSendAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        task.sendFailures = 0;
        task.lastError = '';
        await saveStampTask(env.SUBMISSIONS, task);
        return json({ ok: true, task: toAdminTask(task) });
    }

    if (action === 'reject') {
        if (!['pending_approval', 'send_failed'].includes(task.status)) return json({ ok: false, error: '当前任务不能驳回' }, 409);
        task.status = 'rejected';
        task.rejectedAt = new Date().toISOString();
        task.rejectReason = cleanText(body.reason, 300);
        if (task.input?.key) await env.SUBMISSION_FILES.delete(task.input.key).catch(() => {});
        await saveStampTask(env.SUBMISSIONS, task);
        return json({ ok: true, task: toAdminTask(task) });
    }

    return json({ ok: false, error: '不支持的操作' }, 400);
}

function toAdminTask(task) {
    return {
        id: task.id,
        status: task.status,
        createdAt: task.createdAt,
        companyName: task.companyName,
        submitter: task.submitter || {},
        inputName: task.input?.name || '',
        inputUrl: task.input?.key ? `/api/admin-stamp-input/${encodeURIComponent(task.input.key)}?dl=1&name=${encodeURIComponent(task.input.name || '待盖章文件')}` : '',
        matchedStamps: (task.matchedStamps || []).map(stamp => ({
            ...stamp,
            url: `/api/admin-stamp-file/${encodeURIComponent(stamp.key)}`
        })),
        approvedStampKey: task.approvedStamp?.key || '',
        autoSendAt: task.autoSendAt || '',
        approvedAt: task.approvedAt || '',
        sendFailures: Number(task.sendFailures || 0),
        lastError: task.lastError || '',
        adminDingtalkNotified: Boolean(task.adminDingtalkNotified)
    };
}

function cleanText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

function json(body, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
