import { markStudioNotificationSent, sendStudioResultImages } from '../_shared/studio-dingtalk.js';
import { RECORD_RETENTION_MS, studioTaskPutOptions, studioTaskRetentionAnchor } from '../_shared/studio-task-storage.js';
import { parseResizeTarget, transformToExactJpeg } from './studio-check-overdue.js';
import { advanceSheetSelfWorkflow, getSheetSelfSlots } from '../_shared/sheet-self-workflow.js';
import { enqueueRetouchLibraryReviews } from '../_shared/retouch-library-review.js';

export async function onRequestPatch(context) {
    const { request, env } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { id, desc, note, action } = body;
    if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });

    const raw = await env.SUBMISSIONS.get(id);
    if (!raw) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });

    let task;
    try { task = JSON.parse(raw); } catch { return Response.json({ ok: false, error: 'Bad data' }, { status: 500 }); }
    if (task.kind !== 'studio') return Response.json({ ok: false, error: 'Not a studio task' }, { status: 400 });

    if (action === 'retryImage') {
        if (task.mode !== 'resize_ai') {
            return Response.json({ ok: false, error: 'Only resize tasks can be resent here' }, { status: 400 });
        }
        if (task.status === 'done') {
            return Response.json({ ok: false, error: '已完成任务不能重新发送' }, { status: 409 });
        }

        const queueKey = 'studio:imageQueue:v2';
        const queueRaw = await env.SUBMISSIONS.get(queueKey).catch(() => null);
        let queue = [];
        if (queueRaw) {
            try { queue = JSON.parse(queueRaw); } catch { queue = []; }
        }
        if (!Array.isArray(queue)) queue = [];

        task.status = 'pending';
        task.backgroundLastError = '';
        task.backgroundLastAttemptAt = '';
        task.backgroundRetriedAt = new Date().toISOString();
        task.dingtalkNotified = false;
        task.r2AutoNotified = false;
        await env.SUBMISSIONS.put(queueKey, JSON.stringify([id, ...queue.filter(taskId => taskId !== id)].slice(0, 300)));
    }

    if (action === 'repairResize') {
        if (task.mode !== 'resize_ai' || task.status !== 'done') {
            return Response.json({ ok: false, error: 'Only completed resize tasks can be repaired' }, { status: 400 });
        }
        if (!env.SUBMISSION_FILES) {
            return Response.json({ ok: false, error: 'R2 storage not configured' }, { status: 500 });
        }

        const current = Array.isArray(task.resultKeys) ? task.resultKeys[0] : null;
        if (!current?.key) {
            return Response.json({ ok: false, error: 'Resize result not found' }, { status: 404 });
        }
        const object = await env.SUBMISSION_FILES.get(current.key);
        if (!object) {
            return Response.json({ ok: false, error: 'Resize result file missing' }, { status: 404 });
        }

        const target = parseResizeTarget(task.resizeTarget || task.size || '1464x600');
        const exact = await transformToExactJpeg(env, {
            bytes: await object.arrayBuffer(),
            mimeType: object.httpMetadata?.contentType || 'image/jpeg'
        }, target);
        const baseKey = String(current.key).replace(/\.[^.]+$/, '');
        const key = `${baseKey}-exact-${Date.now()}.jpg`;
        const baseName = String(current.name || `resize-${target.width}x${target.height}.jpg`).replace(/\.[^.]+$/, '');
        const name = `${baseName}-精确尺寸.jpg`;
        await env.SUBMISSION_FILES.put(key, exact.bytes, {
            httpMetadata: { contentType: 'image/jpeg' }
        });
        task.resultKeys = [{ key, name }];
        task.completeNote = `AI 尺寸修改完成：${target.width} × ${target.height}（已校正精确像素）`;
        task.exactResizeRepairedAt = new Date().toISOString();
    }

    if (typeof desc === 'string') task.desc = desc;
    if (typeof note === 'string') task.note = note;

    await env.SUBMISSIONS.put(id, JSON.stringify(task), studioTaskPutOptions(task));
    return Response.json({ ok: true, task, requeued: action === 'retryImage', repaired: action === 'repairResize' });
}

