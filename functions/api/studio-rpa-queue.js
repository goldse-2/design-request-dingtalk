import {
    STUDIO_RPA_ACTIVE_KEY,
    STUDIO_RPA_QUEUE_KEY,
    studioRpaModeMinutes
} from '../_shared/studio-rpa-slot.js';
import { wakeStudioRpaQueue } from '../_shared/studio-rpa-wakeup.js';
import { studioTaskPutOptions } from '../_shared/studio-task-storage.js';

const STUDIO_RPA_PAUSED_QUEUE_KEY = 'studio:rpaPausedQueue:v1';
const MAX_VISIBLE_TASKS = 80;
const RPA_MODES = new Set(['free', 'program', 'retouch', 'cutout']);

export async function onRequestGet(context) {
    const { env } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    try {
        const [slotRaw, queueRaw, pausedRaw] = await Promise.all([
            env.SUBMISSIONS.get(STUDIO_RPA_ACTIVE_KEY).catch(() => null),
            env.SUBMISSIONS.get(STUDIO_RPA_QUEUE_KEY).catch(() => null),
            env.SUBMISSIONS.get(STUDIO_RPA_PAUSED_QUEUE_KEY).catch(() => null)
        ]);
        const slot = parseObject(slotRaw);
        const queueIds = parseQueue(queueRaw);
        const pausedIds = parseQueue(pausedRaw);
        const taskIds = unique([slot?.taskId, ...queueIds, ...pausedIds].filter(Boolean)).slice(0, MAX_VISIBLE_TASKS);
        const tasks = await Promise.all(taskIds.map(id => readTask(env.SUBMISSIONS, id)));
        const taskById = new Map(tasks.filter(Boolean).map(task => [task.id, task]));
        const activeTask = slot?.taskId ? taskById.get(slot.taskId) : null;
        const active = activeTask ? summarizeTask(activeTask, 'active', 0) : null;
        if (active) {
            active.slotAcquiredAt = slot?.acquiredAt || '';
            active.possiblyStuck = taskPossiblyStuck(activeTask);
        }

        const waiting = [];
        const paused = [];
        for (const id of queueIds) {
            if (!id || id === activeTask?.id) continue;
            const task = taskById.get(id);
            if (!isPendingRpaTask(task)) continue;
            if (task.pausedAuto === true) paused.push(summarizeTask(task, 'paused', paused.length + 1));
            else waiting.push(summarizeTask(task, 'waiting', waiting.length + 1));
        }
        for (const id of pausedIds) {
            if (!id || id === activeTask?.id || paused.some(task => task.id === id)) continue;
            const task = taskById.get(id);
            if (!isPendingRpaTask(task)) continue;
            paused.push(summarizeTask(task, 'paused', paused.length + 1));
        }

        return Response.json({
            ok: true,
            active,
            waiting,
            paused,
            counts: { active: active ? 1 : 0, waiting: waiting.length, paused: paused.length },
            truncated: unique([slot?.taskId, ...queueIds, ...pausedIds].filter(Boolean)).length > MAX_VISIBLE_TASKS,
            fetchedAt: new Date().toISOString()
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
}

export async function onRequestPatch(context) {
    const { request, env, waitUntil } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

    const taskId = String(body.taskId || '').trim();
    const action = String(body.action || '').trim();
    if (!taskId || !['pause', 'resume', 'prioritize'].includes(action)) {
        return Response.json({ ok: false, error: 'Missing taskId or unsupported action' }, { status: 400 });
    }

    try {
        const [taskRaw, queueRaw, pausedRaw] = await Promise.all([
            env.SUBMISSIONS.get(taskId),
            env.SUBMISSIONS.get(STUDIO_RPA_QUEUE_KEY).catch(() => null),
            env.SUBMISSIONS.get(STUDIO_RPA_PAUSED_QUEUE_KEY).catch(() => null)
        ]);
        if (!taskRaw) return Response.json({ ok: false, error: 'Task not found' }, { status: 404 });

        const task = JSON.parse(taskRaw);
        if (task.kind !== 'studio') {
            return Response.json({ ok: false, error: 'Not a studio task' }, { status: 400 });
        }
        if (task.status === 'processing' || task.sentToRpa === true) {
            return Response.json({ ok: false, error: '任务已经在 RPA 电脑执行，不能中途暂停或重新排序' }, { status: 409 });
        }
        if (!isPendingRpaTask(task)) {
            return Response.json({ ok: false, error: '只有等待发送的任务可以调整队列' }, { status: 409 });
        }

        let queueIds = parseQueue(queueRaw).filter(id => id !== taskId);
        let pausedIds = parseQueue(pausedRaw).filter(id => id !== taskId);
        const now = new Date().toISOString();

        if (action === 'pause') {
            task.pausedAuto = true;
            task.rpaQueuePausedAt = now;
            task.rpaQueuePriorityAt = '';
            pausedIds.push(taskId);
        } else if (action === 'resume') {
            task.pausedAuto = false;
            task.rpaQueuePausedAt = '';
            task.rpaQueuePriorityAt = '';
            queueIds.push(taskId);
        } else {
            task.pausedAuto = false;
            task.rpaQueuePausedAt = '';
            task.rpaQueuePriorityAt = now;
            queueIds.unshift(taskId);
        }

        queueIds = unique(queueIds).slice(0, 500);
        pausedIds = unique(pausedIds).slice(-500);
        await Promise.all([
            env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task)),
            env.SUBMISSIONS.put(STUDIO_RPA_QUEUE_KEY, JSON.stringify(queueIds)),
            env.SUBMISSIONS.put(STUDIO_RPA_PAUSED_QUEUE_KEY, JSON.stringify(pausedIds))
        ]);

        if (action !== 'pause') wakeStudioRpaQueue(request, waitUntil);
        return Response.json({ ok: true, action, task: summarizeTask(task, action === 'pause' ? 'paused' : 'waiting', 0) });
    } catch (error) {
        return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
}

function summarizeTask(task, queueState, position) {
    const sentAt = task.sentToRpaAt || '';
    const startedAt = sentAt || task.createdAt || '';
    const elapsedMinutes = startedAt
        ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000))
        : 0;
    return {
        id: task.id,
        mode: task.mode || '',
        modeText: studioModeText(task.mode),
        title: taskTitle(task),
        submitterName: task.submitter?.name || '匿名用户',
        status: task.status || '',
        queueState,
        position,
        pausedAuto: task.pausedAuto === true,
        priority: Boolean(task.rpaQueuePriorityAt),
        createdAt: task.createdAt || '',
        sentToRpaAt: sentAt,
        elapsedMinutes,
        expectedMinutes: studioRpaModeMinutes(task.mode),
        workflowType: task.workflow?.type || '',
        workflowStage: task.workflow?.stage || '',
        parentId: task.workflow?.parentId || '',
        slotIndex: Number.isInteger(task.workflow?.slotIndex) ? task.workflow.slotIndex : null
    };
}

