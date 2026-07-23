export async function onRequestGet(context) {
    const { params, env, request } = context;
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

    const url = new URL(request.url);
    const storedName = key.split('/').pop() || 'image.jpg';
    const requestedName = url.searchParams.get('name');
    const fileName = sanitizeFileName(requestedName || storedName);
    const dispositionType = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    const ext = fileName.split('.').pop().toLowerCase();
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
    const contentType = obj.httpMetadata?.contentType || mimeMap[ext] || 'image/jpeg';

    const headers = {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
            'Content-Disposition': contentDisposition(dispositionType, fileName)
    };
    if (ext === 'svg') {
        headers['X-Content-Type-Options'] = 'nosniff';
        headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
    }

    return new Response(obj.body, { headers });
}

function sanitizeFileName(name) {
    return String(name || 'image.jpg').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 160) || 'image.jpg';
}

function contentDisposition(type, fileName) {
    const asciiName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `${type}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function decodeKeyToken(token) {
    const normalized = token.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}
