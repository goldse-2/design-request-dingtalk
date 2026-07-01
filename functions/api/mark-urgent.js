export async function onRequestPost(context) {
    const { request, env } = context;
    let body;
    try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
    const { submissionId } = body;
    if (!submissionId) return Response.json({ ok: false, error: 'Missing submissionId' }, { status: 400 });
    if (!env.SUBMISSIONS) return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    try {
        const raw = await env.SUBMISSIONS.get(submissionId);
        if (!raw) return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
        const submission = JSON.parse(raw);
        submission.priority = 1;
        await env.SUBMISSIONS.put(submissionId, JSON.stringify(submission), { metadata: { taskType: submission.taskType, timestamp: submission.timestamp } });
        return Response.json({ ok: true });
    } catch (err) { return Response.json({ ok: false, error: err.message }, { status: 500 }); }
}
