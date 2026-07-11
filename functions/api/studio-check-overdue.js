export async function onRequestGet(context) {
    const { env, request, waitUntil } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    try {
        const now = Date.now();
        const autoSendThreshold = 80 * 1000;
        const overdueThreshold = 15 * 60 * 1000;
        const autoSent = [];
        const autoErrors = [];
        const notified = [];

        // Outside business hours, skip KV entirely so paused overnight checks cost no operations.
        if (!isAutoSendWindow(now)) {
            return Response.json({
                ok: true,
                suspended: true,
                schedule: '08:00-19:30 Asia/Shanghai',
                checked: 0,
                autoChecked: 0,
                autoSent: 0,
                autoSentTasks: [],
                autoErrors: [],
                notified: 0,
                tasks: []
            });
        }

        const list = await env.SUBMISSIONS.list({ prefix: 'studio-', limit: 1000 });
        const autoSendKeys = [];
        const overdueKeys = [];

        for (const key of list.keys) {
            const meta = key.metadata || {};
            if (meta.kind !== 'studio') continue;

            const createdAt = Number(meta.timestamp || 0);
            if (meta.status === 'pending' && !meta.sentToRpa && !meta.pausedAuto) {
                if (createdAt && (now - createdAt) >= autoSendThreshold) autoSendKeys.push(key.name);
            }

            const sentAt = meta.sentToRpaAt ? new Date(meta.sentToRpaAt).getTime() : 0;
            if (meta.status === 'processing' && meta.sentToRpa && !meta.overdueNotified) {
                if (sentAt && (now - sentAt) >= overdueThreshold) overdueKeys.push(key.name);
            }
        }

        const autoSendTasks = await readStudioTasks(env, autoSendKeys);
        const tasks = await readStudioTasks(env, overdueKeys);

        if (autoSendTasks.length) {
            const programWebhook = await safeKvGet(env.SUBMISSIONS, 'studio:rpaWebhookUrl:program') || env.RPA_WEBHOOK_URL_PROGRAM || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a3a40ac622e84b667229fde/invoke';
            const freeWebhook = env.RPA_WEBHOOK_URL_FREE || await safeKvGet(env.SUBMISSIONS, 'studio:rpaWebhookUrl:free') || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a31134a622e84b6672263ee/invoke';
            const origin = new URL(request.url).origin;
            for (const task of autoSendTasks) {
                const createdAt = typeof task.timestamp === 'number'
                    ? task.timestamp
                    : new Date(task.createdAt || task.timestamp || 0).getTime();
                if (!createdAt || (now - createdAt) < autoSendThreshold) continue;

                const webhookUrl = task.mode === 'program' ? programWebhook : freeWebhook;
                if (!webhookUrl) continue;

                try {
                    const { payload, pickedSize } = buildRpaPayload(task, origin);
                    const res = await fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const text = await res.text();
                    if (!res.ok) throw new Error('RPA webhook HTTP ' + res.status + ': ' + text.slice(0, 300));

                    task.status = 'processing';
                    task.sentToRpa = true;
                    task.sentToRpaAt = new Date().toISOString();
                    task.autoRpaLastAttemptAt = new Date().toISOString();
                    task.autoRpaLastResponse = text.slice(0, 300);
                    task.rpaSentPayload = payload;
                    if (!task.size && pickedSize) task.size = pickedSize;
                    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), {
                        metadata: studioTaskMetadata(task)
                    });

                    autoSent.push(task.id);
                    if (env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET && env.ADMIN_USER_ID) {
                        await notifyAutoSent(env, task).catch(e => console.error('Notify auto-sent failed:', e.message));
                    }
                } catch (e) {
                    const errMsg = String(e.message || e).slice(0, 300);
                    autoErrors.push({ id: task.id, error: errMsg });
                    task.autoRpaLastError = errMsg;
                    task.autoRpaLastAttemptAt = new Date().toISOString();
                    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), {
                        metadata: studioTaskMetadata(task)
                    });
                    console.error('Auto send RPA failed:', task.id, e.message);
                }
            }
        }

        for (const task of tasks) {
            if (task.overdueNotified) continue;
            const sentAt = task.sentToRpaAt ? new Date(task.sentToRpaAt).getTime() : 0;
            if (!sentAt || (now - sentAt) < overdueThreshold) continue;

            if (env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET && env.ADMIN_USER_ID) {
                const p = notifyOverdue(env, task).then(() => {
                    task.overdueNotified = true;
                    return env.SUBMISSIONS.put(task.id, JSON.stringify(task), {
                        metadata: studioTaskMetadata(task)
                    });
                }).catch(e => console.error('Notify overdue failed:', e.message));
                if (waitUntil) waitUntil(p);
                else await p;
                notified.push(task.id);
            }
        }

        return Response.json({
            ok: true,
            checked: tasks.length,
            autoChecked: autoSendTasks.length,
            autoSent: autoSent.length,
            autoSentTasks: autoSent,
            autoErrors,
            notified: notified.length,
            tasks: notified
        });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}

function isAutoSendWindow(timestamp) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const minutes = Number(values.hour) * 60 + Number(values.minute);
    return minutes >= 8 * 60 && minutes < 19 * 60 + 30;
}

