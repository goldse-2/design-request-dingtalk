const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const RETENTION_SECONDS = 20 * 24 * 60 * 60;
const ID_PATTERN = /^tool-image-request-[0-9a-f-]{36}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,100}$/;

export async function onRequestPost({ request, env }) {
    if (!sameSiteRequest(request)) return json({ ok: false, error: '请求来源无效' }, 403);
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) return json({ ok: false, error: '文件存储未配置' }, 503);

    let form;
    try { form = await request.formData(); }
    catch { return json({ ok: false, error: '提交内容读取失败，请重试' }, 400); }

    const file = form.get('file');
    const id = cleanText(form.get('requestId'), 80);
    const token = cleanText(form.get('requestToken'), 120);
    const note = cleanText(form.get('note'), 300);
    const unionId = cleanText(form.get('unionId'), 160);
    if (!ID_PATTERN.test(id) || !TOKEN_PATTERN.test(token)) return json({ ok: false, error: '任务标识无效，请刷新页面重试' }, 400);
    if (!note) return json({ ok: false, error: '请填写需要什么文件' }, 400);
    if (!unionId) return json({ ok: false, error: '请先在钉钉中登录网站' }, 400);
    if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: '请先上传 PDF 或 Word 文件' }, 400);

    const documentType = detectDocumentType(file);
    if (!documentType) return json({ ok: false, error: '只支持 PDF 或 Word（.docx）文件' }, 415);
    if (!file.size || file.size > MAX_DOCUMENT_BYTES) return json({ ok: false, error: '文件大小必须在 20MB 以内' }, 413);

    const existingRaw = await env.SUBMISSIONS.get(id).catch(() => null);
    if (existingRaw) {
        const existing = safeParse(existingRaw);
        if (existing?.kind === 'tool-image-request' && existing.requestToken === token && existing.submitter?.unionId === unionId) {
            const adminNotified = existing.adminDingtalkNotified
                ? true
                : await notifyAdminAndRecord(request, env, existing);
            return json({
                ok: true,
                id,
                token,
                status: existing.status,
                adminNotified,
                warning: adminNotified ? '' : '任务已保存，但管理员钉钉提醒失败'
            });
        }
        return json({ ok: false, error: '任务已存在，请刷新页面后重试' }, 409);
    }

    const submitter = normalizeSubmitter(form.get('submitter'), unionId);
    const extension = documentType === 'pdf' ? 'pdf' : 'docx';
    const documentName = cleanFileName(file.name, `待处理文档.${extension}`);
    const documentKey = `tools/image-requests/${id}/document.${extension}`;
    const timestamp = Date.now();
    const task = {
        id,
        kind: 'tool-image-request',
        status: 'waiting_image',
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        requestToken: token,
        note,
        submitter,
        document: { key: documentKey, name: documentName, type: file.type || documentMimeType(documentType), documentType },
        editor: {
            targetPage: positiveInteger(form.get('targetPage'), 1),
            blendMode: String(form.get('blendMode') || '') === 'multiply' ? 'multiply' : 'normal',
            exportFormat: String(form.get('exportFormat') || '') === 'jpg' ? 'jpg' : 'pdf'
        },
        dingtalkNotified: false
    };

    try {
        await env.SUBMISSION_FILES.put(
            documentKey,
            await file.arrayBuffer(),
            filePutOptions(env.SUBMISSION_FILES, task.document.type)
        );
        await env.SUBMISSIONS.put(id, JSON.stringify(task), {
            metadata: taskMetadata(task),
            expirationTtl: RETENTION_SECONDS
        });
        const adminNotified = await notifyAdminAndRecord(request, env, task);
        return json({
            ok: true,
            id,
            token,
            status: task.status,
            adminNotified,
            warning: adminNotified ? '' : '任务已保存，但管理员钉钉提醒失败'
        });
    } catch (error) {
        console.error('tools image request create failed:', error?.message || error);
        await env.SUBMISSION_FILES.delete(documentKey).catch(() => {});
        return json({ ok: false, error: '任务保存失败，请稍后重试' }, 503);
    }
}

export async function onRequestGet({ request, env }) {
    if (!env.SUBMISSIONS) return json({ ok: false, error: '任务存储未配置' }, 503);
    const url = new URL(request.url);
    const id = cleanText(url.searchParams.get('id'), 80);
    const token = cleanText(url.searchParams.get('token'), 120);
    const task = await readAuthorizedTask(env.SUBMISSIONS, id, token);
    if (!task) return json({ ok: false, error: '等待任务不存在或已过期' }, 404);

    const response = {
        ok: true,
        task: {
            id: task.id,
            status: task.status,
            note: task.note,
            createdAt: task.createdAt,
            documentName: task.document?.name || '',
            editor: task.editor || {}
        }
    };
    if (task.status === 'ready' && task.document?.key && task.designerImage?.key) {
        response.task.documentUrl = fileUrl(task.document.key, task.document.name);
        response.task.documentType = task.document.documentType;
        response.task.documentMimeType = task.document.type;
        response.task.imageUrl = fileUrl(task.designerImage.key, task.designerImage.name);
        response.task.imageName = task.designerImage.name;
        response.task.imageMimeType = task.designerImage.type;
    }
    return json(response);
}

