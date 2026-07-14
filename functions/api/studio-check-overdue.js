import { taskNeedsRpaTranslation, translateForRpa } from '../_shared/ai-translate.js';
import { markStudioNotificationSent, sendStudioResultImages } from '../_shared/studio-dingtalk.js';
import { recolorImage } from '../_shared/variant-recolor-core.js';
import { editImageWithPrompt } from '../_shared/image-edit-core.js';

export async function onRequestGet(context) {
    const { env, request, waitUntil } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    try {
        const now = Date.now();
        const url = new URL(request.url);
        const rpaOnly = url.searchParams.get('rpaOnly') === '1';
        const autoSendThreshold = 2 * 60 * 1000;
        const overdueThreshold = 15 * 60 * 1000;
        const autoSent = [];
        const autoErrors = [];
        const notified = [];
        const AUTO_QUEUE_KEY = 'studio:autoQueue:v1';
        const PROCESSING_QUEUE_KEY = 'studio:processingQueue:v1';

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

        let autoQueueIds = await readQueue(env.SUBMISSIONS, AUTO_QUEUE_KEY);
        let processingQueueIds = await readQueue(env.SUBMISSIONS, PROCESSING_QUEUE_KEY);
        if (autoQueueIds === null || processingQueueIds === null) {
            const migrated = await migrateQueues(env, now, autoSendThreshold, overdueThreshold);
            autoQueueIds = migrated.autoQueueIds;
            processingQueueIds = migrated.processingQueueIds;
        }

        const autoBatchIds = autoQueueIds.slice(0, 3);
        const processingBatchIds = processingQueueIds.slice(0, 10);
        const deferredAutoQueue = autoQueueIds.slice(autoBatchIds.length);
        const deferredProcessingQueue = processingQueueIds.slice(processingBatchIds.length);
        const autoSendTasks = await readStudioTasks(env, autoBatchIds);
        const tasks = await readStudioTasks(env, processingBatchIds);
        const nextAutoQueue = [];
        const nextProcessingQueue = [];

        if (autoSendTasks.length) {
            const autoModes = new Set(autoSendTasks.map(task => task.mode));
            const programWebhook = autoModes.has('program')
                ? await safeKvGet(env.SUBMISSIONS, 'studio:rpaWebhookUrl:program') || env.RPA_WEBHOOK_URL_PROGRAM || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a3a40ac622e84b667229fde/invoke'
                : '';
            const freeWebhook = autoModes.has('free')
                ? env.RPA_WEBHOOK_URL_FREE || await safeKvGet(env.SUBMISSIONS, 'studio:rpaWebhookUrl:free') || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a31134a622e84b6672263ee/invoke'
                : '';
            const retouchWebhook = env.RPA_WEBHOOK_URL_RETOUCH || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a543c91645904b3178e096b/invoke';
            const origin = new URL(request.url).origin;
            for (const task of autoSendTasks) {
                const createdAt = typeof task.timestamp === 'number'
                    ? task.timestamp
                    : new Date(task.createdAt || task.timestamp || 0).getTime();
                if (!createdAt || (now - createdAt) < autoSendThreshold) {
                    nextAutoQueue.push(task.id);
                    continue;
                }
                if (task.pausedAuto) continue;

                if (task.mode === 'variant' || task.mode === 'resize_ai') {
                    if (rpaOnly) {
                        deferredAutoQueue.push(task.id);
                        continue;
                    }
                    try {
                        const result = task.mode === 'resize_ai'
                            ? await processResizeAiTask(env, task)
                            : await processVariantTaskStep(env, task, origin);
                        autoSent.push(task.id);
                        const needsNotify = result.done && task.submitter?.unionId && !task.dingtalkNotified && !task.r2AutoNotified;
                        let notifyOk = !needsNotify;
                        if (needsNotify && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET) {
                            try {
                                await notifyUserDone(env, task, origin);
                                await markStudioNotificationSent(env, task.id);
                                notifyOk = true;
                            } catch (e) {
                                console.error('Notify background image task done failed:', e.message);
                            }
                        }
                        if (!result.done || !notifyOk) nextAutoQueue.push(task.id);
                    } catch (e) {
                        const errMsg = String(e.message || e).slice(0, 300);
                        autoErrors.push({ id: task.id, error: errMsg });
                        task.backgroundLastError = errMsg;
                        task.backgroundLastAttemptAt = new Date().toISOString();
                        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), {
                            metadata: studioTaskMetadata(task)
                        });
                        console.error('Background image task failed:', task.id, e.message);
                        nextAutoQueue.push(task.id);
                    }
                    continue;
                }

                if (task.status !== 'pending' || task.sentToRpa || task.pausedAuto) continue;

                const webhookUrl = task.mode === 'program'
                    ? programWebhook
                    : task.mode === 'retouch'
                        ? retouchWebhook
                        : freeWebhook;
                if (!webhookUrl) continue;

                try {
                    const { payload, pickedSize } = buildRpaPayload(task, origin);
                    if (task.mode === 'free' && taskNeedsRpaTranslation(task)) {
                        payload.params["描述"] = await translateForRpa(env, payload.params["描述"]);
                    }
                    const res = await fetchWithTimeout(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    }, 12000);
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
                    nextProcessingQueue.push(task.id);
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
                    nextAutoQueue.push(task.id);
                }
            }
        }

        for (const task of tasks) {
            if (!task || task.status !== 'processing' || !task.sentToRpa) continue;
            if (task.overdueNotified) continue;
            const sentAt = task.sentToRpaAt ? new Date(task.sentToRpaAt).getTime() : 0;
            if (!sentAt || (now - sentAt) < overdueThreshold) {
                nextProcessingQueue.push(task.id);
                continue;
            }

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

        const finalAutoQueue = unique([...nextAutoQueue, ...deferredAutoQueue]);
        const finalProcessingQueue = unique([...nextProcessingQueue, ...deferredProcessingQueue]);
        await writeQueue(env.SUBMISSIONS, AUTO_QUEUE_KEY, finalAutoQueue);
        await writeQueue(env.SUBMISSIONS, PROCESSING_QUEUE_KEY, finalProcessingQueue);

        return Response.json({
            ok: true,
            checked: tasks.length,
            autoChecked: autoSendTasks.length,
            autoSent: autoSent.length,
            autoSentTasks: autoSent,
            autoErrors,
            notified: notified.length,
            tasks: notified,
            rpaOnly,
            queueRemaining: finalAutoQueue.length,
            processingQueueRemaining: finalProcessingQueue.length
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

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err?.name === 'AbortError') throw new Error('RPA webhook timed out');
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

async function readQueue(kv, key) {
    const raw = await safeKvGet(kv, key);
    if (raw === null || raw === undefined) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return unique(parsed.filter(id => typeof id === 'string' && id.startsWith('studio-')));
    } catch (err) {
        console.error('Read studio queue failed:', key, err.message);
        return [];
    }
}

async function writeQueue(kv, key, ids) {
    const cleanIds = unique((Array.isArray(ids) ? ids : [])
        .filter(id => typeof id === 'string' && id.startsWith('studio-')))
        .slice(-500);
    await kv.put(key, JSON.stringify(cleanIds));
}

function unique(ids) {
    return [...new Set(Array.isArray(ids) ? ids : [])];
}

async function migrateQueues(env, now, autoSendThreshold, overdueThreshold) {
    const autoQueueIds = [];
    const processingQueueIds = [];
    let cursor;
    let pages = 0;

    do {
        const listOptions = { prefix: 'studio-', limit: 1000 };
        if (cursor) listOptions.cursor = cursor;
        const listed = await env.SUBMISSIONS.list(listOptions);
        pages += 1;

        for (const key of listed.keys || []) {
            const meta = key.metadata || {};
            const mode = meta.mode || '';
            const status = meta.status || '';
            const timestamp = typeof meta.timestamp === 'number' ? meta.timestamp : Number(meta.timestamp || 0);
            const isBackgroundTask = mode === 'variant' || mode === 'resize_ai';

            if (isBackgroundTask) {
                if (['pending', 'processing', 'done'].includes(status) && !meta.pausedAuto && !meta.dingtalkNotified && !meta.r2AutoNotified) {
                    autoQueueIds.push(key.name);
                }
                continue;
            }

            if (['free', 'program', 'retouch'].includes(mode)
                && status === 'pending'
                && !meta.sentToRpa
                && !meta.pausedAuto) {
                autoQueueIds.push(key.name);
            }

            if (status === 'processing'
                && meta.sentToRpa
                && !meta.overdueNotified) {
                processingQueueIds.push(key.name);
            }
        }

        cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor && pages < 5);

    return {
        autoQueueIds: unique(autoQueueIds),
        processingQueueIds: unique(processingQueueIds)
    };
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

async function processVariantTaskStep(env, task, origin) {
    if (!env.SUBMISSION_FILES) throw new Error('R2 storage not configured');
    const refKeys = Array.isArray(task.refKeys) ? task.refKeys : [];
    if (!refKeys.length) throw new Error('Variant images not found');

    const index = Math.max(0, Number(task.variantNextIndex || 0));
    if (index >= refKeys.length) {
        task.status = 'done';
        task.completedAt = task.completedAt || new Date().toISOString();
        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), { metadata: studioTaskMetadata(task) });
        return { done: true };
    }

    const source = refKeys[index];
    const sourceObject = await env.SUBMISSION_FILES.get(source.key);
    if (!sourceObject) throw new Error('Variant source image missing');

    const mimeType = sourceObject.httpMetadata?.contentType || guessContentType(source.name || source.key);
    const base64 = arrayBufferToBase64(await sourceObject.arrayBuffer());
    const result = await recolorImage({
        env,
        scope: task.variantScope,
        colorName: task.colorName,
        colorHex: task.colorHex,
        mimeType,
        base64
    });
    const stored = await storeVariantResult(env, task, result, source.name || `source-${index + 1}.png`, index);

    const nextIndex = index + 1;
    task.resultKeys = [
        ...(Array.isArray(task.resultKeys) ? task.resultKeys.filter(item => item?.key !== stored.key) : []),
        stored
    ];
    task.status = nextIndex >= refKeys.length ? 'done' : 'processing';
    task.variantNextIndex = nextIndex;
    task.variantLastAttemptAt = new Date().toISOString();
    task.variantLastError = '';
    if (task.status === 'done') {
        task.completedAt = new Date().toISOString();
        task.completeNote = '变体改色完成';
    }

    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), { metadata: studioTaskMetadata(task) });
    return { done: task.status === 'done', stored };
}

