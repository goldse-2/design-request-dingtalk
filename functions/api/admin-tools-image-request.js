const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RETENTION_SECONDS = 20 * 24 * 60 * 60;

export async function onRequestGet({ request, env }) {
    if (!env.SUBMISSIONS) return json({ ok: false, error: '任务存储未配置' }, 503);
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 50;
    const listed = await env.SUBMISSIONS.list({ prefix: 'tool-image-request-', limit: 100 });
    const keys = listed.keys
        .filter(key => ['waiting_image', 'ready'].includes(key.metadata?.status))
        .filter(key => key.metadata?.status !== 'ready' || key.metadata?.dingtalkNotified !== true)
        .sort((a, b) => Number(a.metadata?.timestamp || 0) - Number(b.metadata?.timestamp || 0))
        .slice(0, limit)
        .map(key => key.name);
    const raws = await Promise.all(keys.map(key => env.SUBMISSIONS.get(key)));
    const tasks = raws.map(safeParse).filter(task => task?.kind === 'tool-image-request').map(adminTaskResponse);
    return json({ ok: true, tasks });
}

export async function onRequestPost({ request, env }) {
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) return json({ ok: false, error: '文件存储未配置' }, 503);
    const contentType = request.headers.get('content-type') || '';
    let task;

    if (contentType.includes('application/json')) {
        let body;
        try { body = await request.json(); }
        catch { return json({ ok: false, error: '请求内容无效' }, 400); }
        task = await loadTask(env.SUBMISSIONS, body.id);
        if (!task) return json({ ok: false, error: '等待任务不存在或已过期' }, 404);
        if (String(body.action || '') !== 'notify' || task.status !== 'ready' || !task.designerImage?.key) {
            return json({ ok: false, error: '当前任务不能重新通知' }, 409);
        }
    } else {
        let form;
        try { form = await request.formData(); }
        catch { return json({ ok: false, error: '上传内容读取失败' }, 400); }
        task = await loadTask(env.SUBMISSIONS, form.get('id'));
        if (!task) return json({ ok: false, error: '等待任务不存在或已过期' }, 404);
        const file = form.get('file');
        if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: '请选择要提供给用户的图片' }, 400);
        if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) return json({ ok: false, error: '只支持 PNG、JPG 或 WebP 图片' }, 415);
        if (!file.size || file.size > MAX_IMAGE_BYTES) return json({ ok: false, error: '图片大小必须在 8MB 以内' }, 413);

        const extension = imageExtension(file);
        const key = `tools/image-requests/${task.id}/designer-image.${extension}`;
        const name = cleanFileName(file.name, `设计师图片.${extension}`);
        await env.SUBMISSION_FILES.put(
            key,
            await file.arrayBuffer(),
            filePutOptions(env.SUBMISSION_FILES, file.type)
        );
        if (task.designerImage?.key && task.designerImage.key !== key) {
            await env.SUBMISSION_FILES.delete(task.designerImage.key).catch(() => {});
        }
        task.designerImage = { key, name, type: file.type };
        task.status = 'ready';
        task.readyAt = new Date().toISOString();
        task.dingtalkNotified = false;
        task.notificationError = '';
        await saveTask(env.SUBMISSIONS, task);
    }

    try {
        await notifyUser(request, env, task);
        task.dingtalkNotified = true;
        task.dingtalkNotifiedAt = new Date().toISOString();
        task.notificationError = '';
        await saveTask(env.SUBMISSIONS, task);
        return json({ ok: true, notified: true, task: adminTaskResponse(task) });
    } catch (error) {
        console.error('tools image request notification failed:', error?.message || error);
        task.dingtalkNotified = false;
        task.notificationError = String(error?.message || error || '钉钉通知失败').slice(0, 300);
        await saveTask(env.SUBMISSIONS, task).catch(() => {});
        return json({ ok: true, notified: false, warning: '图片已保存，但钉钉通知失败，可在管理台重新通知', task: adminTaskResponse(task) });
    }
}

async function notifyUser(request, env, task) {
    if (!env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET) throw new Error('钉钉通知服务未配置');
    const accessToken = await getAccessToken(env);
    const staffId = task.submitter?.userId || await getStaffId(accessToken, task.submitter?.unionId);
    if (!staffId) throw new Error('未找到提交人的钉钉用户');
    const origin = new URL(request.url).origin;
    const returnUrl = `${origin}/tools?imageRequest=${encodeURIComponent(task.id)}&token=${encodeURIComponent(task.requestToken)}`;
    const content = [
        '设计师图片已上传',
        '',
        `文档：${task.document?.name || 'PDF / Word 文件'}`,
        '请打开下面的页面，继续调整图片位置和导出格式。',
        returnUrl
    ].join('\n');
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': accessToken
        },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [staffId],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`钉钉通知失败 (${response.status}) ${detail}`.trim());
    }
}

async function getAccessToken(env) {
    const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: env.DINGTALK_APPKEY, appSecret: env.DINGTALK_APPSECRET })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.accessToken) throw new Error('获取钉钉访问凭证失败');
    return data.accessToken;
}

async function getStaffId(accessToken, unionId) {
    if (!unionId) return '';
    const response = await fetch(`https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unionid: unionId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.errcode !== 0 || !data.result?.userid) throw new Error('获取钉钉用户失败');
    return data.result.userid;
}

async function loadTask(storage, value) {
    const id = String(value || '').trim();
    if (!/^tool-image-request-[0-9a-f-]{36}$/i.test(id)) return null;
    const task = safeParse(await storage.get(id).catch(() => null));
    return task?.kind === 'tool-image-request' ? task : null;
}

async function saveTask(storage, task) {
    await storage.put(task.id, JSON.stringify(task), {
        metadata: {
            kind: task.kind,
            status: task.status,
            timestamp: task.timestamp,
            unionId: task.submitter?.unionId || '',
            dingtalkNotified: Boolean(task.dingtalkNotified)
        },
        expirationTtl: RETENTION_SECONDS
    });
}

function adminTaskResponse(task) {
    return {
        id: task.id,
        status: task.status,
        timestamp: task.timestamp,
        createdAt: task.createdAt,
        readyAt: task.readyAt || '',
        note: task.note,
        submitter: task.submitter || {},
        documentName: task.document?.name || '',
        documentUrl: task.document?.key ? `/api/library-file/${encodeURIComponent(task.document.key)}?dl=1&name=${encodeURIComponent(task.document.name || 'document')}` : '',
        imageName: task.designerImage?.name || '',
        dingtalkNotified: Boolean(task.dingtalkNotified),
        notificationError: task.notificationError || ''
    };
}

function imageExtension(file) {
    if (file.type === 'image/png') return 'png';
    if (file.type === 'image/webp') return 'webp';
    return 'jpg';
}

function filePutOptions(storage, contentType) {
    if (typeof storage.getWithMetadata === 'function') {
        return { metadata: { contentType }, expirationTtl: RETENTION_SECONDS };
    }
    return { httpMetadata: { contentType } };
}

function cleanFileName(value, fallback) {
    return String(value || fallback).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 160) || fallback;
}

function safeParse(value) {
    try { return JSON.parse(value); }
    catch { return null; }
}

function json(body, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
