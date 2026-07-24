import { PDFDocument } from 'pdf-lib';

export const STAMP_LIBRARY_PREFIX = 'stamp-library/';
export const STAMP_TASK_PREFIX = 'stamp-request-';
export const STAMP_RETENTION_SECONDS = 20 * 24 * 60 * 60;

export async function listStampFiles(env) {
    if (!env?.SUBMISSION_FILES) throw new Error('文件存储未配置');
    const listed = await env.SUBMISSION_FILES.list({ prefix: STAMP_LIBRARY_PREFIX, limit: 1000 });
    const entries = listed.keys || listed.objects || [];
    return entries.map(object => {
        const key = object.name || object.key;
        const parsed = parseStampKey(key);
        if (!parsed) return null;
        const metadata = object.metadata || object.customMetadata || {};
        return {
            key,
            companyName: parsed.companyName,
            name: parsed.name,
            type: metadata.contentType || stampContentType(parsed.name),
            size: Number(metadata.size || object.size || 0),
            uploadedAt: metadata.uploadedAt || object.uploaded || '',
            version: metadata.version || object.etag || object.uploaded || object.size || ''
        };
    }).filter(Boolean).sort((a, b) => `${a.companyName}/${a.name}`.localeCompare(`${b.companyName}/${b.name}`));
}

export function stampCompanyNameFromFileName(name) {
    const withoutExtension = String(name || '').replace(/\.[^.]+$/, '').trim();
    return withoutExtension.replace(/[（(].*$/, '').trim() || withoutExtension || '未命名公司';
}

export function normalizeStampCompanyName(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\s_\-—–·,，.。()（）【】\[\]：:]/g, '')
        .replace(/(公章|印章)$/i, '')
        .toLowerCase();
}

export async function matchStampFiles(env, companyName) {
    const requested = normalizeStampCompanyName(companyName);
    if (!requested) return [];
    const stamps = await listStampFiles(env);
    const exact = stamps.filter(stamp => normalizeStampCompanyName(stamp.companyName) === requested);
    if (exact.length) return exact;
    if (requested.length < 4) return [];
    return stamps.filter(stamp => {
        const candidate = normalizeStampCompanyName(stamp.companyName);
        return candidate.length >= 4 && (candidate.includes(requested) || requested.includes(candidate));
    });
}

export function stampTaskPutOptions(task) {
    return {
        metadata: {
            kind: task.kind,
            status: task.status,
            timestamp: task.timestamp,
            companyName: task.companyName || '',
            autoSendAt: task.autoSendAt || ''
        },
        expirationTtl: STAMP_RETENTION_SECONDS
    };
}

export async function loadStampTask(kv, id) {
    const taskId = String(id || '').trim();
    if (!/^stamp-request-[0-9a-f-]{36}$/i.test(taskId)) return null;
    const raw = await kv.get(taskId).catch(() => null);
    const task = safeParse(raw);
    return task?.kind === 'stamp-request' ? task : null;
}

export async function saveStampTask(kv, task) {
    await kv.put(task.id, JSON.stringify(task), stampTaskPutOptions(task));
}

export function stampFilePutOptions(storage, contentType, metadata = {}, expirationTtl = 0) {
    if (typeof storage?.getWithMetadata === 'function') {
        return {
            metadata: { ...metadata, contentType },
            ...(expirationTtl > 0 ? { expirationTtl } : {})
        };
    }
    return {
        httpMetadata: { contentType },
        customMetadata: Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)]))
    };
}

export async function getStoredBinary(storage, key) {
    if (!storage || !key) return null;
    if (typeof storage.getWithMetadata === 'function') {
        const result = await storage.getWithMetadata(key, 'arrayBuffer');
        if (!result?.value) return null;
        return {
            bytes: result.value,
            contentType: result.metadata?.contentType || ''
        };
    }
    const object = await storage.get(key);
    if (!object) return null;
    return {
        bytes: object.body || await object.arrayBuffer(),
        contentType: object.httpMetadata?.contentType || object.customMetadata?.contentType || ''
    };
}