async function processResizeAiTask(env, task) {
    if (!env.SUBMISSION_FILES) throw new Error('R2 storage not configured');
    if (task.status === 'done' && Array.isArray(task.resultKeys) && task.resultKeys.length) return { done: true };

    const refKeys = Array.isArray(task.refKeys) ? task.refKeys : [];
    const source = refKeys[0];
    if (!source?.key) throw new Error('Resize source image not found');

    const target = parseResizeTarget(task.resizeTarget || task.size || '1464x600');
    const sourceObject = await env.SUBMISSION_FILES.get(source.key);
    if (!sourceObject) throw new Error('Resize source image missing');

    const mimeType = sourceObject.httpMetadata?.contentType || guessContentType(source.name || source.key);
    const base64 = arrayBufferToBase64(await sourceObject.arrayBuffer());
    const prompt = [
        `Resize and adapt the uploaded image to exactly ${target.width}x${target.height}px.`,
        'Keep the original product, subject, colors, text, logo, material details, lighting style, and composition intent as much as possible.',
        'Use a clean ecommerce-quality result. Do not add watermarks, frames, captions, extra text, or unrelated objects.',
        'Return only one final image.'
    ].join('\n');
    const result = await editImageWithPrompt({
        env,
        prompt,
        mimeType,
        base64,
        maxBytes: 20 * 1024 * 1024
    });
    const stored = await storeResizeAiResult(env, task, result, source.name || 'resize-source.png', target);

    task.resultKeys = [stored];
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.completeNote = `AI 尺寸修改完成：${target.width} × ${target.height}`;
    task.backgroundLastAttemptAt = new Date().toISOString();
    task.backgroundLastError = '';

    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), { metadata: studioTaskMetadata(task) });
    return { done: true, stored };
}

