export async function onRequestGet(context) {
    const { env, request } = context;
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    if (!code) {
        return Response.redirect(new URL('/', request.url).href + '?auth_error=no_code', 302);
    }

    const appKey = env.DINGTALK_APPKEY;
    const appSecret = env.DINGTALK_APPSECRET;
    if (!appKey || !appSecret) {
        return Response.redirect(new URL('/', request.url).href + '?auth_error=not_configured', 302);
    }

    try {
        // Step 1: Get user access token
        const tokenRes = await fetch('https://api.dingtalk.com/v1.0/oauth2/userAccessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: appKey, clientSecret: appSecret, code, grantType: 'authorization_code' })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.accessToken) {
            throw new Error(tokenData.message || 'Token exchange failed');
        }

        // Step 2: Get basic user info (unionId, nick, avatar)
        const userRes = await fetch('https://api.dingtalk.com/v1.0/contact/users/me', {
            headers: { 'x-acs-dingtalk-access-token': tokenData.accessToken }
        });
        const userInfo = await userRes.json();

        // Step 3: Get app access token for old API
        const appTokenRes = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appKey, appSecret })
        });
        const appTokenData = await appTokenRes.json();

        // Step 4: Use old API to get real staffId by unionId
        let staffId = '';
        if (appTokenData.accessToken && userInfo.unionId) {
            const staffRes = await fetch(`https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=${appTokenData.accessToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ unionid: userInfo.unionId })
            });
            const staffData = await staffRes.json();
            if (staffData.errcode === 0) {
                staffId = staffData.result?.userid || '';
            }
        }

        const user = {
            name: userInfo.nick || userInfo.name || 'Unknown',
            avatar: userInfo.avatarUrl || '',
            unionId: userInfo.unionId || '',
            userId: staffId
        };

        const session = btoa(unescape(encodeURIComponent(JSON.stringify(user))));
        const redirectUrl = new URL('/studio', request.url);
        redirectUrl.searchParams.set('session', session);
        return Response.redirect(redirectUrl.href, 302);
    } catch (err) {
        return Response.redirect(new URL('/', request.url).href + '?auth_error=' + encodeURIComponent(err.message), 302);
    }
}
