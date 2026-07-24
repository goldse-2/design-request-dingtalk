import { isAdminAuthenticated } from '../../_shared/admin-auth.js';
import { getStoredBinary, STAMP_LIBRARY_PREFIX } from '../../_shared/stamp-workflow.js';

export async function onRequestGet({ params, request, env }) {
    if (!await isAdminAuthenticated(request, env)) return new Response('Admin authentication required', { status: 401 });
    const key = decodeURIComponent(params.key || '');
    if (!key.startsWith(STAMP_LIBRARY_PREFIX)) return new Response('Not found', { status: 404 });
    const stored = await getStoredBinary(env.SUBMISSION_FILES, key);
    if (!stored) return new Response('Not found', { status: 404 });

    const name = decodePart(key.split('/').pop());
    const ext = name.split('.').pop().toLowerCase();
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
    };
    if (new URL(request.url).searchParams.get('dl') === '1') {
        headers['Content-Disposition'] = downloadHeader(name);
    }
    return new Response(stored.bytes, { headers });
}

function decodePart(value) {
    try { return decodeURIComponent(value); } catch { return value; }
}

function downloadHeader(name) {
    const safeName = String(name || 'stamp.png').replace(/[\\/:*?"<>|\r\n]+/g, '_');
    const asciiName = safeName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}
