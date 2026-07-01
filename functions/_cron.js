export async function onRequest(context) {
    const { env, request } = context;
    
    const authHeader = request.headers.get('X-Cron-Secret');
    const expectedSecret = env.CRON_SECRET || 'default-secret-change-me';
    
    if (authHeader !== expectedSecret) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const origin = new URL(request.url).origin;
        const checkUrl = origin + '/api/studio-check-overdue';
        
        const res = await fetch(checkUrl);
        const data = await res.json();
        
        return Response.json({
            ok: true,
            timestamp: new Date().toISOString(),
            checkResult: data
        });
    } catch (err) {
        return Response.json({
            ok: false,
            error: err.message
        }, { status: 500 });
    }
}
