export async function onRequest(context) {
    const { env, request } = context;
    
    const authHeader = request.headers.get('X-Cron-Secret');
    const expectedSecret = env.CRON_SECRET || 'default-secret-change-me';
    
    if (authHeader !== expectedSecret) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const origin = new URL(request.url).origin;
        const rpaRes = await fetch(origin + '/api/studio-check-overdue?rpaOnly=1');
        const rpaData = await rpaRes.json();
        
        return Response.json({
            ok: true,
            timestamp: new Date().toISOString(),
            checkResult: rpaData
        });
    } catch (err) {
        return Response.json({
            ok: false,
            error: err.message
        }, { status: 500 });
    }
}
