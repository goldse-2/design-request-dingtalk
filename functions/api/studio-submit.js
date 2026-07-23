import { studioTaskPutOptions } from '../_shared/studio-task-storage.js';
import { normalizeLibraryReplacement } from '../_shared/studio-library-replacement.js';
import { getStudioRpaQueueInfo, queueStudioRpaTask, studioRpaModeMinutes } from '../_shared/studio-rpa-slot.js';

export async function onRequestPost(context) {
    const { request, env, waitUntil, internalTaskOptions } = context;

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { mode, submitter, desc, want, note, scene, analyzePrompt, size, imageName, productName, title, subtitle, otherText, productKeys, refKeys, modelKeys, category, variantScope, colorName, colorHex, translationLanguage, translationDimensions, watermarkType, watermarkText, resizeTarget, resizeReflow, cutoutMode, cutoutOutputFormat, aPlusDouble, photographerDecision, photographyExampleKey, photographyNote } = body;
    if (!mode || !submitter) {
        return Response.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }
    if (mode === 'retouch' && (!Array.isArray(refKeys) || refKeys.length !== 1)) {
        return Response.json({ ok: false, error: 'Retouch mode requires exactly one image' }, { status: 400 });
    }
    if (mode === 'cutout' && (!Array.isArray(refKeys) || refKeys.length !== 1)) {
        return Response.json({ ok: false, error: 'Cutout mode requires exactly one image' }, { status: 400 });
    }
    if (mode === 'variant' && (!Array.isArray(refKeys) || refKeys.length < 1)) {
        return Response.json({ ok: false, error: 'Variant mode requires at least one image' }, { status: 400 });
    }
    if (mode === 'translate_image' && (!Array.isArray(refKeys) || refKeys.length < 1 || refKeys.length > 20)) {
        return Response.json({ ok: false, error: '转换语言需要上传 1–20 张图片' }, { status: 400 });
    }
    if (mode === 'translate_image' && !['en', 'fr', 'ja', 'de'].includes(translationLanguage)) {
        return Response.json({ ok: false, error: '请选择英语、法语、日语或德语' }, { status: 400 });
    }
    if (mode === 'translate_image' && !isValidTranslationDimensions(translationDimensions, refKeys.length)) {
        return Response.json({ ok: false, error: '无法确认全部图片的原始尺寸，请重新上传' }, { status: 400 });
    }
    if (mode === 'resize_ai' && (!Array.isArray(refKeys) || refKeys.length !== 1)) {
        return Response.json({ ok: false, error: 'Resize AI mode requires exactly one image' }, { status: 400 });
    }
    if (mode === 'watermark' && (!Array.isArray(refKeys) || refKeys.length !== 1)) {
        return Response.json({ ok: false, error: '去水印模式需要上传一张图片' }, { status: 400 });
    }
    if (mode === 'watermark' && watermarkType === 'other' && !String(watermarkText || '').trim()) {
        return Response.json({ ok: false, error: '请输入需要去除的水印文字' }, { status: 400 });
    }
    if (mode === 'resize_ai' && !isValidResizeTarget(resizeTarget || size)) {
        return Response.json({ ok: false, error: '目标尺寸必须在 100–5000 px 之间' }, { status: 400 });
    }
    if (aPlusDouble === true && !['free', 'program', 'resize_ai'].includes(mode)) {
        return Response.json({ ok: false, error: 'A+ 连续双图仅支持自由模式、图生图模式和尺寸修改' }, { status: 400 });
    }
    if (aPlusDouble === true && (!Array.isArray(refKeys) || !refKeys.length)) {
        return Response.json({ ok: false, error: 'A+ 连续双图缺少合并参考图' }, { status: 400 });
    }
    const resizeAPlusDouble = aPlusDouble === true && mode === 'resize_ai';
    if (resizeAPlusDouble && !isAPlusResizeTarget(resizeTarget || size)) {
        return Response.json({ ok: false, error: 'A+ 连续双图尺寸修改必须固定输出 600x900' }, { status: 400 });
    }
    if (photographerDecision === true && !['free', 'program'].includes(mode)) {
        return Response.json({ ok: false, error: '由摄影师决定仅支持自由模式和图生图模式' }, { status: 400 });
    }
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    const clientRequestId = normalizeClientRequestId(body.clientRequestId);
    const taskId = clientRequestId ? `studio-${clientRequestId}` : 'studio-' + crypto.randomUUID();
    const timestamp = Date.now();
    const waitingPhotography = photographerDecision === true;

    if (clientRequestId) {
        const existingRaw = await env.SUBMISSIONS.get(taskId).catch(() => null);
        if (existingRaw) {
            let existingTask;
            try { existingTask = JSON.parse(existingRaw); } catch {}
            if (!existingTask || existingTask.kind !== 'studio' || existingTask.mode !== mode) {
                return Response.json({ ok: false, error: '重复请求编号与已有任务不一致' }, { status: 409 });
            }

            let existingQueueResult = null;
            if (!existingTask.photographerDecision && existingTask.status === 'pending' && !existingTask.sentToRpa) {
                const isBackgroundImageTask = isDirectImageTask(existingTask.mode);
                if (isBackgroundImageTask) {
                    await appendQueue(env.SUBMISSIONS, 'studio:imageQueue:v2', taskId);
                } else {
                    existingQueueResult = await queueStudioRpaTask(env, taskId);
                }
            }
            const existingQueueInfo = existingQueueResult && !existingTask.silent
                ? await getStudioRpaQueueInfo(env, existingTask, existingQueueResult.queueIds).catch(() => defaultQueueInfo(mode))
                : defaultQueueInfo(mode);
            return Response.json({
                ok: true,
                id: taskId,
                duplicate: true,
                waitingPhotography: Boolean(existingTask.photographerDecision),
                queued: existingTask.status === 'pending' && !existingTask.sentToRpa,
                queueInfo: existingQueueInfo
            });
        }
    }

    const silent = internalTaskOptions?.silent === true;
    const libraryReplacement = normalizeLibraryReplacement(internalTaskOptions?.libraryReplacement);
    const task = {
        id: taskId,
        clientRequestId,
        kind: 'studio',
        mode,
        submitter,
        category: category || '',
        desc: desc || '',
        want: want || '',
        note: note || '',
        scene: scene || '',
        analyzePrompt: analyzePrompt || '',
        size: resizeAPlusDouble ? '600x900' : (aPlusDouble === true ? '1464x1200' : (size || '')),
        imageName: aPlusDouble === true && !resizeAPlusDouble ? '' : (imageName || ''),
        productName: productName || '',
        title: title || '',
        subtitle: subtitle || '',
        otherText: otherText || '',
        variantScope: ['product', 'background', 'style'].includes(variantScope) ? variantScope : '',
        colorName: colorName || '',
        colorHex: colorHex || '',
        translationLanguage: mode === 'translate_image' ? translationLanguage : '',
        translationDimensions: mode === 'translate_image' ? normalizeTranslationDimensions(translationDimensions) : [],
        watermarkType: mode === 'watermark' && watermarkType === 'other' ? 'other' : (mode === 'watermark' ? 'doubao' : ''),
        watermarkText: mode === 'watermark' && watermarkType === 'other' ? normalizeWatermarkText(watermarkText) : '',
        resizeTarget: resizeTarget || '',
        resizeReflow: resizeReflow === true,
        cutoutMode: mode === 'cutout' && cutoutMode === 'vector' ? 'vector' : (mode === 'cutout' ? 'normal' : ''),
        cutoutOutputFormat: mode === 'cutout' && cutoutOutputFormat === 'jpg' ? 'jpg' : (mode === 'cutout' ? 'png' : ''),
        aPlusDouble: aPlusDouble === true,
        photographerDecision: waitingPhotography,
        photographyExampleKey: waitingPhotography ? normalizePhotographyExample(photographyExampleKey) : null,
        photographyNote: waitingPhotography ? String(photographyNote || '').trim().slice(0, 300) : '',
        photographyRequestedAt: waitingPhotography ? new Date(timestamp).toISOString() : '',
        variantNextIndex: 0,
        translationNextIndex: 0,
        productKeys: productKeys || [],
        refKeys: refKeys || [],
        modelKeys: modelKeys || [],
        resultKeys: [],
        silent,
        libraryReplacement,
        dingtalkNotified: silent,
        r2AutoNotified: silent,
        status: waitingPhotography ? 'waiting_photos' : 'pending',
        timestamp,
        createdAt: new Date(timestamp).toISOString()
    };

    let autoSent = false;
    let autoSendError = '';
    let rpaQueueResult = null;
    try {
        await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task));
        if (!waitingPhotography) {
            const isBackgroundImageTask = isDirectImageTask(mode);
            if (isBackgroundImageTask) await appendQueue(env.SUBMISSIONS, 'studio:imageQueue:v2', taskId);
            else rpaQueueResult = await queueStudioRpaTask(env, taskId);
        }
    } catch (err) {
        return Response.json({ ok: false, error: 'Storage failed' }, { status: 500 });
    }

    const queueInfo = rpaQueueResult && !task.silent
        ? await getStudioRpaQueueInfo(env, task, rpaQueueResult.queueIds).catch(() => defaultQueueInfo(mode))
        : null;

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
            let content = waitingPhotography ? `📷 新任务等待拍照\n\n` : `🎨 新图片制作需求\n\n`;
            content += `提交人：${submitter.name || '匿名'}\n`;
            content += `模式：${modeText}\n`;
            if (waitingPhotography) content += `任务ID：${taskId}\n`;
            if (desc) content += `描述：${desc}\n`;
            if (want) content += `想做成：${want}\n`;
            if (waitingPhotography && photographyNote) content += `拍摄备注：${String(photographyNote).trim().slice(0, 300)}\n`;
            if (waitingPhotography) content += `状态：等待你拍照并在管理台补图，补图后才会开始作图\n`;
            content += `\n去处理：${origin}/admin.html`;
            await sendText(token, env, [env.ADMIN_USER_ID], content).catch(() => {});
        })();
        if (waitUntil) waitUntil(p);
    }

    // 发送钉钉通知给提交人（显示排队情况）
    if (!task.silent && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET && submitter.unionId) {
        const origin = new URL(request.url).origin;
        const p2 = (async () => {
            const token = await getAccessToken(env).catch(() => null);
            if (!token) return;
            
            const modeText = studioModeText(mode);
            const titleText = imageName ? imageName.replace(/^[^-]+-/, '') : '新任务';
            
            let content = `✅ 任务已提交成功\n\n`;
            content += `📋 ${titleText}\n`;
            content += `模式：${modeText}\n\n`;

            if (waitingPhotography) {
                content += `📷 已通知摄影师补拍图片\n`;
                content += `摄影师在管理台补图后，任务会自动进入作图队列\n`;
                content += `页面可以先关闭，作图完成后会通过钉钉通知\n\n`;
            }
            
            if (!waitingPhotography && mode === 'retouch') {
                content += `🖼️ 精修任务已进入处理队列\n`;
            } else if (!waitingPhotography && mode === 'cutout') {
                content += `🖼️ 白底抠图任务已进入处理队列\n`;
            } else if (!waitingPhotography && mode === 'variant') {
                content += `🎨 改色任务已进入处理队列\n`;
                content += `⏱ 完成后会通过钉钉通知，页面可以先关闭\n\n`;
            } else if (!waitingPhotography && mode === 'translate_image') {
                content += `🌐 图片语言转换任务已进入 AI 后台处理\n`;
                content += `目标语言：${translationLanguageName(translationLanguage)}\n`;
                content += `原图尺寸会保持不变，完成后会通过钉钉通知\n\n`;
            } else if (!waitingPhotography && mode === 'resize_ai') {
                content += `🖼️ 尺寸修改任务已进入后台处理\n`;
                content += `目标尺寸：${resizeTarget || size || '-'}\n`;
                content += `⏱ 完成后会通过钉钉通知，页面可以先关闭\n\n`;
            } else if (!waitingPhotography && mode === 'watermark') {
                content += `🧽 去水印任务已进入 AI 后台处理\n`;
                content += `⏱ 完成后会通过钉钉通知，页面可以先关闭\n\n`;
            }

            if (!waitingPhotography && queueInfo) {
                if (queueInfo.aheadCount > 0) {
                    content += `📊 前面还有 ${queueInfo.aheadCount} 个任务，您排在第 ${queueInfo.queuePosition} 位\n`;
                    content += `⏱ 预计约 ${queueInfo.waitMinutes} 分钟后开始处理\n`;
                } else {
                    content += `📊 当前前面没有其他任务\n`;
                }
                content += `本任务通常需要约 ${queueInfo.ownMinutes} 分钟，预计约 ${queueInfo.completionMinutes} 分钟完成\n\n`;
            }
            
            content += `生图完成后会自动通知您\n`;
            content += `查看进度：${origin}/studio-tasks.html`;
            
            await sendText(token, env, [submitter.unionId], content).catch(() => {});
        })();
        if (waitUntil) waitUntil(p2);
    }

    return Response.json({ ok: true, id: taskId, autoSent, autoSendError, waitingPhotography, queued: !waitingPhotography && !autoSent, queueInfo });
}

