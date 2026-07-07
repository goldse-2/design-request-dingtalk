export async function onRequestGet(context) {
    const { params, request, env } = context;
    const key = decodeURIComponent(params.key);
    if (!env.SUBMISSION_FILES) return new Response('Not configured', { status: 500 });

    const obj = await env.SUBMISSION_FILES.get(key);
    if (!obj) return new Response('Not found', { status: 404 });

    const url = new URL(request.url);
    const isDownload = url.searchParams.get('dl') === '1';
    // key segments are URL-encoded, so decode the last segment to get the real filename
    const fileName = decodeURIComponent(key.split('/').pop());
    const ext = fileName.split('.').pop().toLowerCase();
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', zip: 'application/zip' };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    const headers = { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' };
    if (isDownload) {
        // RFC 5987: filename*=UTF-8''<percent-encoded> for non-ASCII filenames
        headers['Content-Disposition'] = "attachment; filename*=UTF-8''" + encodeURIComponent(fileName);
    }

    return new Response(obj.body, { headers });
}
