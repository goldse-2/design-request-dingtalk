export async function onRequestGet(context) {
    const { params, env } = context;
    const id = params.id;

    if (!env.SUBMISSION_FILES) {
        return new Response('Not configured', { status: 500 });
    }

    const key = `reject-images/${id}.jpg`;
    const obj = await env.SUBMISSION_FILES.get(key);
    if (!obj) {
        return new Response('Not found', { status: 404 });
    }

    return new Response(obj.body, {
        headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=86400'
        }
    });
}