export async function processDueStampRequests(env, request, now = Date.now()) {
    if (!env?.SUBMISSIONS || !env?.SUBMISSION_FILES) return { checked: 0, sent: 0, errors: [] };
    const listed = await env.SUBMISSIONS.list({ prefix: STAMP_TASK_PREFIX, limit: 100 });
    const candidateIds = (listed.keys || [])
        .filter(key => key.metadata?.status === 'processing'
            || (key.metadata?.status === 'approved_waiting' && Date.parse(key.metadata?.autoSendAt || '') <= now))
        .map(key => key.name)
        .slice(0, 20);
    const errors = [];
    let sent = 0;
    let checked = 0;

    for (const id of candidateIds) {
        const task = await loadStampTask(env.SUBMISSIONS, id);
        if (!task) continue;
        const staleProcessing = task.status === 'processing'
            && now - Date.parse(task.processingAt || '') >= 10 * 60 * 1000;
        const isDue = task.status === 'approved_waiting'
            && Date.parse(task.autoSendAt || '') <= now;
        if (!isDue && !staleProcessing) continue;
        checked += 1;
        task.status = 'processing';
        task.processingAt = new Date(now).toISOString();
        await saveStampTask(env.SUBMISSIONS, task);
        try {
            const inputObject = await getStoredBinary(env.SUBMISSION_FILES, task.input?.key);
            const stampObject = await getStoredBinary(env.SUBMISSION_FILES, task.approvedStamp?.key);
            if (!inputObject || !stampObject) throw new Error('原文件或公章文件不存在');
            const stamped = await createStampedPdf({
                inputBytes: inputObject.bytes,
                inputType: task.input.type || inputObject.contentType,
                stampBytes: stampObject.bytes,
                stampType: task.approvedStamp.type || stampObject.contentType || stampContentType(task.approvedStamp.name)
            });
            await sendFileToDingTalk(env, task, stamped.bytes, stamped.fileName);
            task.status = 'sent';
            task.sentAt = new Date().toISOString();
            task.resultFileName = stamped.fileName;
            task.lastError = '';
            sent += 1;
            if (task.input?.key) await env.SUBMISSION_FILES.delete(task.input.key).catch(() => {});
        } catch (error) {
            const message = String(error?.message || error).slice(0, 300);
            task.sendFailures = Number(task.sendFailures || 0) + 1;
            task.lastError = message;
            if (task.sendFailures >= 2) {
                task.status = 'send_failed';
                task.autoSendAt = '';
            } else {
                task.status = 'approved_waiting';
                task.autoSendAt = new Date(now + 5 * 60 * 1000).toISOString();
            }
            errors.push({ id: task.id, error: message });
            console.error('Stamp request send failed:', task.id, message);
        }
        await saveStampTask(env.SUBMISSIONS, task).catch(error => console.error('Stamp task state save failed:', error.message));
    }
    return { checked, sent, errors };
}

export async function createStampedPdf({ inputBytes, inputType, stampBytes, stampType }) {
    const inputIsPdf = inputType === 'application/pdf';
    const output = inputIsPdf ? await PDFDocument.load(inputBytes) : await PDFDocument.create();
    const sourceImage = inputIsPdf
        ? null
        : await embedImage(output, inputBytes, inputType);

    if (!inputIsPdf) {
        const page = output.addPage([sourceImage.width, sourceImage.height]);
        page.drawImage(sourceImage, { x: 0, y: 0, width: sourceImage.width, height: sourceImage.height });
    }

    const pages = output.getPages();
    if (!pages.length) throw new Error('原文件没有可盖章的页面');
    const stampImage = await embedImage(output, stampBytes, stampType);
    const page = pages[0];
    const pageSize = page.getSize();
    const stampWidth = Math.min(pageSize.width * 0.24, 150);
    const stampHeight = stampWidth * (stampImage.height / stampImage.width);
    page.drawImage(stampImage, {
        x: pageSize.width - stampWidth - pageSize.width * 0.07,
        y: pageSize.height * 0.07,
        width: stampWidth,
        height: stampHeight,
        opacity: 0.92
    });

    return {
        bytes: await output.save({ useObjectStreams: false }),
        fileName: '盖章文件.pdf'
    };
}

