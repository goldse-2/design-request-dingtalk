export async function onRequestGet(context) {
    const { env } = context;
    if (!env.SUBMISSIONS) return Response.json({ ts: '0' });
    const ts = await env.SUBMISSIONS.get('__lastUpdated') || '0';
    return Response.json({ ts }, {
        headers: { 'Cache-Control': 'no-cache, no-store' }
    });
}
