export async function onRequestGet(context) {
    const { env, request } = context;
    const appKey = env.DINGTALK_APPKEY;
    if (!appKey) {
        return new Response('DINGTALK_APPKEY not configured', { status: 500 });
    }
    const origin = new URL(request.url).origin;
    const callbackUrl = `${origin}/api/dingtalk-callback`;
    const authUrl = new URL('https://login.dingtalk.com/oauth2/auth');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', appKey);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('scope', 'openid');
    authUrl.searchParams.set('prompt', 'consent');
    return Response.redirect(authUrl.href, 302);
}
