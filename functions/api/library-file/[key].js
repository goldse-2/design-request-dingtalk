export async function onRequestGet(context) {
    const { params, request, env } = context;
    const key = decodeURIComponent(params.key);
    if (!env.SUBMISSION_FILES) return new Response('Not configured', { status: 500 });

    const obj = await env.SUBMISSION_FILES.get(key);
    if (!obj) return new Response('Not found', { status: 404 });

    const url = new URL(request.url);
    const isDownload = url.searchParams.get('dl') === '1';
    const fileName = key.split('/').pop();
    const ext = fileName.split('.').pop().toLowerCase();
    const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', zip: 'application/zip' };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    const headers = { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' };
    if (isDownload) headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(fileName)}"`;

    return new Response(obj.body, { headers });
}
