export async function onRequest(context) {
    const { env } = context;
    
    try {
        const checkUrl = 'https://design-request-dingtalk.pages.dev/api/studio-check-overdue?rpaOnly=1';
        const res = await fetch(checkUrl);
        const data = await res.json();
        
        console.log('Auto-check triggered:', data);
        
        return Response.json({
            ok: true,
            timestamp: new Date().toISOString(),
            result: data
        });
    } catch (err) {
        console.error('Auto-check failed:', err);
        return Response.json({
            ok: false,
            error: err.message
        }, { status: 500 });
    }
}
