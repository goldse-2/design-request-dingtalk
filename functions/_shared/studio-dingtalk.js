import { studioTaskPutOptions } from './studio-task-storage.js';

export async function sendStudioResultImages(env, accessToken, staffId, task, origin) {
    const resultKeys = Array.isArray(task?.resultKeys)
        ? task.resultKeys.filter(item => item && item.key)
        : [];
    if (!resultKeys.length) return { sent: false, count: 0 };

    const imageMarkdown = resultKeys.map((item, index) => {
        const fileName = safeDisplayName(item.name || `成品图-${index + 1}.jpg`);
        const imageUrl = `${origin}/api/public-image/${encodeKeyToken(item.key)}`;
        const downloadUrl = task.mode === 'resize_ai'
            ? `${origin}/api/library-file/${encodeURIComponent(item.key)}?dl=1&name=${encodeURIComponent(fileName)}`
            : `${imageUrl}?download=1&name=${encodeURIComponent(fileName)}`;
        return `**${fileName}**\n\n![${fileName}](${imageUrl})\n\n[按原文件名下载](${downloadUrl})`;
    }).join('\n\n');

    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': accessToken
        },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [staffId],
            msgKey: 'sampleMarkdown',
            msgParam: JSON.stringify({
                title: '图片制作完成',
                text: `图片制作完成，共 ${resultKeys.length} 张\n\n${imageMarkdown}`
            })
        })
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = `DingTalk image message failed: ${response.status} ${detail}`.trim();
        console.error(error);
        return { sent: false, count: 0, error };
    }

    return { sent: true, count: resultKeys.length };
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