async function embedImage(document, bytes, contentType) {
    if (contentType === 'image/png') return document.embedPng(bytes);
    if (contentType === 'image/jpeg') return document.embedJpg(bytes);
    throw new Error('公章或原文件图片格式不支持，请使用 PNG 或 JPG');
}

async function sendFileToDingTalk(env, task, bytes, fileName) {
    if (!env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET) throw new Error('钉钉发送服务未配置');
    const accessToken = await getAccessToken(env);
    const staffId = task.submitter?.userId || await getStaffId(accessToken, task.submitter?.unionId);
    if (!staffId) throw new Error('未找到提交人的钉钉用户');
    const mediaId = await uploadFile(accessToken, fileName, bytes);
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': accessToken },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [staffId],
            msgKey: 'sampleFile',
            msgParam: JSON.stringify({ mediaId, fileName, fileType: 'pdf' })
        })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code || data.success === false) {
        throw new Error(`钉钉文件消息发送失败 (${data.message || data.code || response.status})`);
    }
}

async function getAccessToken(env) {
    const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: env.DINGTALK_APPKEY, appSecret: env.DINGTALK_APPSECRET })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.accessToken) throw new Error('获取钉钉访问凭证失败');
    return data.accessToken;
}

async function getStaffId(accessToken, unionId) {
    if (!unionId) return '';
    const response = await fetch(`https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unionid: unionId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.errcode !== 0 || !data.result?.userid) throw new Error('获取钉钉用户失败');
    return data.result.userid;
}

async function uploadFile(accessToken, fileName, bytes) {
    const formData = new FormData();
    formData.append('media', new Blob([bytes], { type: 'application/pdf' }), fileName);
    const response = await fetch(`https://oapi.dingtalk.com/media/upload?access_token=${encodeURIComponent(accessToken)}&type=file`, {
        method: 'POST',
        body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.errcode !== 0 || !data.media_id) throw new Error('文件上传钉钉失败');
    return data.media_id;
}

export async function notifyAdminStampRequest(request, env, task) {
    if (!env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET || !env.ADMIN_USER_ID) throw new Error('管理员钉钉提醒未配置');
    const accessToken = await getAccessToken(env);
    const origin = new URL(request.url).origin;
    const matches = task.matchedStamps?.map(stamp => stamp.name).join('、') || '未找到';
    const content = [
        '收到盖章申请',
        '',
        `提交人：${task.submitter?.name || '钉钉用户'}`,
        `公司名称：${task.companyName}`,
        `自动匹配公章：${matches}`,
        `任务 ID：${task.id}`,
        '',
        `请打开管理台确认：${origin}/admin.html`
    ].join('\n');
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': accessToken },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [env.ADMIN_USER_ID],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code || data.success === false) {
        throw new Error(`管理员钉钉提醒失败 (${data.message || data.code || response.status})`);
    }
}

function parseStampKey(key) {
    if (!String(key || '').startsWith(STAMP_LIBRARY_PREFIX)) return null;
    const parts = String(key).slice(STAMP_LIBRARY_PREFIX.length).split('/');
    if (parts.length < 2) return null;
    return {
        companyName: decodePart(parts[0]),
        name: decodePart(parts.slice(1).join('/'))
    };
}

function stampContentType(name) {
    return /\.png$/i.test(String(name || '')) ? 'image/png' : 'image/jpeg';
}

function decodePart(value) {
    try { return decodeURIComponent(value); } catch { return value; }
}

function safeParse(value) {
    try { return JSON.parse(value); } catch { return null; }
}
