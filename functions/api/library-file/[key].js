export async function onRequestGet(context) {
    const { params, request, env } = context;
    const key = decodeURIComponent(params.key);
    if (!env.SUBMISSION_FILES) return new Response('Not configured', { status: 500 });

    const stored = await getStoredFile(env.SUBMISSION_FILES, key);
    if (!stored) return new Response('Not found', { status: 404 });

    const url = new URL(request.url);
    const isDownload = url.searchParams.get('dl') === '1';
    // key segments are URL-encoded, so decode the last segment to get the real filename
    const storedName = decodeURIComponent(key.split('/').pop());
    const fileName = sanitizeFileName(url.searchParams.get('name') || storedName);
    const ext = storedName.split('.').pop().toLowerCase();
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', zip: 'application/zip', ai: 'application/postscript' };
    const contentType = stored.contentType || mimeMap[ext] || 'application/octet-stream';

    const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff'
    };
    if (ext === 'svg') headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
    if (isDownload) {
        // RFC 5987: filename*=UTF-8''<percent-encoded> for non-ASCII filenames
        const asciiName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
        headers['Content-Disposition'] = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    }

    return new Response(stored.body, { headers });
}

async function getStoredFile(storage, key) {
    // Production can use R2 while local Pages development uses a KV binding.
    if (typeof storage.getWithMetadata === 'function') {
        const result = await storage.getWithMetadata(key, 'arrayBuffer');
        if (!result?.value) return null;
        return {
            body: result.value,
            contentType: result.metadata?.contentType || result.metadata?.httpMetadata?.contentType || ''
        };
    }

    const object = await storage.get(key);
    if (!object) return null;
    return {
        body: object.body || await object.arrayBuffer(),
        contentType: object.httpMetadata?.contentType || ''
    };
}

function sanitizeFileName(name) {
    return String(name || 'image.jpg').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 160) || 'image.jpg';
}
