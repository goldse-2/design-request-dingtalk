import { markStudioNotificationFailed, markStudioNotificationSent, sendStudioResultImages } from '../_shared/studio-dingtalk.js';
import { completeSilentLibraryReplacement, ensureSilentLibraryReplacement, replaceLibraryImage } from '../_shared/studio-library-replacement.js';
import { studioTaskPutOptions } from '../_shared/studio-task-storage.js';
import { advanceSheetSelfWorkflow } from '../_shared/sheet-self-workflow.js';
import { releaseStudioRpaSlot } from '../_shared/studio-rpa-slot.js';
import { wakeStudioRpaQueue } from '../_shared/studio-rpa-wakeup.js';
import { enqueueRetouchLibraryReviews } from '../_shared/retouch-library-review.js';
import { advanceStudioPhotographyWorkflow } from '../_shared/studio-photography-workflow.js';

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
    return Response.json({
        ok: true,
        mode: taskResult.task.mode || '',
        cutoutMode: taskResult.task.cutoutMode === 'vector' ? 'vector' : 'normal',
        outputFormat: cutoutOutputFormat(taskResult.task),
        aPlusDouble: taskResult.task.aPlusDouble === true,
        libraryReplacement: Boolean(ensureSilentLibraryReplacement(taskResult.task))
    }, {
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
    const uploadId = normalizeUploadId(form.get('uploadId'));
    const previousBatch = Array.isArray(task.resultUploadBatches)
        ? task.resultUploadBatches.find(batch => batch?.id === uploadId)
        : null;
    if (previousBatch) {
        try {
            await enqueueRetouchLibraryReviews(env, task, previousBatch.uploaded || []);
        } catch (error) {
            console.error('Retouch library review sync failed:', taskId, error.message);
            return Response.json({ ok: false, error: '精修成品待审核同步失败，请重试上传' }, { status: 503 });
        }
        return Response.json({ ok: true, taskId, uploaded: previousBatch.uploaded || [], duplicate: true });
    }

    const files = form.getAll('files').filter(f => f && typeof f !== 'string');
    if (!files.length) return Response.json({ ok: false, error: '请上传成品图' }, { status: 400 });
    if (task.aPlusDouble === true && files.length !== 2) {
        return Response.json({ ok: false, error: 'A+ 连续双图需要上传拆分后的上下两张图片' }, { status: 400 });
    }

    const libraryReplacement = ensureSilentLibraryReplacement(task);
    const preparedFiles = [];
    const outputFormat = cutoutOutputFormat(task);
    for (const file of files) {
        const sourceExtension = resultExtension(file);
        if (!sourceExtension) {
            return Response.json({ ok: false, error: `不支持的成品格式：${file.name || '未命名文件'}` }, { status: 400 });
        }
        if (task.aPlusDouble === true && sourceExtension === 'ai') {
            return Response.json({ ok: false, error: 'A+ 连续双图需要上传可拆分的图片，不能上传 AI 文件' }, { status: 400 });
        }
        if (libraryReplacement && sourceExtension === 'ai') {
            return Response.json({ ok: false, error: '资料库替换任务需要上传图片，不能上传 AI 文件' }, { status: 400 });
        }
        if (task.mode === 'cutout' && task.cutoutMode === 'vector' && sourceExtension !== 'ai') {
            return Response.json({ ok: false, error: '矢量图白底任务需要上传 Adobe Illustrator（.ai）文件' }, { status: 400 });
        }
        if (task.mode === 'cutout' && task.cutoutMode !== 'vector' && sourceExtension === 'ai') {
            return Response.json({ ok: false, error: '普通白底抠图任务需要上传 PNG 或 JPG 图片' }, { status: 400 });
        }
        const bytes = await file.arrayBuffer();
        if (task.mode === 'cutout' && outputFormat === 'png' && !hasPngSignature(bytes)) {
            return Response.json({ ok: false, error: '当前白底抠图任务需要上传 PNG 文件' }, { status: 400 });
        }
        if (task.mode === 'cutout' && outputFormat === 'jpg' && !hasJpegSignature(bytes)) {
            return Response.json({ ok: false, error: '当前白底抠图任务需要上传 JPG 文件' }, { status: 400 });
        }
        preparedFiles.push({ file, bytes, sourceExtension });
    }

    if (libraryReplacement && preparedFiles.length !== 1) {
        return Response.json({ ok: false, error: '资料库替换任务只能上传一张成品图' }, { status: 400 });
    }

    const uploaded = [];
    if (libraryReplacement) {
        try {
            uploaded.push(await replaceLibraryImage(env, task, preparedFiles[0].bytes));
        } catch (error) {
            console.error('Library replacement R2 upload failed:', taskId, error.message);
            return Response.json({ ok: false, error: 'Failed to fetch' }, { status: 503 });
        }
    } else {
        const baseName = resultBaseName(task);
        for (let i = 0; i < preparedFiles.length; i++) {
            const { file, bytes, sourceExtension } = preparedFiles[i];
            const ext = task.mode === 'cutout' ? outputFormat : sourceExtension;
            const suffix = task.aPlusDouble === true
                ? (i === 0 ? '-上半部分' : '-下半部分')
                : (preparedFiles.length > 1 ? `-${i + 1}` : '');
            const name = `${baseName}${suffix}.${ext}`;
            const key = `studio-results/${taskId}/upload-${uploadId}-${i + 1}-${name}`;
            try {
                await putResultWithRetry(env.SUBMISSION_FILES, key, bytes, {
                    httpMetadata: { contentType: task.mode === 'cutout' ? guessContentType(name) : (file.type || guessContentType(name)) }
                });
            } catch (error) {
                console.error('Studio result R2 upload failed:', taskId, error.message);
                return Response.json({
                    ok: false,
                    error: 'Failed to fetch'
                }, { status: 503 });
            }
            uploaded.push({ key, name });
        }
    }

    task.resultKeys = libraryReplacement ? uploaded : mergeUploadedResults(task.resultKeys, uploaded);
    task.resultUploadBatches = [
        ...(Array.isArray(task.resultUploadBatches) ? task.resultUploadBatches : []),
        { id: uploadId, uploaded, completedAt: new Date().toISOString() }
    ].slice(-30);
    if (libraryReplacement) {
        completeSilentLibraryReplacement(task, uploaded[0]);
    } else {
        task.status = 'done';
        task.completedAt = new Date().toISOString();
        task.completeNote = task.completeNote || '成品图已上传';
        task.dingtalkNotified = false;
        task.r2AutoNotified = false;
    }
    const canNotify = Boolean(!task.silent && task.submitter?.unionId && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET);
    if (!libraryReplacement) {
        task.dingtalkNotificationState = canNotify ? 'sending' : 'pending';
        task.dingtalkNotificationStartedAt = canNotify ? new Date().toISOString() : '';
    }

    try {
        await enqueueRetouchLibraryReviews(env, task, uploaded);
    } catch (error) {
        console.error('Retouch library review sync failed:', taskId, error.message);
        return Response.json({ ok: false, error: '精修成品待审核同步失败，请重试上传' }, { status: 503 });
    }

    await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task));
    await releaseStudioRpaSlot(env, taskId);

    if (task.workflow?.type === 'sheet_self') {
        await advanceSheetSelfWorkflow({ env, task, origin: new URL(request.url).origin });
    } else if (task.workflow?.type === 'studio_photography') {
        await advanceStudioPhotographyWorkflow({ env, task });
    }
    wakeStudioRpaQueue(request, waitUntil);

    if (!libraryReplacement && !task.silent && canNotify) {
        const notify = notifyUserDone(env, task, new URL(request.url).origin)
            .then(() => markStudioNotificationSent(env, taskId))
            .catch(async error => {
                console.error('Notify failed:', error.message);
                await markStudioNotificationFailed(env, taskId, error).catch(markError => {
                    console.error('Mark notification failure failed:', taskId, markError.message);
                });
                await appendQueue(env.SUBMISSIONS, 'studio:processingQueue:v2', taskId).catch(queueError => {
                    console.error('Queue result notification retry failed:', taskId, queueError.message);
                });
            });
        if (waitUntil) waitUntil(notify);
        else await notify;
    } else if (!libraryReplacement && !task.silent && task.submitter?.unionId) {
        await appendQueue(env.SUBMISSIONS, 'studio:processingQueue:v2', taskId).catch(error => {
            console.error('Queue result notification retry failed:', taskId, error.message);
        });
    }

    return Response.json({ ok: true, taskId, uploaded });
}

