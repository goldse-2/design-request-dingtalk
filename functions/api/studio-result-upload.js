export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    let form;
    try { form = await request.formData(); }
    catch { return Response.json({ ok: false, error: 'Invalid form data' }, { status: 400 }); }

    const password = String(form.get('password') || '');
    const expected = env.ADMIN_UPLOAD_PASSWORD || 'ylkj';
    if (password !== expected) {
        return Response.json({ ok: false, error: '密码错误' }, { status: 401 });
    }

    const taskId = String(form.get('taskId') || '').trim();
    if (!taskId) return Response.json({ ok: false, error: '缺少任务 ID' }, { status: 400 });

    const raw = await env.SUBMISSIONS.get(taskId);
    if (!raw) return Response.json({ ok: false, error: '任务不存在' }, { status: 404 });

    let task;
    try { task = JSON.parse(raw); }
    catch { return Response.json({ ok: false, error: '任务数据异常' }, { status: 500 }); }
    if (task.kind !== 'studio') return Response.json({ ok: false, error: '不是图片制作任务' }, { status: 400 });

    const files = form.getAll('files').filter(f => f && typeof f !== 'string');
    if (!files.length) return Response.json({ ok: false, error: '请上传成品图' }, { status: 400 });

    const uploaded = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = sanitizeName(file.name || `result-${i + 1}.png`);
        const key = `studio-results/${taskId}/${Date.now()}-${i + 1}-${name}`;
        await env.SUBMISSION_FILES.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type || guessContentType(name) }
        });
        uploaded.push({ key, name });
    }

    task.resultKeys = [...(task.resultKeys || []), ...uploaded];
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.completeNote = task.completeNote || '成品图已上传';

    await env.SUBMISSIONS.put(taskId, JSON.stringify(task), {
        metadata: { kind: 'studio', mode: task.mode, timestamp: task.timestamp }
    });

    if (task.submitter?.unionId && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET) {
        const notify = notifyUserDone(env, task, new URL(request.url).origin)
            .then(() => {
                task.dingtalkNotified = true;
                task.dingtalkNotifiedAt = new Date().toISOString();
                return env.SUBMISSIONS.put(taskId, JSON.stringify(task), {
                    metadata: { kind: 'studio', mode: task.mode, timestamp: task.timestamp }
                });
            })
            .catch(e => console.error('Notify failed:', e.message));
        if (waitUntil) waitUntil(notify);
        else await notify;
    }

    return Response.json({ ok: true, taskId, uploaded });
}

function sanitizeName(name) {
    return name.replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '_').slice(0, 120);
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
    return fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [staffId],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
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