export async function onRequestGet(context) {
    const { env, request } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const unionId = url.searchParams.get('unionId');
    const all = url.searchParams.get('all') === '1';
    const active = url.searchParams.get('active') === '1';
    const history = url.searchParams.get('history') === '1';
    const retouchQueue = url.searchParams.get('retouchQueue') === '1';
    const resizeQueue = url.searchParams.get('resizeQueue') === '1';
    const mode = String(url.searchParams.get('mode') || '').trim();
    const includeSheetSlots = url.searchParams.get('includeSheetSlots') === '1';
    const requestedLimit = Number(url.searchParams.get('limit'));
    const taskLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(100, Math.floor(requestedLimit))
        : 1000;

    try {
        if (id) {
            const raw = await env.SUBMISSIONS.get(id);
            if (!raw) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
            const task = JSON.parse(raw);
            if (task.kind !== 'studio') return Response.json({ ok: false, error: 'Not a studio task' }, { status: 400 });
            return Response.json({ ok: true, task });
        }

        const list = await env.SUBMISSIONS.list({ prefix: 'studio-', limit: 1000 });
        if (retouchQueue || resizeQueue) {
            return publicStudioQueue(env, list.keys, taskLimit, resizeQueue ? 'resize_ai' : 'retouch');
        }

        let syncedTasks = new Map();
        if (env.SUBMISSION_FILES && active) {
            syncedTasks = await syncR2StudioResults(env, request, list.keys);
        }

        const keys = list.keys
            .filter(k => (k.metadata || {}).kind === 'studio')
            .filter(k => all || !unionId || k.metadata?.unionId === unionId)
            .filter(k => !mode || k.metadata?.mode === mode)
            .filter(k => {
                const meta = k.metadata || {};
                if (active) {
                    if (meta.status === 'waiting_photos' || meta.status === 'pending' || meta.status === 'processing') return true;
                    const hasNotifyMetadata = Object.prototype.hasOwnProperty.call(meta, 'dingtalkNotified')
                        || Object.prototype.hasOwnProperty.call(meta, 'r2AutoNotified');
                    return meta.status === 'done' && hasNotifyMetadata && !meta.dingtalkNotified && !meta.r2AutoNotified;
                }
                if (history) return meta.status === 'done';
                return true;
            })
            .sort((a, b) => Number(b.metadata?.timestamp || 0) - Number(a.metadata?.timestamp || 0))
            .slice(0, taskLimit)
            .map(k => k.name);
        const results = await Promise.all(keys.map(k => syncedTasks.has(k)
            ? JSON.stringify(syncedTasks.get(k))
            : env.SUBMISSIONS.get(k)));

        let tasks = results
            .filter(Boolean)
            .map(r => { try { return JSON.parse(r); } catch { return null; } })
            .filter(t => t && t.kind === 'studio');

        tasks = tasks.filter(task => !(task.silent && task.workflow?.type === 'sheet_self'));

        if (!all && unionId) {
            tasks = tasks.filter(t => t.submitter?.unionId === unionId);
        }
        if (mode) tasks = tasks.filter(t => t.mode === mode);
        if (active) {
            tasks = tasks.filter(t => {
                if (t.status === 'rejected') return false;
                return t.status !== 'done' || (!t.dingtalkNotified && !t.r2AutoNotified);
            });
        }
        if (history) {
            const cutoff = Date.now() - RECORD_RETENTION_MS;
            tasks = tasks.filter(t => t.status === 'done'
                && (t.dingtalkNotified || t.r2AutoNotified)
                && studioTaskRetentionAnchor(t, 0) >= cutoff);
        }

        tasks.sort((a, b) => b.timestamp - a.timestamp);

        if (includeSheetSlots) {
            await Promise.all(tasks.filter(task => task.mode === 'sheet_self').map(async task => {
                task.workflowSlots = await getSheetSelfSlots(env, task.id, task.sheetSelfSlotCount);
            }));
        }

        return Response.json({ ok: true, tasks });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}

async function publicStudioQueue(env, listedKeys, requestedLimit, queueMode) {
    const limit = Math.min(requestedLimit, 20);
    const keys = listedKeys
        .filter(key => key.metadata?.kind === 'studio')
        .filter(key => key.metadata?.mode === queueMode)
        .filter(key => key.metadata?.status === 'pending' || key.metadata?.status === 'processing')
        .sort((left, right) => Number(left.metadata?.timestamp || 0) - Number(right.metadata?.timestamp || 0))
        .slice(0, limit)
        .map(key => key.name);
    const raws = await Promise.all(keys.map(key => env.SUBMISSIONS.get(key)));
    const tasks = raws
        .map(raw => {
            try { return JSON.parse(raw); } catch { return null; }
        })
        .filter(task => task?.kind === 'studio' && task.mode === queueMode)
        .filter(task => task.status === 'pending' || task.status === 'processing')
        .map(task => ({
            id: task.id,
            status: task.status,
            timestamp: task.timestamp,
            submitterName: task.submitter?.name || '匿名用户'
        }));

    return Response.json({ ok: true, tasks }, {
        headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' }
    });
}

async function syncR2StudioResults(env, request, listedKeys) {
    const keys = listedKeys
        .filter(k => (k.metadata || {}).kind === 'studio')
        .filter(k => k.metadata?.status === 'processing')
        .map(k => k.name);
    const raws = await Promise.all(keys.map(k => env.SUBMISSIONS.get(k)));
    const tasks = raws
        .filter(Boolean)
        .map(r => {
            try { return JSON.parse(r); } catch { return null; }
        })
        .filter(t => t && t.kind === 'studio' && t.status !== 'done');
    const taskMap = new Map(tasks.map(task => [task.id, task]));

    for (const task of tasks) {
        const prefix = `studio-results/${task.id}/`;
        const listed = await env.SUBMISSION_FILES.list({ prefix, limit: 100 });
        const images = (listed.objects || [])
            .filter(o => !o.key.endsWith('/'))
            .filter(o => /\.(png|jpe?g|webp|gif)$/i.test(o.key));

        if (!images.length) continue;

        task.resultKeys = images.map(o => ({
            key: o.key,
            name: o.key.split('/').pop() || 'result.png'
        }));
        task.status = 'done';
        task.completedAt = new Date().toISOString();
        task.completeNote = task.completeNote || 'R2 成品图已自动同步';
        task.r2AutoCompleted = true;

        try {
            await enqueueRetouchLibraryReviews(env, task, task.resultKeys);
        } catch (error) {
            console.error('Retouch library review sync failed:', task.id, error.message);
            continue;
        }
        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));

        if (task.workflow?.type === 'sheet_self') {
            await advanceSheetSelfWorkflow({ env, task, origin: new URL(request.url).origin });
        }

        if (!task.silent && !task.r2AutoNotified && task.submitter?.unionId && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET) {
            try {
                await notifyUserDone(env, task, new URL(request.url).origin);
                const latestTask = await markStudioNotificationSent(env, task.id, 'r2AutoNotified');
                taskMap.set(task.id, latestTask);
            } catch (e) {
                console.error('Auto notify failed:', e.message);
            }
        }
    }
    return taskMap;
}

async function notifyUserDone(env, task, origin) {
    const token = await getAccessToken(env);
    const staffId = await getStaffId(token, task.submitter.unionId);
    if (!staffId) throw new Error('No staff id');
    const content = `图片制作完成 ✓\n\n请到网站查看下载：${origin}/studio-tasks.html`;
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [staffId],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
    if (!response.ok) throw new Error(`DingTalk text message failed: ${response.status}`);
    await sendStudioResultImages(env, token, staffId, task, origin);
    return response;
}

async function getAccessToken(env) {
    const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: env.DINGTALK_APPKEY, appSecret: env.DINGTALK_APPSECRET })
    });
    const data = await res.json();
    if (!data.accessToken) throw new Error('Token failed');
    return data.accessToken;
}

async function getStaffId(accessToken, unionId) {
    const res = await fetch(`https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unionid: unionId })
    });
    const data = await res.json();
    if (data.errcode !== 0) throw new Error('getStaffId failed: ' + data.errmsg);
    return data.result?.userid;
}