export async function onRequestDelete({ request, env }) {
    if (!sameSiteRequest(request)) return json({ ok: false, error: '请求来源无效' }, 403);
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) return json({ ok: false, error: '文件存储未配置' }, 503);
    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: '请求内容无效' }, 400); }
    const task = await readAuthorizedTask(env.SUBMISSIONS, cleanText(body.id, 80), cleanText(body.token, 120));
    if (!task) return json({ ok: true, deleted: true });
    await Promise.all([
        task.document?.key ? env.SUBMISSION_FILES.delete(task.document.key).catch(() => {}) : Promise.resolve(),
        task.designerImage?.key ? env.SUBMISSION_FILES.delete(task.designerImage.key).catch(() => {}) : Promise.resolve()
    ]);
    await env.SUBMISSIONS.delete(task.id);
    return json({ ok: true, deleted: true });
}

async function readAuthorizedTask(storage, id, token) {
    if (!ID_PATTERN.test(id) || !TOKEN_PATTERN.test(token)) return null;
    const raw = await storage.get(id).catch(() => null);
    const task = safeParse(raw);
    return task?.kind === 'tool-image-request' && task.requestToken === token ? task : null;
}

async function notifyAdminAndRecord(request, env, task) {
    try {
        await notifyAdmin(request, env, task);
        task.adminDingtalkNotified = true;
        task.adminDingtalkNotifiedAt = new Date().toISOString();
        task.adminDingtalkNotificationError = '';
    } catch (error) {
        console.error('tools image request admin notification failed:', error?.message || error);
        task.adminDingtalkNotified = false;
        task.adminDingtalkNotificationError = cleanText(error?.message || error || '钉钉提醒失败', 300);
    }

    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), {
        metadata: taskMetadata(task),
        expirationTtl: RETENTION_SECONDS
    }).catch(error => console.error('tools image request notification state save failed:', error?.message || error));
    return task.adminDingtalkNotified;
}

async function notifyAdmin(request, env, task) {
    if (!env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET || !env.ADMIN_USER_ID) {
        throw new Error('管理员钉钉提醒未配置');
    }
    const tokenResponse = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: env.DINGTALK_APPKEY, appSecret: env.DINGTALK_APPSECRET })
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.accessToken) throw new Error('获取钉钉访问凭证失败');

    const origin = new URL(request.url).origin;
    const content = [
        'PDF / Word 文件待添加图片',
        '',
        `提交人：${task.submitter?.name || '钉钉用户'}`,
        `文档：${task.document?.name || 'PDF / Word 文件'}`,
        `需要：${task.note || '-'}`,
        `任务 ID：${task.id}`,
        '',
        `去管理台上传图片：${origin}/admin.html`
    ].join('\n');
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': tokenData.accessToken
        },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [env.ADMIN_USER_ID],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`管理员钉钉提醒失败 (${response.status}) ${detail}`.trim());
    }
}

function detectDocumentType(file) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
    if (/wordprocessingml/i.test(file.type) || /\.docx$/i.test(file.name)) return 'docx';
    return '';
}

function normalizeSubmitter(value, unionId) {
    const parsed = safeParse(String(value || '')) || {};
    return {
        unionId,
        userId: cleanText(parsed.userId, 160),
        name: cleanText(parsed.name || parsed.nick || parsed.nickName, 80) || '钉钉用户',
        avatar: /^https?:\/\//i.test(String(parsed.avatar || '')) ? cleanText(parsed.avatar, 500) : ''
    };
}

function taskMetadata(task) {
    return {
        kind: task.kind,
        status: task.status,
        timestamp: task.timestamp,
        unionId: task.submitter?.unionId || '',
        dingtalkNotified: Boolean(task.dingtalkNotified)
    };
}

function filePutOptions(storage, contentType) {
    if (typeof storage.getWithMetadata === 'function') {
        return { metadata: { contentType }, expirationTtl: RETENTION_SECONDS };
    }
    return { httpMetadata: { contentType } };
}

function fileUrl(key, name) {
    return `/api/library-file/${encodeURIComponent(key)}?name=${encodeURIComponent(name || 'file')}`;
}

function documentMimeType(type) {
    return type === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function cleanFileName(value, fallback) {
    return String(value || fallback).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 160) || fallback;
}

function cleanText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

function safeParse(value) {
    try { return JSON.parse(value); }
    catch { return null; }
}

function sameSiteRequest(request) {
    const origin = request.headers.get('Origin');
    if (!origin) return true;
    try {
        const requestUrl = new URL(request.url);
        const originUrl = new URL(origin);
        return requestUrl.host === originUrl.host || ['localhost', '127.0.0.1'].includes(originUrl.hostname);
    } catch {
        return false;
    }
}

function json(body, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
