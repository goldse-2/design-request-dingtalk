export async function onRequest(context) {
    
    try {
        const origin = new URL(context.request.url).origin;
        const rpaRes = await fetch(origin + '/api/studio-check-overdue?rpaOnly=1');
        const rpaData = await rpaRes.json();
        
        console.log('Auto-check triggered:', rpaData);
        
        return Response.json({
            ok: true,
            timestamp: new Date().toISOString(),
            result: rpaData
        });
    } catch (err) {
        console.error('Auto-check failed:', err);
        return Response.json({
            ok: false,
            error: err.message
        }, { status: 500 });
    }
}