function normalizePhotographyExample(value) {
    if (!value || typeof value !== 'object') return null;
    const key = String(value.key || '').trim();
    if (!key.startsWith('studio/photography-brief/')) return null;
    return {
        key,
        name: String(value.name || '拍摄案例图').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 160) || '拍摄案例图'
    };
}

function normalizeClientRequestId(value) {
    const id = String(value || '').trim();
    return /^[a-z0-9-]{8,80}$/i.test(id) ? id : '';
}

function defaultQueueInfo(mode) {
    const ownMinutes = studioRpaModeMinutes(mode);
    return { aheadCount: 0, queuePosition: 1, waitMinutes: 0, ownMinutes, completionMinutes: ownMinutes };
}

function studioModeText(mode) {
    if (mode === 'retouch') return '精修图片';
    if (mode === 'cutout') return '白底抠图';
    if (mode === 'variant') return '变体改色';
    if (mode === 'translate_image') return '转换语言';
    if (mode === 'resize_ai') return '尺寸修改';
    if (mode === 'watermark') return '去水印';
    return mode === 'free' ? '自由模式' : '程序模式';
}

function isDirectImageTask(mode) {
    return mode === 'variant' || mode === 'translate_image' || mode === 'resize_ai' || mode === 'watermark';
}

function isValidTranslationDimensions(value, expectedLength) {
    if (!Array.isArray(value) || value.length !== expectedLength) return false;
    return value.every(item => Number.isInteger(Number(item?.width))
        && Number.isInteger(Number(item?.height))
        && Number(item.width) >= 1
        && Number(item.width) <= 10000
        && Number(item.height) >= 1
        && Number(item.height) <= 10000);
}

