import { RECORD_RETENTION_SECONDS } from '../_shared/studio-task-storage.js';
import { createEtaDeadline, normalizeEtaSelection, scheduleEtaReminder } from '../_shared/eta-reminders.js';

export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const { submissionId, action, message, eta, etaDays, images, direction } = body;
    const completionKeys = Array.isArray(body.completionKeys)
        ? body.completionKeys.slice(0, 20).map(item => ({
            key: String(item?.key || '').trim(),
            name: String(item?.name || '拍摄成品.jpg').trim().slice(0, 160)
        })).filter(item => item.key.startsWith('shoot/complete/'))
        : [];
    const imageBase64 = (images && images.length) ? images[0] : (body.imageBase64 || null);
    if (!submissionId || !action)
        return Response.json({ ok: false, error: 'Missing fields' }, { status: 400 });
    if (!['complete', 'reject', 'eta', 'processing', 'reorder', 'urgent'].includes(action))
        return Response.json({ ok: false, error: 'Invalid action' }, { status: 400 });
    if (!env.SUBMISSIONS)
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });

    try {
        // Handle urgent: set priority to 1 (top)
        if (action === 'urgent') {
            const raw = await env.SUBMISSIONS.get(submissionId);
            if (!raw) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
            const submission = JSON.parse(raw);
            submission.priority = 1;
            await env.SUBMISSIONS.put(submissionId, JSON.stringify(submission), {
                metadata: { taskType: submission.taskType, timestamp: submission.timestamp }
            });
            await env.SUBMISSIONS.put('__lastUpdated', String(Date.now()));
            return Response.json({ ok: true, action: 'urgent', submissionId });
        }

        // Handle reorder: swap priorities between adjacent items
        if (action === 'reorder') {
            const list = await env.SUBMISSIONS.list({ limit: 1000 });
            const submissions = [];
            for (const key of list.keys) {
                const r = await env.SUBMISSIONS.get(key.name);
                if (r) {
                    const s = JSON.parse(r);
                    if (!s.archived && s.status !== 'completed' && s.status !== 'rejected') submissions.push(s);
                }
            }
            submissions.sort((a, b) => (a.priority ?? a.timestamp ?? 0) - (b.priority ?? b.timestamp ?? 0));
            const idx = submissions.findIndex(s => s.id === submissionId);
            if (idx === -1) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
            if (direction === 'up' && idx > 0) {
                const prev = submissions[idx - 1], curr = submissions[idx];
                const tmp = prev.priority ?? prev.timestamp;
                prev.priority = curr.priority ?? curr.timestamp;
                curr.priority = tmp;
                await env.SUBMISSIONS.put(prev.id, JSON.stringify(prev), { metadata: { taskType: prev.taskType, timestamp: prev.timestamp } });
                await env.SUBMISSIONS.put(curr.id, JSON.stringify(curr), { metadata: { taskType: curr.taskType, timestamp: curr.timestamp } });
            } else if (direction === 'down' && idx < submissions.length - 1) {
                const next = submissions[idx + 1], curr = submissions[idx];
                const tmp = next.priority ?? next.timestamp;
                next.priority = curr.priority ?? curr.timestamp;
                curr.priority = tmp;
                await env.SUBMISSIONS.put(next.id, JSON.stringify(next), { metadata: { taskType: next.taskType, timestamp: next.timestamp } });
                await env.SUBMISSIONS.put(curr.id, JSON.stringify(curr), { metadata: { taskType: curr.taskType, timestamp: curr.timestamp } });
            }
            await env.SUBMISSIONS.put('__lastUpdated', String(Date.now()));
            return Response.json({ ok: true, action: 'reorder', submissionId });
        }

        const raw = await env.SUBMISSIONS.get(submissionId);
        if (!raw) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
        const submission = JSON.parse(raw);

        if (action === 'eta' || action === 'processing') {
            if (action === 'eta') {
                const etaSelection = normalizeEtaSelection(eta, etaDays);
                if (!etaSelection) return Response.json({ ok: false, error: 'Invalid ETA option' }, { status: 400 });
                const now = Date.now();
                submission.eta = etaSelection.label;
                submission.etaDays = etaSelection.days;
                submission.etaNote = message || '';
                submission.etaSetAt = now;
                submission.etaDueAt = createEtaDeadline(etaSelection.days, now);
                submission.etaOverdueNotifiedAt = '';
                submission.etaOverdueReminderFor = 0;
            }
            else { 
                submission.status = 'processing'; 
                submission.processingStartTime = Date.now();
                submission.priority = 0;
            }
            await env.SUBMISSIONS.put(submissionId, JSON.stringify(submission), {
                metadata: { taskType: submission.taskType, timestamp: submission.timestamp }
            });
            if (action === 'eta') await scheduleEtaReminder(env.SUBMISSIONS, submission);
        } else {
            submission.status = action === 'complete' ? 'completed' : 'rejected';
            submission.archived = true;
            submission.archivedAt = Date.now();
            if (message) submission.resultMessage = message;
            if (action === 'complete' && completionKeys.length) submission.completionKeys = completionKeys;
            await env.SUBMISSIONS.put(submissionId, JSON.stringify(submission), {
                metadata: { taskType: submission.taskType, timestamp: submission.timestamp, archived: true, archivedAt: submission.archivedAt },
                expirationTtl: RECORD_RETENTION_SECONDS
            });
        }
        await env.SUBMISSIONS.put('__lastUpdated', String(Date.now()));

        if (submission.submitter?.unionId && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET) {
            const p = sendWorkNotice(env, submission, action, message, eta, images && images.length ? images : (imageBase64 ? [imageBase64] : []), completionKeys)
                .catch(e => console.error('Notify failed:', e.message));
            if (waitUntil) waitUntil(p);
        }

        return Response.json({
            ok: true,
            action,
            submissionId,
            eta: submission.eta || '',
            etaDays: submission.etaDays,
            etaSetAt: submission.etaSetAt || 0,
            etaDueAt: submission.etaDueAt || 0
        });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}

