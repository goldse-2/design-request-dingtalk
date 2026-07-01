export async function onRequestGet(context) {
    const { params, env } = context;
    if (!env.SUBMISSION_FILES) return new Response('Not configured', { status: 500 });

    const token = String(params.token || '');
    let key;
    try {
        key = decodeKeyToken(token);
    } catch {
        return new Response('Bad image token', { status: 400 });
    }

    const obj = await env.SUBMISSION_FILES.get(key);
    if (!obj) return new Response('Not found', { status: 404 });

    const fileName = key.split('/').pop() || 'image.jpg';
    const ext = fileName.split('.').pop().toLowerCase();
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    const contentType = obj.httpMetadata?.contentType || mimeMap[ext] || 'image/jpeg';

    return new Response(obj.body, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
            'Content-Disposition': `inline; filename="${fileName.replace(/"/g, '_')}"`
        }
    });
}

function decodeKeyToken(token) {
    const normalized = token.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}
