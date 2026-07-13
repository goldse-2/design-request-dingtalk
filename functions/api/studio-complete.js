import { markStudioNotificationSent, sendStudioResultImages } from '../_shared/studio-dingtalk.js';

export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { taskId, action, resultImages, message } = body;
    if (!taskId || !action) {
        return Response.json({ ok: false, error: 'Missing fields' }, { status: 400 });
    }
    if (!['complete', 'processing', 'reject'].includes(action)) {
        return Response.json({ ok: false, error: 'Invalid action' }, { status: 400 });
    }
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    try {
        const raw = await env.SUBMISSIONS.get(taskId);
        if (!raw) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
        const task = JSON.parse(raw);

        if (action === 'processing') {
            task.status = 'processing';
        } else if (action === 'reject') {
            task.status = 'rejected';
            task.rejectReason = message || '';
        } else {
            const resultKeys = [];
            if (resultImages && resultImages.length) {
                for (let i = 0; i < resultImages.length; i++) {
                    const img = resultImages[i];
                    if (!img.base64) continue;
                    const ext = (img.name || 'result.png').split('.').pop();
                    const key = `studio/${taskId}/result-${i}.${ext}`;
                    const bytes = base64ToBytes(img.base64);
                    await env.SUBMISSION_FILES.put(key, bytes, {
                        httpMetadata: { contentType: img.mimeType || 'image/png' }
                    });
                    resultKeys.push({ key, name: img.name || `result-${i}.${ext}` });
                }
            }
            task.resultKeys = resultKeys;
            task.status = 'done';
            task.completedAt = new Date().toISOString();
            if (message) task.completeNote = message;
        }

        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), {
            metadata: studioTaskMetadata(task)
        });

        if (task.submitter?.unionId && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET) {
            const origin = new URL(request.url).origin;
            const p = notifyUser(env, task, action, message, origin)
                .then(() => {
                    if (action === 'complete') {
                        return markStudioNotificationSent(env, taskId);
                    }
                })
                .catch(e => console.error('Notify failed:', e.message));
            if (waitUntil) waitUntil(p);
            else await p;
        }

        return Response.json({ ok: true, action, taskId });
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

async function notifyUser(env, task, action, message, origin) {
    const token = await getAccessToken(env);
    const staffId = await getStaffId(token, task.submitter.unionId);

    let content;
    if (action === 'processing') {
        content = `你的图片制作需求正在处理中，稍等`;
    } else if (action === 'reject') {
        content = `图片制作需求已驳回\n\n原因：${message || '-'}`;
    } else {
        content = `图片制作完成 ✓\n\n请到网站查看下载：${origin}/studio-tasks.html`;
        if (message) content += `\n\n${message}`;
    }

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
    if (action === 'complete') {
        await sendStudioResultImages(env, token, staffId, task, origin);
    }
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

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
