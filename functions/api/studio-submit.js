import { studioTaskPutOptions } from '../_shared/studio-task-storage.js';

export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { mode, submitter, desc, want, note, scene, analyzePrompt, size, imageName, productName, title, subtitle, otherText, productKeys, refKeys, modelKeys, category, variantScope, colorName, colorHex, resizeTarget, resizeReflow } = body;
    if (!mode || !submitter) {
        return Response.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }
    if (mode === 'retouch' && (!Array.isArray(refKeys) || refKeys.length !== 1)) {
        return Response.json({ ok: false, error: 'Retouch mode requires exactly one image' }, { status: 400 });
    }
    if (mode === 'variant' && (!Array.isArray(refKeys) || refKeys.length < 1)) {
        return Response.json({ ok: false, error: 'Variant mode requires at least one image' }, { status: 400 });
    }
    if (mode === 'resize_ai' && (!Array.isArray(refKeys) || refKeys.length !== 1)) {
        return Response.json({ ok: false, error: 'Resize AI mode requires exactly one image' }, { status: 400 });
    }
    if (mode === 'resize_ai' && !isValidResizeTarget(resizeTarget || size)) {
        return Response.json({ ok: false, error: '目标尺寸必须在 100–5000 px 之间' }, { status: 400 });
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
        variantScope: variantScope === 'background' ? 'background' : variantScope === 'product' ? 'product' : '',
        colorName: colorName || '',
        colorHex: colorHex || '',
        resizeTarget: resizeTarget || '',
        resizeReflow: resizeReflow === true,
        variantNextIndex: 0,
        productKeys: productKeys || [],
        refKeys: refKeys || [],
        modelKeys: modelKeys || [],
        resultKeys: [],
        status: 'pending',
        timestamp,
        createdAt: new Date(timestamp).toISOString()
    };

    try {
        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task));
        const queueKey = mode === 'variant' || mode === 'resize_ai'
            ? 'studio:imageQueue:v2'
            : 'studio:rpaQueue:v2';
        await appendQueue(env.SUBMISSIONS, queueKey, taskId);
    } catch (err) {
        return Response.json({ ok: false, error: 'Storage failed' }, { status: 500 });
    }

    // 统计当前排队任务数量（用于计算预计等待时间）
    let queueCount = 0;

    // 发送钉钉通知给管理员
    if (['free', 'program', 'retouch'].includes(mode)
        && env.DINGTALK_APPKEY
        && env.DINGTALK_APPSECRET
        && env.ADMIN_USER_ID) {
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
            
            if (mode === 'retouch') {
                content += `🖼️ 精修任务已进入处理队列\n`;
                content += `⏱ 预计等待：约 30 分钟\n\n`;
            } else if (mode === 'variant') {
                content += `🎨 改色任务已进入处理队列\n`;
                content += `⏱ 完成后会通过钉钉通知，页面可以先关闭\n\n`;
            } else if (mode === 'resize_ai') {
                content += `🖼️ 尺寸修改任务已进入后台处理\n`;
                content += `目标尺寸：${resizeTarget || size || '-'}\n`;
                content += `⏱ 完成后会通过钉钉通知，页面可以先关闭\n\n`;
            } else if (queueCount === 0) {
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

function studioModeText(mode) {
    if (mode === 'retouch') return '精修图片';
    if (mode === 'variant') return '变体改色';
    if (mode === 'resize_ai') return '尺寸修改';
    return mode === 'free' ? '自由模式' : '程序模式';
}

function isValidResizeTarget(value) {
    const match = String(value || '').trim().match(/^(\d{3,4})\s*[x×*]\s*(\d{3,4})$/i);
    if (!match) return false;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width >= 100 && width <= 5000 && height >= 100 && height <= 5000;
}

async function appendQueue(kv, key, taskId) {
    const raw = await kv.get(key).catch(() => null);
    let ids = [];
    if (raw) {
        try { ids = JSON.parse(raw); } catch { ids = []; }
    }
    if (!Array.isArray(ids)) ids = [];
    if (!ids.includes(taskId)) ids.push(taskId);
    await kv.put(key, JSON.stringify(ids.slice(-300)));
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