async function storeResizeAiResult(env, task, result, sourceName, target) {
    const fetched = await resultToBytes(result);
    const ext = extensionFromMime(fetched.mimeType);
    const safeName = sanitizeName(String(sourceName || 'resize-source.png').replace(/\.[^.]+$/, ''));
    const key = `studio-results/${task.id}/resize-${target.width}x${target.height}-${safeName}.${ext}`;
    await env.SUBMISSION_FILES.put(key, fetched.bytes, {
        httpMetadata: { contentType: fetched.mimeType }
    });
    return { key, name: `${safeName}-尺寸修改-${target.width}x${target.height}.${ext}` };
}

function parseResizeTarget(value) {
    const match = String(value || '').match(/(\d{3,5})\s*[x×*]\s*(\d{3,5})/i);
    if (!match) return { width: 1464, height: 600 };
    return { width: Number(match[1]), height: Number(match[2]) };
}

async function storeVariantResult(env, task, result, sourceName, index) {
    const fetched = await resultToBytes(result);
    const ext = extensionFromMime(fetched.mimeType);
    const safeName = sanitizeName(String(sourceName || `variant-${index + 1}.png`).replace(/\.[^.]+$/, ''));
    const key = `studio-results/${task.id}/variant-${index + 1}-${safeName}.${ext}`;
    await env.SUBMISSION_FILES.put(key, fetched.bytes, {
        httpMetadata: { contentType: fetched.mimeType }
    });
    return { key, name: `${safeName}-变体改色-${index + 1}.${ext}` };
}