function normalizeTranslationDimensions(value) {
    return value.map(item => {
        const width = Number(item.width);
        const height = Number(item.height);
        return width === 1472 && height === 608
            ? { width: 1464, height: 600 }
            : { width, height };
    });
}

function translationLanguageName(value) {
    return ({ en: '英语', fr: '法语', ja: '日语', de: '德语' })[value] || '英语';
}

function normalizeWatermarkText(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 80);
}

async function dispatchCutoutTask(request, env, task) {
    const source = task.refKeys?.[0];
    if (!source?.key) throw new Error('Cutout image not found');

    const origin = new URL(request.url).origin;
    const payload = {
        params: {
            "待处理图片链接": `${origin}/api/public-image/${encodeKeyToken(source.key)}`,
            "任务ID": task.id
        }
    };
    payload.params["处理类型"] = task.cutoutMode === 'vector' ? '矢量图白底' : '普通白底';
    const webhookUrl = env.RPA_WEBHOOK_URL_CUTOUT || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a573bbfc272480ce63d81d4/invoke';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
        response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`RPA webhook HTTP ${response.status}: ${text.slice(0, 300)}`);

    task.status = 'processing';
    task.sentToRpa = true;
    task.sentToRpaAt = new Date().toISOString();
    task.autoRpaLastAttemptAt = task.sentToRpaAt;
    task.autoRpaLastResponse = text.slice(0, 300);
    task.rpaSentPayload = payload;
}

function encodeKeyToken(key) {
    const bytes = new TextEncoder().encode(String(key || ''));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isValidResizeTarget(value) {
    const match = String(value || '').trim().match(/^(\d{3,4})\s*[x×*]\s*(\d{3,4})$/i);
    if (!match) return false;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width >= 100 && width <= 5000 && height >= 100 && height <= 5000;
}

function isAPlusResizeTarget(value) {
    const match = String(value || '').trim().match(/^(\d{3,4})\s*[x×*]\s*(\d{3,4})$/i);
    return Number(match?.[1]) === 600 && Number(match?.[2]) === 900;
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
