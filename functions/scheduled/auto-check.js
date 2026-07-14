export async function onRequest(context) {
    
    try {
        const origin = new URL(context.request.url).origin;
        const rpaRes = await fetch(origin + '/api/studio-check-overdue?rpaOnly=1');
        const rpaData = await rpaRes.json();
        const imageRes = await fetch(origin + '/api/studio-check-overdue?imageOnly=1');
        const imageData = await imageRes.json();
        
        console.log('Auto-check triggered:', { rpa: rpaData, image: imageData });
        
        return Response.json({
            ok: true,
            timestamp: new Date().toISOString(),
            result: rpaData,
            imageResult: imageData
        });
    } catch (err) {
        console.error('Auto-check failed:', err);
        return Response.json({
            ok: false,
            error: err.message
        }, { status: 500 });
    }
}
