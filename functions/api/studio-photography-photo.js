import { getStudioRpaQueueInfo, queueStudioRpaTask } from '../_shared/studio-rpa-slot.js';
import { wakeStudioRpaQueue } from '../_shared/studio-rpa-wakeup.js';
import { studioTaskPutOptions } from '../_shared/studio-task-storage.js';
import { startStudioPhotographyRetouchWorkflow } from '../_shared/studio-photography-workflow.js';

const MAX_PHOTO_SIZE = 15 * 1024 * 1024;

export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return handleJsonRequest(context);

    let form;
    try { form = await request.formData(); }
    catch { return Response.json({ ok: false, error: '上传格式错误' }, { status: 400 }); }

    const taskId = String(form.get('taskId') || '').trim();
    const retouchEnabled = String(form.get('retouchEnabled') ?? 'true') !== 'false';
    const files = form.getAll('files').filter(file => file && typeof file !== 'string');
    if (!taskId) return Response.json({ ok: false, error: '缺少任务ID' }, { status: 400 });
    if (files.length < 1 || files.length > 2) {
        return Response.json({ ok: false, error: '请上传一张或两张拍摄图片' }, { status: 400 });
    }

    const raw = await env.SUBMISSIONS.get(taskId);
    if (!raw) return Response.json({ ok: false, error: '任务不存在' }, { status: 404 });

    let task;
    try { task = JSON.parse(raw); }
    catch { return Response.json({ ok: false, error: '任务数据损坏' }, { status: 500 }); }
    if (task.kind !== 'studio' || !['free', 'program'].includes(task.mode) || task.photographerDecision !== true) {
        return Response.json({ ok: false, error: '该任务不需要摄影补图' }, { status: 400 });
    }
    if (task.status !== 'waiting_photos') {
        return Response.json({ ok: false, error: '该任务已经进入作图流程，请刷新管理台' }, { status: 409 });
    }

    const sourceKeys = [];
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (!file.type?.startsWith('image/')) {
            return Response.json({ ok: false, error: '只能上传图片文件' }, { status: 400 });
        }
        if (file.size > MAX_PHOTO_SIZE) {
            return Response.json({ ok: false, error: '拍摄图片单张不能超过 15MB' }, { status: 413 });
        }
        const ext = safeExtension(file.name, file.type);
        const key = `studio/photography/${taskId}/photo-${index + 1}-${crypto.randomUUID()}.${ext}`;
        await env.SUBMISSION_FILES.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type || 'image/jpeg' }
        });
        sourceKeys.push({ key, name: cleanFileName(file.name, `拍摄图片-${index + 1}.${ext}`) });
    }

    const now = new Date().toISOString();
    task.photographySourceKeys = sourceKeys;
    task.photographyUploadedAt = now;
    task.photographyUploadedCount = sourceKeys.length;
    schedulePhotographyUploadNotification(request, env, waitUntil, task, sourceKeys.length);

    if (retouchEnabled) {
        try {
            const workflowResult = await startStudioPhotographyRetouchWorkflow(env, task, sourceKeys);
            const firstChild = workflowResult.children[0];
            const queueInfo = await getStudioRpaQueueInfo(env, firstChild).catch(() => null);
            wakeStudioRpaQueue(request, waitUntil);
            return Response.json({
                ok: true,
                id: taskId,
                status: 'photography_processing',
                retouchEnabled: true,
                retouchCount: workflowResult.children.length,
                queueInfo
            });
        } catch (error) {
            task.status = 'waiting_photos';
            task.photographyRetouchError = error.message || String(error);
            await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task)).catch(() => {});
            return Response.json({ ok: false, error: `图片已保存，但加入精修队列失败：${error.message}` }, { status: 500 });
        }
    }

    const productKeys = task.mode === 'program' && sourceKeys.length === 1
        ? [{ ...sourceKeys[0] }, { ...sourceKeys[0] }]
        : sourceKeys;
    task.productKeys = productKeys;
    task.photographyRetouchEnabled = false;
    task.photographyRetouchError = '';
    task.photographyWorkflow = { state: 'skipped', completedAt: now };
    task.photographyCompletedAt = now;
    task.status = 'pending';
    task.sentToRpa = false;
    task.sentToRpaAt = '';
    task.pausedAuto = false;
    task.overdueNotified = false;
    task.autoRpaLastError = '';

    try {
        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task));
        const queued = await queueStudioRpaTask(env, taskId);
        const queueInfo = await getStudioRpaQueueInfo(env, task, queued.queueIds).catch(() => null);
        wakeStudioRpaQueue(request, waitUntil);
        return Response.json({
            ok: true,
            id: taskId,
            status: task.status,
            retouchEnabled: false,
            duplicatedPhoto: task.mode === 'program' && sourceKeys.length === 1,
            queueInfo
        });
    } catch (error) {
        task.status = 'waiting_photos';
        task.photographyQueueError = error.message || String(error);
        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task)).catch(() => {});
        return Response.json({ ok: false, error: `图片已保存，但加入作图队列失败：${error.message}` }, { status: 500 });
    }
}

