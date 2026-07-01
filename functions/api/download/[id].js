export async function onRequestGet(context) {
    const { params, env } = context;
    const id = params.id;

    if (!id || !env.SUBMISSIONS) {
        return new Response('Not found', { status: 404 });
    }

    const raw = await env.SUBMISSIONS.get(id);
    if (!raw) {
        return new Response('Submission not found', { status: 404 });
    }

    const submission = JSON.parse(raw);
    if (!submission.fileKey || !env.SUBMISSION_FILES) {
        return new Response('File not available', { status: 404 });
    }

    const obj = await env.SUBMISSION_FILES.get(submission.fileKey);
    if (!obj) {
        return new Response('File missing', { status: 404 });
    }

    const fileName = submission.fileName || 'submission.xlsx';
    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return new Response(obj.body, { headers });
}
