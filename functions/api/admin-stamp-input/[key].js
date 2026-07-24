import { isAdminAuthenticated } from '../../_shared/admin-auth.js';
import { getStoredBinary } from '../../_shared/stamp-workflow.js';

export async function onRequestGet({ params, request, env }) {
    if (!await isAdminAuthenticated(request, env)) return new Response('Admin authentication required', { status: 401 });
    const key = decodeURIComponent(params.key || '');
    if (!key.startsWith('tools/stamp-requests/')) return new Response('Not found', { status: 404 });
    const stored = await getStoredBinary(env.SUBMISSION_FILES, key);
    if (!stored) return new Response('Not found', { status: 404 });
    const name = decodePart(new URL(request.url).searchParams.get('name') || key.split('/').pop());
    const contentType = /\.pdf$/i.test(name) ? 'application/pdf' : 'image/jpeg';
    return new Response(stored.bytes, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'private, no-store',
            'Content-Disposition': downloadHeader(name)
        }
    });
}

function decodePart(value) {
    try { return decodeURIComponent(value); } catch { return value; }
}

function downloadHeader(name) {
    const safeName = String(name || 'document.pdf').replace(/[\\/:*?"<>|\r\n]+/g, '_');
    const asciiName = safeName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}