async function handleJsonRequest(context) {
    const { request, env, waitUntil } = context;
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }
    if (body.action !== 'no_product') {
        return Response.json({ ok: false, error: '不支持的操作' }, { status: 400 });
    }

    const taskId = String(body.taskId || '').trim();
    if (!taskId) return Response.json({ ok: false, error: '缺少任务ID' }, { status: 400 });
    const raw = await env.SUBMISSIONS.get(taskId);
    if (!raw) return Response.json({ ok: false, error: '任务不存在' }, { status: 404 });

    let task;
    try { task = JSON.parse(raw); }
    catch { return Response.json({ ok: false, error: '任务数据损坏' }, { status: 500 }); }
    if (task.kind !== 'studio' || task.mode !== 'program' || task.photographerDecision !== true) {
        return Response.json({ ok: false, error: '该任务不是等待摄影补图的图生图任务' }, { status: 400 });
    }
    if (task.noProductImage === true && ['pending', 'processing', 'done'].includes(task.status)) {
        return Response.json({ ok: true, duplicate: true, id: taskId, status: task.status, noProductImage: true });
    }
    if (task.status !== 'waiting_photos') {
        return Response.json({ ok: false, error: '该任务已经进入作图流程，请刷新管理台' }, { status: 409 });
    }

    const now = new Date().toISOString();
    task.noProductImage = true;
    task.analyzePrompt = '';
    task.productKeys = [];
    task.photographySourceKeys = [];
    task.photographyUploadedCount = 0;
    task.photographyRetouchEnabled = false;
    task.photographyRetouchError = '';
    task.photographyQueueError = '';
    task.photographyWorkflow = { state: 'skipped_no_product', completedAt: now };
    task.photographyCompletedAt = now;
    task.noProductSelectedAt = now;
    task.status = 'pending';
    task.sentToRpa = false;
    task.sentToRpaAt = '';
    task.pausedAuto = false;
    task.overdueNotified = false;
    task.autoRpaLastError = '';

    try {
        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task));
        const queued = await queueStudioRpaTask(env, taskId);
        const queueInfo = await getStudioRpaQueueInfo(env, task, queued.queueIds).catch(() => null);
        wakeStudioRpaQueue(request, waitUntil);
        return Response.json({ ok: true, id: taskId, status: task.status, noProductImage: true, queueInfo });
    } catch (error) {
        task.status = 'waiting_photos';
        task.photographyQueueError = error.message || String(error);
        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task)).catch(() => {});
        return Response.json({ ok: false, error: `已切换为无需图片，但加入作图队列失败：${error.message}` }, { status: 500 });
    }
}

function safeExtension(name, mimeType) {
    const fromName = String(name || '').match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
    if (mimeType === 'image/png') return 'png';
    if (mimeType === 'image/webp') return 'webp';
    return 'jpg';
}

function cleanFileName(name, fallback) {
    return String(name || fallback).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 160) || fallback;
}

function schedulePhotographyUploadNotification(request, env, waitUntil, task, photoCount) {
    if (!env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET || (!task.submitter?.userId && !task.submitter?.unionId)) return;
    const origin = new URL(request.url).origin;
    const notification = notifyPhotographyUpload(env, task, photoCount, origin)
        .catch(error => console.error('Photography upload notification failed:', error.message || error));
    if (waitUntil) waitUntil(notification);
}

async function notifyPhotographyUpload(env, task, photoCount, origin) {
    const accessToken = await getAccessToken(env);
    const staffId = task.submitter?.userId || await getStaffId(accessToken, task.submitter.unionId);
    if (!staffId) throw new Error('未找到提交人的钉钉用户ID');

    const content = [
        '拍摄图片已上传',
        '',
        `摄影师已为你的任务上传 ${photoCount} 张图片。`,
        '系统会继续处理，完成后将再次通过钉钉通知你。',
        `查看进度：${origin}/studio-tasks.html`
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
    const data = await response.json();
    if (!response.ok || !data.accessToken) throw new Error('获取钉钉令牌失败');
    return data.accessToken;
}

async function getStaffId(accessToken, unionId) {
    const response = await fetch(`https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unionid: unionId })
    });
    const data = await response.json();
    if (!response.ok || data.errcode !== 0 || !data.result?.userid) {
        throw new Error(`获取钉钉用户ID失败：${data.errmsg || response.status}`);
    }
    return data.result.userid;
}
