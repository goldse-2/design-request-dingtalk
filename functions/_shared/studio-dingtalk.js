import { studioTaskPutOptions } from './studio-task-storage.js';

export async function sendStudioResultImages(env, accessToken, staffId, task, origin) {
    const resultKeys = Array.isArray(task?.resultKeys)
        ? task.resultKeys.filter(item => item && item.key)
        : [];
    if (!resultKeys.length) return { sent: false, count: 0 };

    let sentCount = 0;
    const errors = [];
    for (let index = 0; index < resultKeys.length; index++) {
        const item = resultKeys[index];
        const fileName = safeDisplayName(item.name || `成品图-${index + 1}.jpg`);
        const imageUrl = `${origin}/api/public-image/${encodeKeyToken(item.key)}`;
        const downloadUrl = task.mode === 'resize_ai'
            ? `${origin}/api/library-file/${encodeURIComponent(item.key)}?dl=1&name=${encodeURIComponent(fileName)}`
            : `${imageUrl}?download=1&name=${encodeURIComponent(fileName)}`;
        const position = `${index + 1}/${resultKeys.length}`;
        const imageMarkdown = `**${fileName}**\n\n![${fileName}](${imageUrl})\n\n[按原文件名下载](${downloadUrl})`;
        try {
            await sendDingTalkMessageWithRetry(accessToken, {
                robotCode: env.DINGTALK_APPKEY,
                userIds: [staffId],
                msgKey: 'sampleMarkdown',
                msgParam: JSON.stringify({
                    title: `图片制作完成 ${position}`,
                    text: `图片制作完成 ${position}\n\n${imageMarkdown}`
                })
            });
            sentCount++;
        } catch (cause) {
            const error = `DingTalk image message ${position} failed: ${cause.message || cause}`;
            console.error(error);
            errors.push(error);
        }
    }

    if (errors.length) {
        const error = new Error(errors.join('; '));
        error.result = { sent: false, count: sentCount, requested: resultKeys.length, errors };
        throw error;
    }

    return {
        sent: true,
        count: sentCount,
        requested: resultKeys.length,
        errors: []
    };
}

async function sendDingTalkMessageWithRetry(accessToken, body) {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-acs-dingtalk-access-token': accessToken
                },
                body: JSON.stringify(body)
            });
            if (response.ok) return;
            const detail = await response.text().catch(() => '');
            const error = new Error(`HTTP ${response.status} ${detail}`.trim());
            error.status = response.status;
            throw error;
        } catch (error) {
            lastError = error;
            const retryable = !error.status || error.status === 429 || error.status >= 500;
            if (!retryable || attempt === 2) break;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    throw lastError || new Error('DingTalk message failed');
}

function safeDisplayName(name) {
    return String(name || '成品图.jpg').replace(/[\[\]()`\r\n]/g, '_').slice(0, 120);
}

export async function markStudioNotificationSent(env, taskId, field = 'dingtalkNotified') {
    const raw = await env.SUBMISSIONS.get(taskId);
    if (!raw) throw new Error('Studio task not found while marking notification');

    const latestTask = JSON.parse(raw);
    const notifiedAt = new Date().toISOString();
    latestTask[field] = true;
    latestTask[field === 'r2AutoNotified' ? 'r2AutoNotifiedAt' : 'dingtalkNotifiedAt'] = notifiedAt;

    await env.SUBMISSIONS.put(taskId, JSON.stringify(latestTask), studioTaskPutOptions(latestTask));
    return latestTask;
}

function encodeKeyToken(key) {
    const bytes = new TextEncoder().encode(String(key || ''));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