function taskTitle(task) {
    if (task.workflow?.type === 'sheet_self') {
        const slot = Number.isInteger(task.workflow?.slotIndex) ? `第 ${task.workflow.slotIndex + 1} 张` : '图片位';
        return `${task.productName || '表格自助'} · ${slot}`;
    }
    if (task.workflow?.type === 'studio_photography') return task.productName || '图片拍摄';
    return task.imageName || task.productName || task.submitter?.name || '未命名任务';
}

function studioModeText(mode) {
    if (mode === 'free') return '自由模式';
    if (mode === 'program') return '图生图';
    if (mode === 'retouch') return '精修图片';
    if (mode === 'cutout') return '白底抠图';
    return mode || '作图任务';
}

function taskPossiblyStuck(task) {
    if (task.status !== 'processing' || task.sentToRpa !== true || !task.sentToRpaAt) return false;
    const elapsed = Date.now() - new Date(task.sentToRpaAt).getTime();
    const threshold = task.mode === 'retouch' ? 30 * 60 * 1000 : 10 * 60 * 1000;
    return Number.isFinite(elapsed) && elapsed >= threshold;
}

function isPendingRpaTask(task) {
    return Boolean(task
        && task.kind === 'studio'
        && RPA_MODES.has(task.mode)
        && task.status === 'pending'
        && task.sentToRpa !== true);
}

async function readTask(kv, id) {
    const raw = await kv.get(id).catch(() => null);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function parseQueue(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? unique(parsed.filter(Boolean)) : [];
    } catch {
        return [];
    }
}

function parseObject(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function unique(values) {
    return [...new Set(values)];
}
