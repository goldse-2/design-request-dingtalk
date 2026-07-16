import { onRequestPost as submitStudioRequest } from './studio-submit.js';

export async function onRequestPost(context) {
    const { request, env } = context;
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

    const productName = String(body.productName || '').trim();
    const category = String(body.category || '').trim();
    const files = Array.isArray(body.files) ? body.files.slice(0, 20).filter(validLibraryImage) : [];
    if (!productName || !files.length) {
        return Response.json({ ok: false, error: '缺少产品名称或图片' }, { status: 400 });
    }

    const submitter = validSubmitter(body.submitter)
        ? body.submitter
        : env.ADMIN_UNION_ID
            ? { name: '资料库管理员', unionId: env.ADMIN_UNION_ID }
            : null;
    if (!submitter) {
        return Response.json({ ok: false, error: '请先在图片制作页面登录一次，再返回管理台操作' }, { status: 400 });
    }

    const tasks = [];
    const failures = [];
    for (const file of files) {
        const studioRequest = new Request(new URL('/api/studio-submit', request.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: 'cutout',
                submitter,
                category: '资料库自动去除背景',
                note: `资料库：${category || '未分类'}/${productName}`,
                productName,
                imageName: file.name,
                productKeys: [],
                refKeys: [{ key: file.key, name: file.name }],
                modelKeys: [],
                cutoutOutputFormat: 'png'
            })
        });
        try {
            const response = await submitStudioRequest({ ...context, request: studioRequest });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `提交失败 (${response.status})`);
            tasks.push({ file: file.name, id: result.id, autoSent: result.autoSent === true });
        } catch (error) {
            failures.push({ file: file.name, error: error.message || String(error) });
        }
    }

    if (!tasks.length) {
        return Response.json({ ok: false, error: failures[0]?.error || '提交失败', failures }, { status: 502 });
    }
    return Response.json({ ok: true, tasks, failures });
}

function validLibraryImage(file) {
    return file
        && typeof file.key === 'string'
        && file.key.startsWith('library/')
        && typeof file.name === 'string'
        && /\.(png|jpe?g|webp)$/i.test(file.name);
}

function validSubmitter(submitter) {
    return submitter && typeof submitter === 'object' && typeof submitter.unionId === 'string' && submitter.unionId.trim();
}
