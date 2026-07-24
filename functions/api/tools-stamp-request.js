import {
    matchStampFiles,
    notifyAdminStampRequest,
    saveStampTask,
    stampFilePutOptions,
    stampTaskPutOptions,
    STAMP_RETENTION_SECONDS
} from '../_shared/stamp-workflow.js';

const MAX_RESULT_BYTES = 20 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
    if (!sameSiteRequest(request)) return json({ ok: false, error: '请求来源无效' }, 403);
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) return json({ ok: false, error: '文件存储未配置' }, 503);
    let form;
    try { form = await request.formData(); } catch { return json({ ok: false, error: '提交内容读取失败，请重试' }, 400); }

    const file = form.get('file');
    const companyName = cleanText(form.get('companyName'), 120);
    const unionId = cleanText(form.get('unionId'), 160);
    const submitter = normalizeSubmitter(form.get('submitter'), unionId);
    if (!companyName) return json({ ok: false, error: '请输入公司名称' }, 400);
    if (!unionId) return json({ ok: false, error: '请先在钉钉中登录网站' }, 400);
    if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: '缺少待盖章文件' }, 400);
    if (!['application/pdf', 'image/jpeg'].includes(file.type)) return json({ ok: false, error: '盖章申请只支持 PDF 或 JPG' }, 415);
    if (!file.size || file.size > MAX_RESULT_BYTES) return json({ ok: false, error: '文件大小必须在 20MB 以内' }, 413);

    const matchedStamps = await matchStampFiles(env, companyName);
    if (!matchedStamps.length) return json({ ok: false, error: '没有找到匹配的公章，请检查公司名称' }, 422);

    const id = `stamp-request-${crypto.randomUUID()}`;
    const requestToken = crypto.randomUUID();
    const timestamp = Date.now();
    const type = file.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
    const extension = type === 'application/pdf' ? 'pdf' : 'jpg';
    const inputName = cleanFileName(file.name, `待盖章文件.${extension}`);
    const inputKey = `tools/stamp-requests/${id}/input.${extension}`;
    const task = {
        id,
        requestToken,
        kind: 'stamp-request',
        status: 'pending_approval',
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        companyName,
        matchedStamps: matchedStamps.map(stamp => ({ key: stamp.key, companyName: stamp.companyName, name: stamp.name, type: stamp.type })),
        input: { key: inputKey, name: inputName, type },
        submitter,
        adminDingtalkNotified: false,
        autoSendAt: '',
        lastError: ''
    };

    try {
        await env.SUBMISSION_FILES.put(
            inputKey,
            await file.arrayBuffer(),
            stampFilePutOptions(env.SUBMISSION_FILES, type, {
                kind: 'stamp-input',
                name: inputName,
                uploadedAt: new Date().toISOString(),
                size: file.size
            }, STAMP_RETENTION_SECONDS)
        );
        await env.SUBMISSIONS.put(id, JSON.stringify(task), stampTaskPutOptions(task));
        try {
            await notifyAdminStampRequest(request, env, task);
            task.adminDingtalkNotified = true;
            task.adminDingtalkNotifiedAt = new Date().toISOString();
        } catch (error) {
            task.adminDingtalkNotificationError = String(error?.message || error).slice(0, 300);
        }
        await saveStampTask(env.SUBMISSIONS, task);
        return json({ ok: true, id, status: task.status, adminDingtalkNotified: task.adminDingtalkNotified });
    } catch (error) {
        await env.SUBMISSION_FILES.delete(inputKey).catch(() => {});
        console.error('Stamp request save failed:', error?.message || error);
        return json({ ok: false, error: '盖章申请保存失败，请稍后重试' }, 503);
    }
}

export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const id = cleanText(url.searchParams.get('id'), 100);
    const token = cleanText(url.searchParams.get('token'), 160);
    if (!/^stamp-request-[0-9a-f-]{36}$/i.test(id) || !token) return json({ ok: false, error: '任务标识无效' }, 400);
    const task = safeParse(await env.SUBMISSIONS?.get(id).catch(() => null));
    if (!task || task.kind !== 'stamp-request' || task.requestToken !== token) return json({ ok: false, error: '任务不存在' }, 404);
    return json({ ok: true, task: { id, status: task.status, companyName: task.companyName, autoSendAt: task.autoSendAt || '' } });
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

function cleanFileName(value, fallback) {
    return String(value || fallback).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 160) || fallback;
}

function cleanText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

function safeParse(value) {
    try { return JSON.parse(value); } catch { return null; }
}

function sameSiteRequest(request) {
    const origin = request.headers.get('Origin');
    if (!origin) return true;
    try {
        const requestUrl = new URL(request.url);
        const originUrl = new URL(origin);
        return requestUrl.host === originUrl.host || ['localhost', '127.0.0.1'].includes(originUrl.hostname);
    } catch { return false; }
}

function json(body, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