function normalizeUploadId(value) {
    const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    return cleaned || crypto.randomUUID();
}

function mergeUploadedResults(existing, uploaded) {
    const byKey = new Map();
    [...(Array.isArray(existing) ? existing : []), ...uploaded].forEach(item => {
        if (item?.key) byKey.set(item.key, item);
    });
    return [...byKey.values()];
}

async function appendQueue(kv, key, taskId) {
    const raw = await kv.get(key).catch(() => null);
    let ids = [];
    if (raw) {
        try { ids = JSON.parse(raw); } catch { ids = []; }
    }
    if (!Array.isArray(ids)) ids = [];
    if (!ids.includes(taskId)) ids.push(taskId);
    await kv.put(key, JSON.stringify(ids.slice(-500)));
}

async function putResultWithRetry(storage, key, bytes, options) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await storage.put(key, bytes, options);
            return;
        } catch (error) {
            lastError = error;
            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, attempt * 300));
            }
        }
    }
    throw lastError || new Error('R2 upload failed');
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

function hasJpegSignature(bytes) {
    const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 3));
    return signature.length === 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
}

function cutoutOutputFormat(task) {
    if (task?.mode !== 'cutout') return '';
    if (task.cutoutMode === 'vector') return 'ai';
    return task.cutoutOutputFormat === 'jpg' ? 'jpg' : 'png';
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
    if (['jpg', 'png', 'webp', 'gif', 'ai'].includes(fromName)) return fromName;
    const mimeMap = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
        'application/postscript': 'ai', 'application/illustrator': 'ai', 'application/vnd.adobe.illustrator': 'ai'
    };
    return mimeMap[String(file?.type || '').toLowerCase()] || '';
}

function guessContentType(name) {
    const ext = name.split('.').pop().toLowerCase();
    const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ai: 'application/postscript' };
    return map[ext] || 'application/octet-stream';
}

async function notifyUserDone(env, task, origin) {
    const token = await getAccessToken(env);
    const staffId = await getStaffId(token, task.submitter.unionId);
    if (!staffId) throw new Error('No staff id');
    const content = `成品制作完成 ✓\n\n请到网站查看下载：${origin}/studio-tasks.html`;
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
