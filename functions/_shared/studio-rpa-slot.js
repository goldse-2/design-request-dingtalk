export const STUDIO_RPA_ACTIVE_KEY = 'studio:rpaActive:v1';
export const STUDIO_RPA_QUEUE_KEY = 'studio:rpaQueue:v2';
export const STUDIO_PROCESSING_QUEUE_KEY = 'studio:processingQueue:v2';
export const STUDIO_RPA_GLOBAL_PAUSE_KEY = 'studio:rpaGlobalPause:v1';
const STUDIO_RPA_DISPATCH_LEASE_MS = 30 * 1000;

export async function getStudioRpaGlobalPause(env) {
    const kv = env?.SUBMISSIONS;
    if (!kv) throw new Error('KV not configured');

    const raw = await kv.get(STUDIO_RPA_GLOBAL_PAUSE_KEY).catch(() => null);
    if (!raw) return { paused: false, updatedAt: '' };
    try {
        const state = JSON.parse(raw);
        return {
            paused: state?.paused === true,
            updatedAt: String(state?.updatedAt || '')
        };
    } catch {
        return { paused: raw === 'true', updatedAt: '' };
    }
}

export async function setStudioRpaGlobalPause(env, paused) {
    const kv = env?.SUBMISSIONS;
    if (!kv) throw new Error('KV not configured');

    const state = {
        paused: paused === true,
        updatedAt: new Date().toISOString()
    };
    await kv.put(STUDIO_RPA_GLOBAL_PAUSE_KEY, JSON.stringify(state));
    return state;
}

