import { recolorImage } from '../_shared/variant-recolor-core.js';

export async function onRequestPost({ request, env }) {
    const sameOriginError = validateOrigin(request);
    if (sameOriginError) return sameOriginError;

    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ ok: false, error: '请求内容无效' }, { status: 400 });
    }

    try {
        const image = body.image || {};
        const result = await recolorImage({
            env,
            scope: body.scope,
            colorName: body.colorName,
            colorHex: body.colorHex,
            mimeType: image.mimeType || 'image/png',
            base64: image.base64 || ''
        });
        return Response.json({ ok: true, result });
    } catch (error) {
        const status = /尚未配置/.test(error.message) ? 503 : /超过 15MB/.test(error.message) ? 413 : 502;
        return Response.json({ ok: false, error: error.message || '改色失败' }, { status });
    }
}

function validateOrigin(request) {
    const origin = request.headers.get('Origin');
    const requestUrl = new URL(request.url);
    if (origin && new URL(origin).host === requestUrl.host) return null;
    const referer = request.headers.get('Referer');
    if (referer && new URL(referer).host === requestUrl.host) return null;
    if (request.headers.get('Sec-Fetch-Site') === 'same-origin') return null;
    return Response.json({ ok: false, error: '不允许跨站调用' }, { status: 403 });
}
