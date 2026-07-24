const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
    if (!sameSiteRequest(request)) {
        return json({ ok: false, error: '请求来源无效' }, 403);
    }
    if (!env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET) {
        return json({ ok: false, error: '钉钉发送服务未配置' }, 503);
    }

    let formData;
    try {
        formData = await request.formData();
    } catch {
        return json({ ok: false, error: '文件读取失败，请重新提交' }, 400);
    }

    const file = formData.get('file');
    const unionId = cleanText(formData.get('unionId'), 160);
    const fileType = file?.type === 'image/jpeg' ? 'jpg' : 'pdf';
    const fileName = safeFileName(formData.get('fileName') || file?.name, fileType);
    if (!file || typeof file.arrayBuffer !== 'function') {
        return json({ ok: false, error: '缺少要发送的文件' }, 400);
    }
    if (!unionId) {
        return json({ ok: false, error: '缺少钉钉用户信息，请重新登录' }, 400);
    }
    if (!['application/pdf', 'image/jpeg'].includes(file.type)) {
        return json({ ok: false, error: '只支持发送 PDF 或 JPG 文件' }, 415);
    }
    if (!file.size || file.size > MAX_FILE_BYTES) {
        return json({ ok: false, error: '文件大小必须在 20MB 以内' }, 413);
    }

    try {
        const accessToken = await getAccessToken(env.DINGTALK_APPKEY, env.DINGTALK_APPSECRET);
        const staffId = await getStaffId(accessToken, unionId);
        const mediaId = await uploadFile(accessToken, file, fileName);
        await sendFileMessage(accessToken, env.DINGTALK_APPKEY, staffId, mediaId, fileName, fileType);
        return json({ ok: true });
    } catch (error) {
        console.error('tools-send-pdf failed:', error?.message || error);
        return json({ ok: false, error: readableError(error) }, 502);
    }
}

function sameSiteRequest(request) {
    const origin = request.headers.get('Origin');
    if (!origin) return true;
    try {
        const requestUrl = new URL(request.url);
        const originUrl = new URL(origin);
        return originUrl.host === requestUrl.host || ['localhost', '127.0.0.1'].includes(originUrl.hostname);
    } catch {
        return false;
    }
}

async function getAccessToken(appKey, appSecret) {
    const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey, appSecret })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.accessToken) {
        throw new Error(`获取钉钉访问凭证失败：${data.message || data.code || response.status}`);
    }
    return data.accessToken;
}

async function getStaffId(accessToken, unionId) {
    const response = await fetch(`https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unionid: unionId })
    });
    const data = await response.json().catch(() => ({}));
    const staffId = data.result?.userid;
    if (!response.ok || data.errcode !== 0 || !staffId) {
        throw new Error(`未找到当前钉钉用户：${data.errmsg || data.errcode || response.status}`);
    }
    return staffId;
}

async function uploadFile(accessToken, file, fileName) {
    const formData = new FormData();
    formData.append('media', new Blob([await file.arrayBuffer()], { type: file.type }), fileName);
    const response = await fetch(`https://oapi.dingtalk.com/media/upload?access_token=${encodeURIComponent(accessToken)}&type=file`, {
        method: 'POST',
        body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.errcode !== 0 || !data.media_id) {
        throw new Error(`文件上传钉钉失败：${data.errmsg || data.errcode || response.status}`);
    }
    return data.media_id;
}

async function sendFileMessage(accessToken, robotCode, staffId, mediaId, fileName, fileType) {
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': accessToken
        },
        body: JSON.stringify({
            robotCode,
            userIds: [staffId],
            msgKey: 'sampleFile',
            msgParam: JSON.stringify({
                mediaId,
                fileName,
                fileType
            })
        })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code || data.success === false) {
        throw new Error(`钉钉文件消息发送失败：${data.message || data.code || response.status}`);
    }
}

function safeFileName(value, fileType) {
    const extension = fileType === 'jpg' ? 'jpg' : 'pdf';
    const original = cleanText(value, 120) || `处理后的文件.${extension}`;
    const cleaned = original.replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\.(pdf|jpe?g)$/i, '').trim() || '处理后的文件';
    return `${cleaned.slice(0, 100)}.${extension}`;
}

function cleanText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

function readableError(error) {
    const message = String(error?.message || '发送失败，请稍后重试');
    if (/访问凭证|未找到当前钉钉用户|上传钉钉失败|文件消息发送失败/.test(message)) return message;
    return '发送失败，请稍后重试';
}

function json(body, status = 200) {
    return Response.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store' }
    });
}
