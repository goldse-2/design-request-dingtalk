import {
    getRetouchLibraryReview,
    listRetouchLibraryReviews,
    resolveRetouchLibraryReview
} from '../_shared/retouch-library-review.js';

export async function onRequestGet({ env }) {
    try {
        const reviews = await listRetouchLibraryReviews(env);
        return Response.json({ ok: true, reviews }, {
            headers: { 'Cache-Control': 'no-store' }
        });
    } catch (error) {
        return Response.json({ ok: false, error: error.message || '待审核图片加载失败' }, { status: 500 });
    }
}

export async function onRequestPost({ request, env }) {
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

    const id = String(body.id || '').trim();
    const decision = String(body.decision || '').trim();
    if (!id || !['approve', 'reject'].includes(decision)) {
        return Response.json({ ok: false, error: '审核参数不完整' }, { status: 400 });
    }

    try {
        const review = await getRetouchLibraryReview(env, id);
        if (!review) return Response.json({ ok: false, error: '这张图片已处理或记录已过期' }, { status: 404 });

        if (decision === 'reject') {
            await resolveRetouchLibraryReview(env, id, decision);
            return Response.json({ ok: true, decision, id });
        }

        if (!env.SUBMISSION_FILES) {
            return Response.json({ ok: false, error: '图片存储未配置' }, { status: 500 });
        }
        const category = cleanPathPart(body.category, '分类', 60);
        const product = cleanPathPart(body.product, '产品名称', 80);
        const source = await env.SUBMISSION_FILES.get(review.sourceKey);
        if (!source) {
            return Response.json({ ok: false, error: '精修成品已不存在，无法收录' }, { status: 410 });
        }

        const extension = imageExtension(source.httpMetadata?.contentType, review.sourceName || review.sourceKey);
        const fileName = normalizeImageName(body.fileName, extension);
        const targetKey = `library/${encodeURIComponent(category)}/${encodeURIComponent(product)}/${encodeURIComponent(fileName)}`;
        const existing = await env.SUBMISSION_FILES.head(targetKey);
        if (existing) {
            if (existing.customMetadata?.retouchReviewId === id) {
                await resolveRetouchLibraryReview(env, id, decision);
                return Response.json({
                    ok: true,
                    decision,
                    id,
                    duplicate: true,
                    file: { key: targetKey, name: fileName, category, product }
                });
            }
            return Response.json({ ok: false, error: '资料库中已有同名图片，请换一个名称' }, { status: 409 });
        }

        await env.SUBMISSION_FILES.put(targetKey, source.body, {
            httpMetadata: source.httpMetadata || { contentType: contentTypeForExtension(extension) },
            customMetadata: {
                ...(source.customMetadata || {}),
                retouchReviewId: id,
                retouchSourceKey: review.sourceKey
            }
        });
        await resolveRetouchLibraryReview(env, id, decision);
        return Response.json({
            ok: true,
            decision,
            id,
            file: { key: targetKey, name: fileName, category, product }
        });
    } catch (error) {
        const status = Number(error.status) || 500;
        return Response.json({ ok: false, error: error.message || '审核操作失败' }, { status });
    }
}

function cleanPathPart(value, label, maxLength) {
    const cleaned = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!cleaned) throw requestError(`请填写${label}`);
    if (/[\\/]/.test(cleaned) || cleaned === '.' || cleaned === '..') {
        throw requestError(`${label}不能包含斜杠`);
    }
    if (cleaned.length > maxLength) throw requestError(`${label}不能超过 ${maxLength} 个字`);
    return cleaned;
}

function normalizeImageName(value, extension) {
    const requested = cleanPathPart(value, '图片名称', 120);
    const baseName = requested
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '_')
        .trim();
    if (!baseName) throw requestError('请填写有效的图片名称');
    return `${baseName}.${extension}`;
}

function imageExtension(contentType, sourceName) {
    const mime = String(contentType || '').toLowerCase();
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    const match = String(sourceName || '').match(/\.(png|jpe?g|webp|gif)(?:$|\?)/i);
    if (!match) return 'jpg';
    return match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
}

function contentTypeForExtension(extension) {
    return {
        jpg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif'
    }[extension] || 'application/octet-stream';
}

function requestError(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}
