export async function onRequestPost(context) {
    const { request, env } = context;

    let body;
    try { body = await request.json(); } catch {
        return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    if (!env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET || !env.ADMIN_UNION_ID) {
        return Response.json({ ok: false, error: 'Missing env vars', has: { appkey: !!env.DINGTALK_APPKEY, appsecret: !!env.DINGTALK_APPSECRET, unionId: !!env.ADMIN_UNION_ID } });
    }

    try {
        // Step 1: Get access token
        const tokenRes = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appKey: env.DINGTALK_APPKEY, appSecret: env.DINGTALK_APPSECRET })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.accessToken) {
            return Response.json({ ok: false, step: 'token', error: tokenData });
        }

        // Step 2: Get userId from unionId
        const userRes = await fetch(`https://api.dingtalk.com/v1.0/contact/users/id?unionId=${env.ADMIN_UNION_ID}`, {
            headers: { 'x-acs-dingtalk-access-token': tokenData.accessToken }
        });
        const userData = await userRes.json();
        if (!userData.userId) {
            return Response.json({ ok: false, step: 'userid', error: userData, unionId: env.ADMIN_UNION_ID });
        }

        // Step 3: Send message
        const sendRes = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': tokenData.accessToken },
            body: JSON.stringify({
                robotCode: env.DINGTALK_APPKEY,
                userIds: [userData.userId],
                msgKey: 'sampleOA',
                msgParam: JSON.stringify({
                    message_url: 'https://design-request-dingtalk.pages.dev/admin.html',
                    pc_message_url: 'https://design-request-dingtalk.pages.dev/admin.html',
                    head: { bgcolor: '1677FF', text: '测试通知' },
                    body: { title: '这是一条测试消息', form: [{ key: '状态', value: '测试成功' }] }
                })
            })
        });
        const sendData = await sendRes.json();
        return Response.json({ ok: true, step: 'send', userId: userData.userId, result: sendData });
    } catch (err) {
        return Response.json({ ok: false, error: err.message });
    }
}
