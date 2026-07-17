import { taskNeedsRpaTranslation, translateForRpa, translateProgramFieldsForRpa } from '../_shared/ai-translate.js';
import { studioTaskPutOptions } from '../_shared/studio-task-storage.js';

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
        const origin = new URL(request.url).origin;
        const dispatched = await dispatchStudioTaskToRpa({ env, task, origin, webhookUrl, persistWebhook: true });
        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task));

        return Response.json({ ok: true, status: dispatched.status, sentBody: dispatched.payload, response: dispatched.response });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}

export async function dispatchStudioTaskToRpa({ env, task, origin, webhookUrl, persistWebhook = false }) {
    const effectiveWebhookUrl = task.mode === 'retouch'
        ? env.RPA_WEBHOOK_URL_RETOUCH || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a543c91645904b3178e096b/invoke'
        : task.mode === 'cutout'
            ? env.RPA_WEBHOOK_URL_CUTOUT || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a573bbfc272480ce63d81d4/invoke'
            : webhookUrl;
    if (!effectiveWebhookUrl) throw new Error('RPA webhook URL is not configured');

    if (persistWebhook) {
        const webhookKey = task.mode === 'program'
            ? 'studio:rpaWebhookUrl:program'
            : task.mode === 'retouch'
                ? 'studio:rpaWebhookUrl:retouch'
                : task.mode === 'cutout'
                    ? 'studio:rpaWebhookUrl:cutout'
                    : 'studio:rpaWebhookUrl:free';
        await env.SUBMISSIONS.put(webhookKey, effectiveWebhookUrl);
    }

    const toUrls = keys => (keys || []).map(key => ({
        name: key.name,
        url: `${origin}/api/public-image/${encodeKeyToken(key.key)}`
    }));
    const productUrls = toUrls(task.productKeys);
    const refUrls = toUrls(task.refKeys);
    const modelUrls = toUrls(task.modelKeys);
    const allImageUrls = [...productUrls, ...refUrls].map(item => item.url).filter(Boolean);
    let payload;
    let pickedSize;

    if (task.mode === 'retouch' || task.mode === 'cutout') {
        const sourceImageUrl = refUrls[0]?.url;
        if (!sourceImageUrl) throw new Error(task.mode === 'cutout' ? 'Cutout image not found' : 'Retouch image not found');
        payload = { params: { "待处理图片链接": sourceImageUrl, "任务ID": task.id } };
    } else if (task.mode === 'program') {
        pickedSize = normalizeStudioSize(task.size, task.desc || '');
        const translatedFields = await translateProgramFieldsForRpa(env, {
            productName: task.productName || '-',
            title: task.title || '-',
            subtitle: task.subtitle || '-',
            otherText: task.otherText || '-'
        });
        payload = {
            params: {
                "产品名称": translatedFields.productName,
                "标题": translatedFields.title,
                "副标题": translatedFields.subtitle,
                "其他文案": translatedFields.otherText,
                "竞品参考图链接": refUrls[0]?.url || '-',
                "白底参考图链接一": productUrls[0]?.url || '-',
                "白底参考图链接二": productUrls[1]?.url || '-',
                "任务ID": task.id,
                "尺寸要求": formatSizeRequirement(pickedSize)
            }
        };
    } else {
        const userDesc = [task.desc, task.want, task.note].filter(Boolean).join('；');
        pickedSize = normalizeStudioSize(task.size, userDesc);
        const sizeInfo = pickedSize ? '尺寸我要' + formatSizeRequirement(pickedSize) : '';
        const cleanUserDesc = userDesc.replace(/@参考图(\d+)/g, '参考图片$1').replace(/@图片(\d+)/g, '参考图片$1');
        const referenceInfo = allImageUrls.length ? allImageUrls.map((url, index) => '图' + (index + 1) + '链接 ' + url).join(' ') : '';
        const modelInfo = modelUrls.length ? modelUrls.map(item => '请参考我上传的人物图片，保留人物的脸型、发型、五官特征和整体气质，不参考原图的姿势、动作、手部位置、身体角度和构图，身体动作真实、稳定、符合日常生活，身体姿势自然。人物链接： ' + item.url).join(' ') : '';
        const sceneInfo = task.scene ? '场景要求：' + task.scene : '';
        const userNeed = cleanUserDesc ? '我需要：' + cleanUserDesc : '';
        const imageNameInfo = task.imageName ? '图片命名为"' + String(task.imageName).replace(/[\r\n]+/g, ' ').trim() + '"' : '';
        const descText = [referenceInfo, modelInfo, sceneInfo, sizeInfo, '请只生成一张图片', userNeed, imageNameInfo]
            .filter(Boolean).join(' ').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
        payload = { params: { "描述": descText, "任务ID": task.id, "尺寸要求": formatSizeRequirement(pickedSize) } };
        if (taskNeedsRpaTranslation(task)) payload.params["描述"] = await translateForRpa(env, payload.params["描述"]);
    }

    const response = await fetch(effectiveWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`RPA webhook HTTP ${response.status}: ${responseText.slice(0, 300)}`);

    task.status = 'processing';
    task.sentToRpa = true;
    task.sentToRpaAt = new Date().toISOString();
    task.rpaSentPayload = payload;
    task.autoRpaLastError = '';
    task.autoRpaLastAttemptAt = task.sentToRpaAt;
    if (persistWebhook) {
        task.overdueNotified = false;
        task.overdueNotifiedAt = '';
        task.resultTimeoutRetryCount = 0;
        task.resultTimeoutFirstAt = '';
        task.resultTimeoutRetriedAt = '';
        task.resultTimeoutRetryError = '';
        task.resultTimeoutRetryFailedAt = '';
        task.workflowTimeoutRetries = 0;
        task.workflowLastTimeoutAt = '';
    }
    if (!task.size && pickedSize) task.size = pickedSize;
    return { status: response.status, payload, response: responseText.slice(0, 500), webhookUrl: effectiveWebhookUrl };
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
    const rawSize = String(size || '');
    if (/2\s*K|自动识别/i.test(rawSize)) return '2K 自动识别';
    const text = String(desc || '');
    const fromDesc = extractDimension(text);
    if (fromDesc) return fromDesc;
    if (/A\+|16\s*[:：]\s*9/i.test(text)) return '1464x600';
    return '2K 自动识别';
}

function extractDimension(text) {
    const match = String(text || '').match(/\b\d{3,5}\s*[x×*]\s*\d{3,5}\b/);
    return match ? match[0].replace(/[×*]/g, 'x').replace(/\s+/g, '') : '';
}

function formatSizeRequirement(size) {
    const value = size || '2K 自动识别';
    return /\d{3,5}x\d{3,5}/.test(value) ? value + 'px' : value;
}
