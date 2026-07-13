export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { mode, submitter, desc, want, note, scene, analyzePrompt, size, imageName, productName, title, subtitle, otherText, productKeys, refKeys, modelKeys, category } = body;
    if (!mode || !submitter) {
        return Response.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }
    if (mode === 'retouch' && (!Array.isArray(refKeys) || refKeys.length !== 1)) {
        return Response.json({ ok: false, error: 'Retouch mode requires exactly one image' }, { status: 400 });
    }
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    const taskId = 'studio-' + crypto.randomUUID();
    const timestamp = Date.now();

    const task = {
        id: taskId,
        kind: 'studio',
        mode,
        submitter,
        category: category || '',
        desc: desc || '',
        want: want || '',
        note: note || '',
        scene: scene || '',
        analyzePrompt: analyzePrompt || '',
        size: size || '',
        imageName: imageName || '',
        productName: productName || '',
        title: title || '',
        subtitle: subtitle || '',
        otherText: otherText || '',
        productKeys: productKeys || [],
        refKeys: refKeys || [],
        modelKeys: modelKeys || [],
        resultKeys: [],
        status: 'pending',
        timestamp,
        createdAt: new Date(timestamp).toISOString()
    };

    try {
        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), {
            metadata: studioTaskMetadata(task)
        });
    } catch (err) {
        return Response.json({ ok: false, error: 'Storage failed' }, { status: 500 });
    }

    // 统计当前排队任务数量（用于计算预计等待时间）
    let queueCount = 0;

    // 发送钉钉通知给管理员
    if (env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET && env.ADMIN_USER_ID) {
        const origin = new URL(request.url).origin;
        const p = (async () => {
            const token = await getAccessToken(env).catch(() => null);
            if (!token) return;
            const modeText = studioModeText(mode);
            let content = `🎨 新图片制作需求\n\n`;
            content += `提交人：${submitter.name || '匿名'}\n`;
            content += `模式：${modeText}\n`;
            if (desc) content += `描述：${desc}\n`;
            if (want) content += `想做成：${want}\n`;
            content += `\n去处理：${origin}/admin.html`;
            await sendText(token, env, [env.ADMIN_USER_ID], content).catch(() => {});
        })();
        if (waitUntil) waitUntil(p);
    }

    // 发送钉钉通知给提交人（显示排队情况）
    if (env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET && submitter.unionId) {
        const origin = new URL(request.url).origin;
        const p2 = (async () => {
            const token = await getAccessToken(env).catch(() => null);
            if (!token) return;
            
            const queuePosition = queueCount + 1; // 当前任务的排队位置（前面有queueCount个，所以是第queueCount+1个）
            const estimateTime = queueCount * 6; // 每个任务平均6分钟
            const modeText = studioModeText(mode);
            const titleText = imageName ? imageName.replace(/^[^-]+-/, '') : '新任务';
            
            let content = `✅ 任务已提交成功\n\n`;
            content += `📋 ${titleText}\n`;
            content += `模式：${modeText}\n\n`;
            
            if (queueCount === 0) {
                content += `🎉 当前无人排队，您的任务将立即处理\n`;
                content += `⏱ 预计等待：4-8 分钟\n\n`;
            } else {
                content += `📊 您是第 ${queuePosition} 个排队中\n`;
                content += `⏱ 预计等待：${estimateTime} 分钟\n\n`;
            }
            
            content += `生图完成后会自动通知您\n`;
            content += `查看进度：${origin}/studio-tasks.html`;
            
            await sendText(token, env, [submitter.unionId], content).catch(() => {});
        })();
        if (waitUntil) waitUntil(p2);
    }

    return Response.json({ ok: true, id: taskId });
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

function studioModeText(mode) {
    if (mode === 'retouch') return '精修图片';
    return mode === 'free' ? '自由模式' : '程序模式';
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

async function sendText(accessToken, env, userIds, content) {
    return fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': accessToken },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds,
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
