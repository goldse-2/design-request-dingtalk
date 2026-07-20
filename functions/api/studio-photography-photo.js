import { getStudioRpaQueueInfo, queueStudioRpaTask } from '../_shared/studio-rpa-slot.js';
import { wakeStudioRpaQueue } from '../_shared/studio-rpa-wakeup.js';
import { studioTaskPutOptions } from '../_shared/studio-task-storage.js';

const MAX_PHOTO_SIZE = 15 * 1024 * 1024;

export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    let form;
    try { form = await request.formData(); }
    catch { return Response.json({ ok: false, error: '上传格式错误' }, { status: 400 }); }

    const taskId = String(form.get('taskId') || '').trim();
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

    const productKeys = task.mode === 'program' && sourceKeys.length === 1
        ? [{ ...sourceKeys[0] }, { ...sourceKeys[0] }]
        : sourceKeys;
    const now = new Date().toISOString();
    task.productKeys = productKeys;
    task.photographySourceKeys = sourceKeys;
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
