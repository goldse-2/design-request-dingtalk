export const STUDIO_RPA_ACTIVE_KEY = 'studio:rpaActive:v1';
export const STUDIO_RPA_QUEUE_KEY = 'studio:rpaQueue:v2';
export const STUDIO_PROCESSING_QUEUE_KEY = 'studio:processingQueue:v2';

export async function ensureStudioRpaSlot(env, processingQueueIds = null) {
    const kv = env?.SUBMISSIONS;
    if (!kv) throw new Error('KV not configured');

    const current = parseSlot(await kv.get(STUDIO_RPA_ACTIVE_KEY).catch(() => null));
    if (current?.taskId) {
        const task = await readTask(kv, current.taskId);
        if (taskHoldsRpaSlot(task)) {
            return { busy: true, taskId: current.taskId, slot: current, recovered: false };
        }
    }

    // An explicit idle marker means the old processing queue has already been reconciled.
    if (current?.state === 'idle') {
        return { busy: false, taskId: '', slot: current, recovered: false };
    }

    const ids = Array.isArray(processingQueueIds)
        ? processingQueueIds
        : await readQueue(kv, STUDIO_PROCESSING_QUEUE_KEY);
    const tasks = await Promise.all(ids.slice(0, 50).map(id => readTask(kv, id)));
    const existing = tasks
        .filter(taskHoldsRpaSlot)
        .sort((left, right) => sentTimestamp(left) - sentTimestamp(right))[0];

    if (!existing) {
        await writeIdleSlot(kv);
        return { busy: false, taskId: '', slot: null, recovered: false };
    }

    const slot = makeBusySlot(existing.id, 'recovered');
    await kv.put(STUDIO_RPA_ACTIVE_KEY, JSON.stringify(slot));
    return { busy: true, taskId: existing.id, slot, recovered: true };
}

export async function acquireStudioRpaSlot(env, taskId, processingQueueIds = null) {
    const id = String(taskId || '').trim();
    if (!id) throw new Error('Missing task ID');

    const current = await ensureStudioRpaSlot(env, processingQueueIds);
    if (current.busy) {
        return {
            acquired: current.taskId === id,
            alreadyOwned: current.taskId === id,
            busyTaskId: current.taskId
        };
    }

    const slot = makeBusySlot(id, 'dispatch');
    await env.SUBMISSIONS.put(STUDIO_RPA_ACTIVE_KEY, JSON.stringify(slot));
    return { acquired: true, alreadyOwned: false, busyTaskId: '', slot };
}

export async function releaseStudioRpaSlot(env, taskId) {
    const kv = env?.SUBMISSIONS;
    if (!kv) return { released: false };

    const id = String(taskId || '').trim();
    const current = parseSlot(await kv.get(STUDIO_RPA_ACTIVE_KEY).catch(() => null));
    if (current?.taskId && current.taskId !== id) {
        return { released: false, busyTaskId: current.taskId };
    }

    await writeIdleSlot(kv, id, true);
    return { released: true, busyTaskId: '' };
}

export async function queueStudioRpaTask(env, taskId) {
    const kv = env?.SUBMISSIONS;
    if (!kv) throw new Error('KV not configured');

    const id = String(taskId || '').trim();
    if (!id) throw new Error('Missing task ID');
    const ids = await readQueue(kv, STUDIO_RPA_QUEUE_KEY);
    if (!ids.includes(id)) ids.push(id);
    const limited = ids.slice(-500);
    await kv.put(STUDIO_RPA_QUEUE_KEY, JSON.stringify(limited));
    return { queued: true, position: limited.indexOf(id) + 1 };
}

function taskHoldsRpaSlot(task) {
    return Boolean(task
        && task.kind === 'studio'
        && task.status === 'processing'
        && task.sentToRpa === true
        && task.overdueNotified !== true);
}

function sentTimestamp(task) {
    const value = new Date(task?.sentToRpaAt || task?.createdAt || 0).getTime();
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function makeBusySlot(taskId, source) {
    const now = new Date().toISOString();
    return { state: 'busy', taskId, acquiredAt: now, updatedAt: now, source };
}

async function writeIdleSlot(kv, releasedTaskId = '', reconcile = false) {
    await kv.put(STUDIO_RPA_ACTIVE_KEY, JSON.stringify({
        state: reconcile ? 'reconcile' : 'idle',
        taskId: '',
        releasedTaskId,
        updatedAt: new Date().toISOString()
    }));
}

async function readTask(kv, id) {
    const raw = await kv.get(id).catch(() => null);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

async function readQueue(kv, key) {
    const raw = await kv.get(key).catch(() => null);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? [...new Set(parsed.filter(Boolean))] : [];
    } catch {
        return [];
    }
}

function parseSlot(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}