async function safeKvGet(kv, key) {
    try {
        return await kv.get(key);
    } catch (err) {
        console.error('KV get failed:', key, err.message);
        return null;
    }
}

async function readStudioTasks(env, keys) {
    const tasks = [];
    for (const key of keys) {
        try {
            const raw = await env.SUBMISSIONS.get(key);
            if (!raw) continue;
            const task = JSON.parse(raw);
            if (task && task.kind === 'studio') tasks.push(task);
        } catch (err) {
            console.error('Read studio task failed:', key, err.message);
        }
    }
    return tasks;
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

function buildRpaPayload(task, origin) {
    const toUrls = (keys) => (keys || []).map(k => ({
        name: k.name,
        url: origin + '/api/public-image/' + encodeKeyToken(k.key)
    }));

    const productUrls = toUrls(task.productKeys);
    const refUrls = toUrls(task.refKeys);
    const modelUrls = toUrls(task.modelKeys);
    const allImageUrls = [...productUrls, ...refUrls].map(x => x.url).filter(Boolean);

    let pickedSize;
    if (task.mode === 'program') {
        pickedSize = normalizeStudioSize(task.size, task.desc || '');
        return {
            pickedSize,
            payload: {
                params: {
                    "产品名称": task.productName || '-',
                    "标题": task.title || '-',
                    "副标题": task.subtitle || '-',
                    "其他文案": task.otherText || '-',
                    "竞品参考图链接": refUrls[0]?.url || '-',
                    "白底参考图链接一": productUrls[0]?.url || '-',
                    "白底参考图链接二": productUrls[1]?.url || '-',
                    "任务ID": task.id,
                    "尺寸要求": (pickedSize || '1600x1600') + 'px'
                }
            }
        };
    }

    const userDesc = [task.desc, task.want, task.note].filter(Boolean).join('；');
    pickedSize = normalizeStudioSize(task.size, userDesc);
    const sizeInfo = pickedSize ? '尺寸我要' + pickedSize + 'px' : '';
    const cleanUserDesc = userDesc.replace(/@参考图(\d+)/g, '参考图片$1').replace(/@图片(\d+)/g, '参考图片$1');
    const referenceInfo = allImageUrls.length ? allImageUrls.map((url, i) => '图' + (i + 1) + '链接 ' + url).join(' ') : '';
    const modelInfo = modelUrls.length ? modelUrls.map(x => '请参考我上传的人物图片，保留人物的脸型、发型、五官特征和整体气质，不参考原图的姿势、动作、手部位置、身体角度和构图，身体动作真实、稳定、符合日常生活，身体姿势自然。人物链接： ' + x.url).join(' ') : '';
    const sceneInfo = task.scene ? '场景要求：' + task.scene : '';
    const userNeed = cleanUserDesc ? '我需要：' + cleanUserDesc : '';
    const imageNameInfo = task.imageName ? '图片命名为"' + String(task.imageName).replace(/[\r\n]+/g, ' ').trim() + '"' : '';
    const descText = [referenceInfo, modelInfo, sceneInfo, sizeInfo, '请只生成一张图片', userNeed, imageNameInfo]
        .filter(Boolean).join(' ').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

    return {
        pickedSize,
        payload: {
            params: {
                "描述": descText,
                "任务ID": task.id
            }
        }
    };
}

function encodeKeyToken(key) {
    const bytes = new TextEncoder().encode(String(key || ''));
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeStudioSize(size, desc) {
    const fromSize = extractDimension(size);
    if (fromSize) return fromSize;
    const text = String(desc || '');
    const fromDesc = extractDimension(text);
    if (fromDesc) return fromDesc;
    if (/A\+|16\s*[:：]\s*9/i.test(text)) return '1536x608';
    return '1600x1600';
}

function extractDimension(text) {
    const match = String(text || '').match(/\b\d{3,5}\s*[x×*]\s*\d{3,5}\b/);
    return match ? match[0].replace(/[×*]/g, 'x').replace(/\s+/g, '') : '';
}

async function notifyAutoSent(env, task) {
    const token = await getAccessToken(env);
    const modeText = task.mode === 'free' ? '自由模式' : '程序模式';
    const submitterName = task.submitter?.name || '匿名';
    const desc = task.desc ? task.desc.slice(0, 50) + (task.desc.length > 50 ? '...' : '') : '-';
    const content = `✅ 图片制作任务已自动发送\n\n任务 ID：${task.id}\n模式：${modeText}\n提交人：${submitterName}\n描述：${desc}\n\n已自动发送到 RPA，请等待出图。`;
    return fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [env.ADMIN_USER_ID],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
}

async function notifyOverdue(env, task) {
    const token = await getAccessToken(env);
    const modeText = task.mode === 'free' ? '自由模式' : '程序模式';
    const content = `⏰ RPA 任务超时提醒\n\n任务 ID：${task.id}\n模式：${modeText}\n提交人：${task.submitter?.name || '匿名'}\n已发送 RPA 超过 15 分钟，但尚未收到成品图。\n\n请检查 RPA 执行情况。`;
    return fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [env.ADMIN_USER_ID],
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
