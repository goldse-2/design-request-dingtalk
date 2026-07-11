import {
    adminSessionCookie,
    clearAdminSessionCookie,
    createAdminSession,
    isAdminAuthenticated,
    passwordsMatch
} from '../_shared/admin-auth.js';

export async function onRequestGet({ request, env }) {
    const authenticated = await isAdminAuthenticated(request, env);
    return Response.json({ ok: authenticated }, {
        status: authenticated ? 200 : 401,
        headers: { 'Cache-Control': 'no-store' }
    });
}

export async function onRequestPost({ request, env }) {
    if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
        return Response.json({ ok: false, error: 'Admin authentication not configured' }, { status: 500 });
    }

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    if (!await passwordsMatch(String(body.password || ''), env.ADMIN_PASSWORD)) {
        return Response.json({ ok: false, error: 'Invalid password' }, { status: 401 });
    }

    const token = await createAdminSession(env);
    return Response.json({ ok: true }, {
        headers: {
            'Set-Cookie': adminSessionCookie(token),
            'Cache-Control': 'no-store'
        }
    });
}

export async function onRequestDelete() {
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearAdminSessionCookie() } });
}
