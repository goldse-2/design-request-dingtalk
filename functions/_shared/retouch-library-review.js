import { RECORD_RETENTION_SECONDS } from './studio-task-storage.js';

export const RETOUCH_LIBRARY_REVIEW_PREFIX = 'retouch-library-review:';

export async function enqueueRetouchLibraryReviews(env, task, resultKeys) {
    if (!isIndependentRetouchTask(task)) return [];

    const store = reviewStore(env);
    const results = (Array.isArray(resultKeys) ? resultKeys : [])
        .filter(item => item?.key && isImageResult(item));
    if (!results.length) return [];

    const createdAt = task.completedAt || new Date().toISOString();
    const stored = [];
    for (const result of results) {
        const id = await reviewId(task.id, result.key);
        const storageKey = RETOUCH_LIBRARY_REVIEW_PREFIX + id;
        const existing = await store.get(storageKey).catch(() => null);
        if (existing) {
            try {
                const parsed = JSON.parse(existing);
                if (parsed?.resolved === true) continue;
                if (parsed?.sourceKey) {
                    stored.push(parsed);
                    continue;
                }
            } catch {}
        }
        const sourceName = resultName(result);
        const baseName = sourceName.replace(/\.[^.]+$/, '').trim() || '精修图片';
        const review = {
            id,
            taskId: task.id,
            sourceKey: result.key,
            sourceName,
            submitterName: cleanText(task.submitter?.name || '未记录提交人', 40),
            suggestedProduct: cleanText(task.productName || baseName, 80),
            suggestedName: cleanText(/精修/.test(baseName) ? baseName : `${baseName}-精修`, 100),
            createdAt
        };
        const metadata = {
            kind: 'retouch-library-review',
            sourceKey: review.sourceKey,
            sourceName: cleanText(review.sourceName, 60),
            submitterName: cleanText(review.submitterName, 24),
            createdAt: review.createdAt
        };
        await store.put(storageKey, JSON.stringify(review), {
            expirationTtl: RECORD_RETENTION_SECONDS,
            metadata
        });
        stored.push(review);
    }
    return stored;
}

export async function listRetouchLibraryReviews(env) {
    const store = reviewStore(env);
    const listed = await store.list({ prefix: RETOUCH_LIBRARY_REVIEW_PREFIX, limit: 1000 });
    return (listed.keys || [])
        .map(key => reviewFromMetadata(key))
        .filter(Boolean)
        .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''));
}

export async function getRetouchLibraryReview(env, id) {
    const normalizedId = normalizeReviewId(id);
    if (!normalizedId) return null;
    const raw = await reviewStore(env).get(RETOUCH_LIBRARY_REVIEW_PREFIX + normalizedId);
    if (!raw) return null;
    try {
        const review = JSON.parse(raw);
        return review?.sourceKey ? { ...review, id: normalizedId } : null;
    } catch {
        return null;
    }
}

export async function resolveRetouchLibraryReview(env, id, decision) {
    const normalizedId = normalizeReviewId(id);
    if (!normalizedId) return false;
    const resolvedAt = new Date().toISOString();
    await reviewStore(env).put(RETOUCH_LIBRARY_REVIEW_PREFIX + normalizedId, JSON.stringify({
        id: normalizedId,
        resolved: true,
        decision: decision === 'approve' ? 'approve' : 'reject',
        resolvedAt
    }), {
        expirationTtl: RECORD_RETENTION_SECONDS,
        metadata: { kind: 'retouch-library-review-resolved', resolvedAt }
    });
    return true;
}

function reviewStore(env) {
    const store = env.STUDIO_TASKS || env.SUBMISSIONS;
    if (!store) throw new Error('Review storage not configured');
    return store;
}

function isIndependentRetouchTask(task) {
    return task?.kind === 'studio'
        && task.mode === 'retouch'
        && task.silent !== true
        && task.workflow?.type !== 'sheet_self';
}

function isImageResult(result) {
    return /\.(png|jpe?g|webp|gif)(?:$|\?)/i.test(`${result.name || ''} ${result.key || ''}`);
}

function resultName(result) {
    const direct = String(result.name || '').trim();
    if (direct) return cleanText(direct, 140);
    const lastPart = String(result.key || '').split('/').pop() || '精修图片.jpg';
    try { return cleanText(decodeURIComponent(lastPart), 140); }
    catch { return cleanText(lastPart, 140); }
}

function reviewFromMetadata(key) {
    const metadata = key?.metadata || {};
    if (metadata.kind !== 'retouch-library-review' || !metadata.sourceKey) return null;
    const sourceName = metadata.sourceName || resultName({ key: metadata.sourceKey });
    const baseName = sourceName.replace(/\.[^.]+$/, '').trim() || '精修图片';
    return {
        id: String(key.name || '').slice(RETOUCH_LIBRARY_REVIEW_PREFIX.length),
        sourceKey: metadata.sourceKey,
        sourceName,
        submitterName: metadata.submitterName || '未记录提交人',
        suggestedProduct: baseName,
        suggestedName: /精修/.test(baseName) ? baseName : `${baseName}-精修`,
        createdAt: metadata.createdAt || ''
    };
}

function normalizeReviewId(value) {
    const id = String(value || '').trim().toLowerCase();
    return /^[a-f0-9]{32}$/.test(id) ? id : '';
}

async function reviewId(taskId, sourceKey) {
    const bytes = new TextEncoder().encode(`${taskId}\0${sourceKey}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
}

function cleanText(value, maxLength) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}
