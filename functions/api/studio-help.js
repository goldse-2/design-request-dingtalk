const HELP_TYPES = new Set(['图片不清晰', '如何使用', '需要协助', '反馈', '描述词问题']);
const RETENTION_SECONDS = 20 * 24 * 60 * 60;

export async function onRequestPost({ request, env }) {
    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const type = String(body.type || '').trim();
    const message = String(body.message || '').trim();
    const submitter = body.submitter && typeof body.submitter === 'object' ? body.submitter : null;
    const imageKeys = Array.isArray(body.images)
        ? body.images.filter(key => typeof key === 'string' && key.startsWith('feedback-images/studio-help/')).slice(0, 4)
        : [];

    if (!HELP_TYPES.has(type)) {
        return Response.json({ ok: false, error: 'Invalid help type' }, { status: 400 });
    }
    if (!message || message.length > 2000 || !submitter) {
        return Response.json({ ok: false, error: '请填写问题说明' }, { status: 400 });
    }
    if (!env.SUBMISSIONS || !env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET || !env.ADMIN_USER_ID) {
        return Response.json({ ok: false, error: '反馈服务暂未配置' }, { status: 500 });
    }

    const timestamp = Date.now();
    const id = `studio-help-${crypto.randomUUID()}`;
    const record = {
        id,
        kind: 'studio_help',
        type,
        message,
        imageKeys,
        submitter,
        status: 'open',
        timestamp,
        createdAt: new Date(timestamp).toISOString()
    };

    try {
        await env.SUBMISSIONS.put(id, JSON.stringify(record), {
            expiration: Math.floor(timestamp / 1000) + RETENTION_SECONDS,
            metadata: {
                kind: 'studio_help',
                status: 'open',
                type,
                timestamp,
                unionId: String(submitter.unionId || '')
            }
        });

        const origin = new URL(request.url).origin;
        const imageLinks = imageKeys.map((key, index) => `图片 ${index + 1}: ${origin}/api/public-image/${encodeKeyToken(key)}`);
        const content = [
            '问题反馈 / 协助',
            '',
            `提交人：${String(submitter.name || submitter.nick || '未命名用户')}`,
            `类型：${type}`,
            `问题：${message}`,
            imageLinks.length ? '' : null,
            ...imageLinks,
            '',
            `反馈 ID：${id}`
        ].filter(line => line !== null).join('\n');

        const token = await getAccessToken(env);
        const response = await sendText(token, env, [env.ADMIN_USER_ID], content);
        if (!response.ok) throw new Error('DingTalk notification failed');
    } catch (error) {
        console.error('Studio help submission failed:', error);
        return Response.json({ ok: false, error: '提交失败，请稍后重试' }, { status: 502 });
    }

    return Response.json({ ok: true, id });
}

async function getAccessToken(env) {
    const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: env.DINGTALK_APPKEY, appSecret: env.DINGTALK_APPSECRET })
    });
    const data = await response.json();
    if (!data.accessToken) throw new Error('DingTalk token failed');
    return data.accessToken;
}

function sendText(accessToken, env, userIds, content) {
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

function encodeKeyToken(key) {
    return btoa(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
