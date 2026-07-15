import { markStudioNotificationSent, sendStudioResultImages } from '../_shared/studio-dingtalk.js';
import { studioTaskPutOptions } from '../_shared/studio-task-storage.js';

export async function onRequestPut(context) {
    const { request, env } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

    const password = String(body.password || '');
    if (!uploadPasswordMatches(password, env)) {
        return Response.json({ ok: false, error: '密码错误' }, { status: 401 });
    }

    const taskId = String(body.taskId || '').trim();
    if (!taskId) return Response.json({ ok: false, error: '缺少任务 ID' }, { status: 400 });

    const taskResult = await getStudioTask(env, taskId);
    if (taskResult.error) return taskResult.error;
    return Response.json({ ok: true, mode: taskResult.task.mode || '' }, {
        headers: { 'Cache-Control': 'no-store' }
    });
}

export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    let form;
    try { form = await request.formData(); }
    catch { return Response.json({ ok: false, error: 'Invalid form data' }, { status: 400 }); }

    const password = String(form.get('password') || '');
    if (!uploadPasswordMatches(password, env)) {
        return Response.json({ ok: false, error: '密码错误' }, { status: 401 });
    }

    const taskId = String(form.get('taskId') || '').trim();
    if (!taskId) return Response.json({ ok: false, error: '缺少任务 ID' }, { status: 400 });

    const taskResult = await getStudioTask(env, taskId);
    if (taskResult.error) return taskResult.error;
    const task = taskResult.task;

    const files = form.getAll('files').filter(f => f && typeof f !== 'string');
    if (!files.length) return Response.json({ ok: false, error: '请上传成品图' }, { status: 400 });

    const preparedFiles = [];
    for (const file of files) {
        const bytes = await file.arrayBuffer();
        if (task.mode === 'cutout' && !hasPngSignature(bytes)) {
            return Response.json({ ok: false, error: '白底抠图成品必须上传 PNG 文件' }, { status: 400 });
        }
        preparedFiles.push({ file, bytes });
    }

    const uploaded = [];
    const baseName = resultBaseName(task);
    for (let i = 0; i < preparedFiles.length; i++) {
        const { file, bytes } = preparedFiles[i];
        const ext = task.mode === 'cutout' ? 'png' : resultExtension(file);
        const suffix = preparedFiles.length > 1 ? `-${i + 1}` : '';
        const name = `${baseName}${suffix}.${ext}`;
        const key = `studio-results/${taskId}/${Date.now()}-${i + 1}-${name}`;
        await env.SUBMISSION_FILES.put(key, bytes, {
            httpMetadata: { contentType: task.mode === 'cutout' ? 'image/png' : (file.type || guessContentType(name)) }
        });
        uploaded.push({ key, name });
    }

    task.resultKeys = [...(task.resultKeys || []), ...uploaded];
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.completeNote = task.completeNote || '成品图已上传';

    await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task));

    if (task.submitter?.unionId && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET) {
        const notify = notifyUserDone(env, task, new URL(request.url).origin)
            .then(() => markStudioNotificationSent(env, taskId))
            .catch(e => console.error('Notify failed:', e.message));
        if (waitUntil) waitUntil(notify);
        else await notify;
    }

    return Response.json({ ok: true, taskId, uploaded });
}

function uploadPasswordMatches(password, env) {
    return String(password || '') === (env.ADMIN_UPLOAD_PASSWORD || 'ylkj');
}

async function getStudioTask(env, taskId) {
    const raw = await env.SUBMISSIONS.get(taskId);
    if (!raw) {
        return { error: Response.json({ ok: false, error: '任务不存在' }, { status: 404 }) };
    }

    let task;
    try { task = JSON.parse(raw); }
    catch {
        return { error: Response.json({ ok: false, error: '任务数据异常' }, { status: 500 }) };
    }
    if (task.kind !== 'studio') {
        return { error: Response.json({ ok: false, error: '不是图片制作任务' }, { status: 400 }) };
    }
    return { task };
}

function hasPngSignature(bytes) {
    const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
    const expected = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.length === expected.length && expected.every((value, index) => signature[index] === value);
}

function sanitizeName(name) {
    return name.replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '_').slice(0, 120);
}

function resultBaseName(task) {
    const sourceName = task.imageName
        || task.productName
        || task.refKeys?.[0]?.name
        || '成品图';
    const withoutExtension = String(sourceName).replace(/\.[^.]+$/, '').trim();
    return sanitizeName(withoutExtension).slice(0, 80) || '成品图';
}

function resultExtension(file) {
    const fromName = String(file?.name || '').match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (fromName === 'jpeg') return 'jpg';
    if (['jpg', 'png', 'webp', 'gif'].includes(fromName)) return fromName;
    const mimeMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    return mimeMap[file?.type] || 'jpg';
}

function guessContentType(name) {
    const ext = name.split('.').pop().toLowerCase();
    const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    return map[ext] || 'application/octet-stream';
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