async function getAccessToken(appKey, appSecret) {
    const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey, appSecret })
    });
    const data = await res.json();
    if (!data.accessToken) throw new Error('Token failed: ' + JSON.stringify(data));
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

async function uploadImage(accessToken, imageBase64) {
    const binary = atob(imageBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const fd = new FormData();
    fd.append('media', new Blob([bytes], { type: 'image/jpeg' }), 'reject.jpg');
    const res = await fetch(`https://oapi.dingtalk.com/media/upload?access_token=${accessToken}&type=image`, {
        method: 'POST', body: fd
    });
    const data = await res.json();
    if (data.errcode !== 0 || !data.media_id) throw new Error('Upload failed: ' + JSON.stringify(data));
    return data.media_id;
}

async function sendWorkNotice(env, submission, action, message, eta, images = [], completionKeys = []) {
    const accessToken = await getAccessToken(env.DINGTALK_APPKEY, env.DINGTALK_APPSECRET);
    const staffId = await getStaffId(accessToken, submission.submitter.unionId);

    const productName = submission.data?.basicInfo?.['型号'] || submission.taskType;
    const deliveryTime = submission.data?.basicInfo?.['交表时间'] || '';
    const submitTime = submission.createdAt
        ? new Date(submission.createdAt).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
          })
        : '';

    let content;
    if (action === 'processing') {
        content = `${productName} 处理中，稍等`;
    } else if (action === 'eta') {
        content = `预计完成时间：${eta || '-'}`;
        if (message) content += `\n${message}`;
    } else if (action === 'complete') {
        content = `作图需求已完成\n\n产品型号：${productName}\n任务类型：${submission.taskType}`;
        if (message) content += `\n\n${message}`;
    } else {
        content = `作图需求已驳回\n\n产品型号：${productName}\n任务类型：${submission.taskType}`;
        if (deliveryTime) content += `\n交表时间：${deliveryTime}`;
        if (message) content += `\n\n驳回原因：${message}`;
        content += `\n\n提交时间：${submitTime}`;
    }

    await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': accessToken },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [staffId],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });

    if (action === 'reject' && images.length > 0 && env.SUBMISSION_FILES) {
        try {
            const origin = env.SITE_ORIGIN || 'https://design-request-dingtalk.pages.dev';
            const imgUrls = [];
            for (let i = 0; i < images.length; i++) {
                const binary = atob(images[i]);
                const bytes = new Uint8Array(binary.length);
                for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
                const key = `reject-images/${submission.id}-${i}.jpg`;
                await env.SUBMISSION_FILES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
                imgUrls.push(`${origin}/api/reject-image/${submission.id}-${i}`);
            }
            const mdText = imgUrls.map((u, i) => `![附图${i + 1}](${u})`).join('\n');
            await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': accessToken },
                body: JSON.stringify({
                    robotCode: env.DINGTALK_APPKEY,
                    userIds: [staffId],
                    msgKey: 'sampleMarkdown',
                    msgParam: JSON.stringify({ title: '驳回附图', text: mdText })
                })
            });
        } catch (e) {
            console.error('Image send failed:', e.message);
        }
    }

    if (action === 'complete' && (images.length > 0 || completionKeys.length > 0) && env.SUBMISSION_FILES) {
        try {
            const origin = env.SITE_ORIGIN || 'https://design-request-dingtalk.pages.dev';
            const imgUrls = completionKeys.map(item => `${origin}/api/library-file/${encodeURIComponent(item.key)}`);
            for (let i = 0; i < images.length; i++) {
                const binary = atob(images[i]);
                const bytes = new Uint8Array(binary.length);
                for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
                const key = `complete-images/${submission.id}-${i}.jpg`;
                await env.SUBMISSION_FILES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
                imgUrls.push(`${origin}/api/reject-image/${submission.id}-${i}`);
            }
            const mdText = imgUrls.map((u, i) => `![完成图${i + 1}](${u})`).join('\n');
            await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': accessToken },
                body: JSON.stringify({
                    robotCode: env.DINGTALK_APPKEY,
                    userIds: [staffId],
                    msgKey: 'sampleMarkdown',
                    msgParam: JSON.stringify({ title: '完成结果图', text: mdText })
                })
            });
        } catch (e) {
            console.error('Complete image send failed:', e.message);
        }
    }
}
