import { translateForRpa } from '../_shared/ai-translate.js';

export async function onRequestPost(context) {
    const { request, env } = context;
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { taskId, webhookUrl } = body;
    if (!taskId || !webhookUrl) {
        return Response.json({ ok: false, error: 'Missing taskId or webhookUrl' }, { status: 400 });
    }
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    try {
        const raw = await env.SUBMISSIONS.get(taskId);
        if (!raw) return Response.json({ ok: false, error: 'Task not found' }, { status: 404 });
        const task = JSON.parse(raw);
        const webhookKey = task.mode === 'program' ? 'studio:rpaWebhookUrl:program' : 'studio:rpaWebhookUrl:free';
        await env.SUBMISSIONS.put(webhookKey, webhookUrl);

        const origin = new URL(request.url).origin;
        const toUrls = (keys) => (keys || []).map(k => ({
            name: k.name,
            url: `${origin}/api/public-image/${encodeKeyToken(k.key)}`
        }));

        const productUrls = toUrls(task.productKeys);
        const refUrls = toUrls(task.refKeys);
        const modelUrls = toUrls(task.modelKeys);
        const allImageUrls = [...productUrls, ...refUrls].map(x => x.url).filter(Boolean);

        let payload;
        let pickedSize;
        
        if (task.mode === 'program') {
            // 图生图模式：使用结构化格式
            pickedSize = normalizeStudioSize(task.size, task.desc || '');
            payload = {
                params: {
                    "产品名称": task.productName || '-',
                    "标题": task.title || '-',
                    "副标题": task.subtitle || '-',
                    "其他文案": task.otherText || '-',
                    "竞品参考图链接": refUrls[0]?.url || '-',
                    "白底参考图链接一": productUrls[0]?.url || '-',
                    "白底参考图链接二": productUrls[1]?.url || '-',
                    "任务ID": taskId,
                    "尺寸要求": (pickedSize || '1600x1600') + 'px'
                }
            };
        } else {
            // 自由模式：使用描述格式
            const userDesc = [task.desc, task.want, task.note].filter(Boolean).join('；');
            pickedSize = normalizeStudioSize(task.size, userDesc);
            const sizeInfo = pickedSize ? '尺寸我要' + pickedSize + 'px' : '';
            const cleanUserDesc = userDesc.replace(/@参考图(\d+)/g, '参考图片$1').replace(/@图片(\d+)/g, '参考图片$1');
            const referenceInfo = allImageUrls.length ? allImageUrls.map((url, i) => '图' + (i + 1) + '链接 ' + url).join(' ') : '';
            const modelInfo = modelUrls.length ? modelUrls.map((x, i) => '请参考我上传的人物图片，保留人物的脸型、发型、五官特征和整体气质，不参考原图的姿势、动作、手部位置、身体角度和构图，身体动作真实、稳定、符合日常生活，身体姿势自然。人物链接： ' + x.url).join(' ') : '';
            const sceneInfo = task.scene ? '场景要求：' + task.scene : '';
            const userNeed = cleanUserDesc ? '我需要：' + cleanUserDesc : '';
            const imageNameInfo = task.imageName ? '图片命名为"' + String(task.imageName).replace(/[\r\n]+/g, ' ').trim() + '"' : '';
            const descText = [
                referenceInfo,
                modelInfo,
                sceneInfo,
                sizeInfo,
                '请只生成一张图片',
                userNeed,
                imageNameInfo
            ].filter(Boolean).join(' ').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

            payload = {
                params: {
                    "描述": descText,
                    "任务ID": taskId
                }
            };

            payload.params["描述"] = await translateForRpa(env, payload.params["描述"]);
        }

        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const text = await res.text();

        task.status = 'processing';
        task.sentToRpa = true;
        task.sentToRpaAt = new Date().toISOString();
        if (!task.size && pickedSize) task.size = pickedSize;
        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), {
            metadata: studioTaskMetadata(task)
        });

        return Response.json({ ok: true, status: res.status, sentBody: payload, response: text.slice(0, 500) });
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
    if (/A\+|16\s*[:：]\s*9/i.test(text)) return '1472x608';
    return '1600x1600';
}

function extractDimension(text) {
    const match = String(text || '').match(/\b\d{3,5}\s*[x×*]\s*\d{3,5}\b/);
    return match ? match[0].replace(/[×*]/g, 'x').replace(/\s+/g, '') : '';
}