async function resultToBytes(result) {
    if (result?.dataUrl) {
        const match = String(result.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
        if (!match) throw new Error('Invalid variant data URL');
        return { mimeType: match[1], bytes: base64ToBytes(match[2]) };
    }
    if (result?.url) {
        const response = await fetch(result.url);
        if (!response.ok) throw new Error('Variant result image download failed');
        return {
            mimeType: response.headers.get('content-type') || result.mimeType || 'image/png',
            bytes: await response.arrayBuffer()
        };
    }
    throw new Error('Variant result image missing');
}

async function notifyUserDone(env, task, origin) {
    const token = await getAccessToken(env);
    const staffId = await getStaffId(token, task.submitter.unionId);
    if (!staffId) throw new Error('No staff id');
    const resultCount = Array.isArray(task.resultKeys) ? task.resultKeys.length : 0;
    const modeText = task.mode === 'resize_ai' ? `尺寸修改已完成${task.resizeTarget ? '：' + task.resizeTarget : ''}` : '变体改色已完成';
    const content = `图片制作完成 ✅\n\n${modeText}，共 ${resultCount} 张。\n请到网站查看下载：${origin}/studio-tasks.html`;
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

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function sanitizeName(name) {
    return name.replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '_').slice(0, 80) || 'variant';
}

function guessContentType(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
    return map[ext] || 'image/png';
}

function extensionFromMime(mimeType) {
    return String(mimeType || '').includes('jpeg') ? 'jpg' : String(mimeType || '').includes('webp') ? 'webp' : 'png';
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
    if (task.mode === 'retouch') {
        const sourceImageUrl = refUrls[0]?.url;
        if (!sourceImageUrl) throw new Error('Retouch image not found');
        return {
            pickedSize: '',
            payload: {
                params: {
                    "待处理图片链接": sourceImageUrl,
                    "任务ID": task.id
                }
            }
        };
    }

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
                    "尺寸要求": formatSizeRequirement(pickedSize)
                }
            }
        };
    }

    const userDesc = [task.desc, task.want, task.note].filter(Boolean).join('；');
    pickedSize = normalizeStudioSize(task.size, userDesc);
    const sizeInfo = pickedSize ? '尺寸我要' + formatSizeRequirement(pickedSize) : '';
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
                "任务ID": task.id,
                "尺寸要求": formatSizeRequirement(pickedSize)
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

function studioModeText(mode) {
    if (mode === 'retouch') return '精修图片';
    if (mode === 'variant') return '变体改色';
    if (mode === 'resize_ai') return '尺寸修改';
    return mode === 'free' ? '自由模式' : '程序模式';
}

async function notifyAutoSent(env, task) {
    const token = await getAccessToken(env);
    const modeText = studioModeText(task.mode);
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
    const modeText = studioModeText(task.mode);
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
