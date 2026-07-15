import {
    RECORD_RETENTION_MS,
    RECORD_RETENTION_SECONDS,
    studioTaskPutOptions,
    studioTaskRetentionAnchor
} from '../_shared/studio-task-storage.js';

const MIGRATION_BATCH_SIZE = 5;

export async function onRequestPost({ request, env }) {
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const cursor = typeof body.cursor === 'string' ? body.cursor : undefined;
    const now = Date.now();
    const cutoff = now - RECORD_RETENTION_MS;
    let historyKeyNames;
    let pageComplete;
    let nextPageCursor;

    if (Array.isArray(body.keys)) {
        historyKeyNames = body.keys.filter(name => typeof name === 'string');
        pageComplete = body.pageComplete === true;
        nextPageCursor = cursor || '';
    } else {
        const listed = await env.SUBMISSIONS.list({ limit: 1000, cursor });
        historyKeyNames = listed.keys.filter(key => {
            const metadata = key.metadata || {};
            return (metadata.kind === 'studio'
                    && (metadata.status === 'done' || metadata.status === 'rejected'))
                || metadata.archived === true;
        }).map(key => key.name);
        pageComplete = listed.list_complete;
        nextPageCursor = listed.cursor || '';
    }

    const batch = historyKeyNames.slice(0, MIGRATION_BATCH_SIZE);
    const stats = { scanned: 0, expiredRecords: 0, migratedRecords: 0, deletedFiles: 0 };

    for (const keyName of batch) {
        const stored = await env.SUBMISSIONS.getWithMetadata(keyName);
        const raw = stored?.value;
        const metadata = stored?.metadata || {};
        const isStudioHistory = metadata.kind === 'studio'
            && (metadata.status === 'done' || metadata.status === 'rejected');
        const isSubmissionHistory = metadata.archived === true;
        if (!isStudioHistory && !isSubmissionHistory) continue;

        if (!raw) continue;
        let record;
        try { record = JSON.parse(raw); } catch { continue; }
        stats.scanned += 1;

        const anchor = isStudioHistory
            ? studioTaskRetentionAnchor(record, Number(metadata.timestamp || 0))
            : Number(record.archivedAt || metadata.archivedAt || record.timestamp || metadata.timestamp || 0);

        if (anchor > 0 && anchor < cutoff) {
            stats.deletedFiles += await deleteRecordFiles(env.SUBMISSION_FILES, record, isStudioHistory);
            await env.SUBMISSIONS.delete(keyName);
            stats.expiredRecords += 1;
            continue;
        }

        if (isStudioHistory) {
            await env.SUBMISSIONS.put(keyName, raw, studioTaskPutOptions(record, now));
        } else {
            const expiration = Math.max(
                Math.floor(now / 1000) + 60,
                Math.floor(anchor / 1000) + RECORD_RETENTION_SECONDS
            );
            await env.SUBMISSIONS.put(keyName, raw, {
                metadata: {
                    taskType: record.taskType,
                    timestamp: record.timestamp,
                    archived: true,
                    archivedAt: record.archivedAt || metadata.archivedAt || anchor
                },
                expiration
            });
        }
        stats.migratedRecords += 1;
    }

    const remainingKeys = historyKeyNames.slice(batch.length);
    const done = remainingKeys.length === 0 && pageComplete;

    return Response.json({
        ok: true,
        retentionDays: 20,
        ...stats,
        done,
        nextCursor: nextPageCursor,
        pageComplete,
        keys: remainingKeys
    });
}

async function deleteRecordFiles(bucket, record, isStudio) {
    if (!bucket) return 0;
    const keys = isStudio ? studioObjectKeys(record) : submissionObjectKeys(record);
    const prefixes = isStudio
        ? [`studio/${record.id}/`, `studio-results/${record.id}/`]
        : [`reject-images/${record.id}-`, `complete-images/${record.id}-`, `feedback-images/${record.id}-`];

    for (const prefix of prefixes) {
        let cursor;
        do {
            const page = await bucket.list({ prefix, cursor, limit: 1000 });
            for (const object of page.objects || []) keys.add(object.key);
            cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
    }

    const deletable = [...keys].filter(key => key
        && !key.startsWith('library/')
        && !key.startsWith('studio-examples/'));
    if (deletable.length) await bucket.delete(deletable);
    return deletable.length;
}

function studioObjectKeys(task) {
    const keys = new Set();
    for (const field of ['productKeys', 'refKeys', 'modelKeys', 'resultKeys']) {
        for (const item of Array.isArray(task[field]) ? task[field] : []) {
            if (item?.key) keys.add(item.key);
        }
    }
    return keys;
}

function submissionObjectKeys(submission) {
    const keys = new Set();
    if (submission.fileKey) keys.add(submission.fileKey);
    for (const item of Array.isArray(submission.data?.directPhotoKeys) ? submission.data.directPhotoKeys : []) {
        if (item?.key) keys.add(item.key);
    }
    for (const item of Array.isArray(submission.data?.images) ? submission.data.images : []) {
        if (item?.photoKey) keys.add(item.photoKey);
    }
    return keys;
}