export async function ensureStudioRpaSlot(env, processingQueueIds = null) {
    const kv = env?.SUBMISSIONS;
    if (!kv) throw new Error('KV not configured');

    const current = parseSlot(await kv.get(STUDIO_RPA_ACTIVE_KEY).catch(() => null));
    if (current?.taskId) {
        if (dispatchLeaseActive(current)) {
            return { busy: true, taskId: current.taskId, slot: current, recovered: false };
        }
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

    const globalPause = await getStudioRpaGlobalPause(env);
    if (globalPause.paused) {
        return {
            acquired: false,
            alreadyOwned: false,
            busyTaskId: '',
            globallyPaused: true
        };
    }

    const current = await ensureStudioRpaSlot(env, processingQueueIds);
    if (current.busy) {
        return {
            acquired: false,
            alreadyOwned: current.taskId === id,
            busyTaskId: current.taskId
        };
    }

    const claimToken = crypto.randomUUID();
    const slot = makeBusySlot(id, 'dispatch', claimToken);
    await env.SUBMISSIONS.put(STUDIO_RPA_ACTIVE_KEY, JSON.stringify(slot));
    await new Promise(resolve => setTimeout(resolve, 100));
    const confirmed = parseSlot(await env.SUBMISSIONS.get(STUDIO_RPA_ACTIVE_KEY).catch(() => null));
    if (confirmed?.claimToken !== claimToken) {
        return {
            acquired: false,
            alreadyOwned: confirmed?.taskId === id,
            busyTaskId: confirmed?.taskId || ''
        };
    }
    return { acquired: true, alreadyOwned: false, busyTaskId: '', slot: confirmed };
}

export async function claimStudioRpaRetrySlot(env, taskId) {
    const kv = env?.SUBMISSIONS;
    if (!kv) throw new Error('KV not configured');

    const id = String(taskId || '').trim();
    if (!id) throw new Error('Missing task ID');
    const globalPause = await getStudioRpaGlobalPause(env);
    if (globalPause.paused) return { claimed: false, globallyPaused: true };

    const current = parseSlot(await kv.get(STUDIO_RPA_ACTIVE_KEY).catch(() => null));
    if (current?.taskId !== id) {
        return { claimed: false, busyTaskId: current?.taskId || '' };
    }
    if (dispatchLeaseActive(current)) {
        return { claimed: false, busyTaskId: current.taskId, retryInProgress: true };
    }

    const claimToken = crypto.randomUUID();
    const slot = makeBusySlot(id, 'retry', claimToken);
    await kv.put(STUDIO_RPA_ACTIVE_KEY, JSON.stringify(slot));
    await new Promise(resolve => setTimeout(resolve, 100));
    const confirmed = parseSlot(await kv.get(STUDIO_RPA_ACTIVE_KEY).catch(() => null));
    if (confirmed?.claimToken !== claimToken) {
        return { claimed: false, busyTaskId: confirmed?.taskId || '' };
    }
    return { claimed: true, slot: confirmed };
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
    return { queued: true, position: limited.indexOf(id) + 1, queueIds: limited };
}

export async function getStudioRpaQueueInfo(env, task, queueIds = null) {
    const kv = env?.SUBMISSIONS;
    if (!kv || !task?.id) return emptyQueueInfo(task?.mode);

    const ids = Array.isArray(queueIds) ? queueIds : await readQueue(kv, STUDIO_RPA_QUEUE_KEY);
    const currentIndex = ids.indexOf(task.id);
    const queuedAheadIds = (currentIndex >= 0 ? ids.slice(0, currentIndex) : ids)
        .filter(id => id && id !== task.id);
    const activeSlot = parseSlot(await kv.get(STUDIO_RPA_ACTIVE_KEY).catch(() => null));
    const activeTaskId = activeSlot?.taskId && activeSlot.taskId !== task.id ? activeSlot.taskId : '';
    const taskIds = [...new Set([activeTaskId, ...queuedAheadIds].filter(Boolean))];
    const tasks = await Promise.all(taskIds.map(id => readTask(kv, id)));
    const taskById = new Map(tasks.filter(Boolean).map(item => [item.id, item]));
    const ahead = [];

    if (activeTaskId) {
        const activeTask = taskById.get(activeTaskId);
        if (taskHoldsRpaSlot(activeTask)) {
            ahead.push({
                id: activeTaskId,
                mode: activeTask.mode || '',
                minutes: remainingActiveMinutes(activeTask)
            });
        }
    }

    for (const id of queuedAheadIds) {
        if (id === activeTaskId) continue;
        const queuedTask = taskById.get(id);
        if (!queuedTask || queuedTask.status !== 'pending' || queuedTask.sentToRpa === true) continue;
        ahead.push({ id, mode: queuedTask.mode || '', minutes: studioRpaModeMinutes(queuedTask.mode) });
    }

    const waitMinutes = ahead.reduce((total, item) => total + item.minutes, 0);
    const ownMinutes = studioRpaModeMinutes(task.mode);
    return {
        aheadCount: ahead.length,
        queuePosition: ahead.length + 1,
        waitMinutes,
        ownMinutes,
        completionMinutes: waitMinutes + ownMinutes
    };
}

export function studioRpaModeMinutes(mode) {
    if (mode === 'free') return 8;
    if (mode === 'program') return 15;
    if (mode === 'retouch') return 20;
    if (mode === 'cutout') return 8;
    return 10;
}

export function studioRpaTimeoutMinutes(task) {
    if (task?.workflow?.type === 'sheet_self') return 20;
    if (task?.mode === 'free') return 15;
    if (task?.mode === 'program') return 20;
    if (task?.mode === 'retouch') return 30;
    return 10;
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

function remainingActiveMinutes(task) {
    const duration = studioRpaModeMinutes(task?.mode);
    const sentAt = new Date(task?.sentToRpaAt || 0).getTime();
    if (!Number.isFinite(sentAt) || sentAt <= 0) return duration;
    const elapsed = Math.max(0, Math.floor((Date.now() - sentAt) / 60000));
    return Math.max(1, duration - elapsed);
}

function emptyQueueInfo(mode) {
    const ownMinutes = studioRpaModeMinutes(mode);
    return { aheadCount: 0, queuePosition: 1, waitMinutes: 0, ownMinutes, completionMinutes: ownMinutes };
}

function makeBusySlot(taskId, source, claimToken = '') {
    const now = new Date().toISOString();
    return {
        state: 'busy',
        taskId,
        acquiredAt: now,
        updatedAt: now,
        source,
        claimToken,
        leaseUntil: ['dispatch', 'retry'].includes(source) ? new Date(Date.now() + STUDIO_RPA_DISPATCH_LEASE_MS).toISOString() : ''
    };
}

function dispatchLeaseActive(slot, now = Date.now()) {
    if (!['dispatch', 'retry'].includes(slot?.source)) return false;
    const leaseUntil = Date.parse(slot.leaseUntil || '');
    return Number.isFinite(leaseUntil) && leaseUntil > now;
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
