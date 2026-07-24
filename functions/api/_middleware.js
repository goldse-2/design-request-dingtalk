import { isAdminAuthenticated } from '../_shared/admin-auth.js';

const ADMIN_PATHS = new Set([
    '/api/submissions',
    '/api/update-status',
    '/api/library-upload',
    '/api/mark-urgent',
    '/api/reorder-task',
    '/api/save-order',
    '/api/send-feedback',
    '/api/notify-test',
    '/api/studio-webhook',
    '/api/studio-rpa-queue',
    '/api/studio-pause-auto',
    '/api/studio-complete',
    '/api/admin-optimize-prompt',
    '/api/admin-library-cutout',
    '/api/admin-retouch-library-review',
    '/api/admin-tools-image-request',
    '/api/sheet-self-photo',
    '/api/studio-photography-photo',
    '/api/retention-cleanup'
]);

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    if (!requiresAdmin(request, url)) return context.next();

    if (!await isAdminAuthenticated(request, env)) {
        return Response.json({ ok: false, error: 'Admin authentication required' }, { status: 401 });
    }
    return context.next();
}

function requiresAdmin(request, url) {
    if (ADMIN_PATHS.has(url.pathname)) return true;
    if (url.pathname === '/api/studio-examples') {
        return ['PATCH', 'DELETE'].includes(request.method) || url.searchParams.get('all') === '1';
    }
    if (url.pathname === '/api/studio-guides') {
        return request.method !== 'GET' || url.searchParams.get('all') === '1';
    }
    if (url.pathname === '/api/studio-tasks') {
        if (request.method !== 'GET') return true;
        return ['active', 'history', 'all', 'id'].some(key => url.searchParams.has(key));
    }
    return false;
}
