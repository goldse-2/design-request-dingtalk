export async function onRequestPatch(context) {
    const { request, env } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { id, desc, note } = body;
    if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });

    const raw = await env.SUBMISSIONS.get(id);
    if (!raw) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });

    let task;
    try { task = JSON.parse(raw); } catch { return Response.json({ ok: false, error: 'Bad data' }, { status: 500 }); }
    if (task.kind !== 'studio') return Response.json({ ok: false, error: 'Not a studio task' }, { status: 400 });

    if (typeof desc === 'string') task.desc = desc;
    if (typeof note === 'string') task.note = note;

    await env.SUBMISSIONS.put(id, JSON.stringify(task), {
        metadata: studioTaskMetadata(task)
    });
    return Response.json({ ok: true, task });
}

export async function onRequestGet(context) {
    const { env, request } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    const url = new URL(request.url);
    const unionId = url.searchParams.get('unionId');
    const all = url.searchParams.get('all') === '1';

    try {
        if (env.SUBMISSION_FILES) {
            await syncR2StudioResults(env, request);
        }

        const list = await env.SUBMISSIONS.list({ prefix: 'studio-', limit: 1000 });
        const keys = list.keys
            .filter(k => (k.metadata || {}).kind === 'studio')
            .filter(k => all || !unionId || k.metadata?.unionId === unionId)
            .map(k => k.name);
        const results = await Promise.all(keys.map(k => env.SUBMISSIONS.get(k)));

        let tasks = results
            .filter(Boolean)
            .map(r => { try { return JSON.parse(r); } catch { return null; } })
            .filter(t => t && t.kind === 'studio');

        if (!all && unionId) {
            tasks = tasks.filter(t => t.submitter?.unionId === unionId);
        }

        tasks.sort((a, b) => b.timestamp - a.timestamp);

        return Response.json({ ok: true, tasks });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}

async function syncR2StudioResults(env, request) {
    const pendingList = await env.SUBMISSIONS.list({ prefix: 'studio-', limit: 1000 });
    const keys = pendingList.keys
        .filter(k => (k.metadata || {}).kind === 'studio')
        .filter(k => k.metadata?.status && k.metadata.status !== 'done' && k.metadata.status !== 'rejected')
        .map(k => k.name);
    const raws = await Promise.all(keys.map(k => env.SUBMISSIONS.get(k)));
    const tasks = raws
        .filter(Boolean)
        .map(r => {
            try { return JSON.parse(r); } catch { return null; }
        })
        .filter(t => t && t.kind === 'studio' && t.status !== 'done');

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

        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), {
            metadata: studioTaskMetadata(task)
        });

        if (!task.r2AutoNotified && task.submitter?.unionId && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET) {
            await notifyUserDone(env, task, new URL(request.url).origin).catch(e => console.error('Auto notify failed:', e.message));
            task.r2AutoNotified = true;
            await env.SUBMISSIONS.put(task.id, JSON.stringify(task), {
                metadata: studioTaskMetadata(task)
            });
        }
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
        overdueNotified: Boolean(task.overdueNotified)
    };
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
