import { queueStudioRpaTask } from './studio-rpa-slot.js';
import { studioTaskPutOptions } from './studio-task-storage.js';

export async function startStudioPhotographyRetouchWorkflow(env, parent, sourceKeys) {
    if (!Array.isArray(sourceKeys) || sourceKeys.length < 1 || sourceKeys.length > 2) {
        throw new Error('请上传一张或两张拍摄图片');
    }

    const now = Date.now();
    const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const childIds = sourceKeys.map((_, index) => `${parent.id}-photo-${runId}-p${index + 1}-retouch`);
    const workflow = {
        runId,
        state: 'retouch',
        sourceCount: sourceKeys.length,
        childIds,
        completedCount: 0,
        startedAt: new Date(now).toISOString()
    };

    parent.photographySourceKeys = sourceKeys;
    parent.photographyRetouchEnabled = true;
    parent.photographyRetouchError = '';
    parent.photographyWorkflow = workflow;
    parent.status = 'photography_processing';
    parent.sentToRpa = false;
    parent.sentToRpaAt = '';
    parent.pausedAuto = false;
    parent.overdueNotified = false;
    parent.autoRpaLastError = '';
    await env.SUBMISSIONS.put(parent.id, JSON.stringify(parent), studioTaskPutOptions(parent));

    const children = sourceKeys.map((sourceKey, sourceIndex) => makeRetouchChild({
        parent,
        sourceKey,
        sourceIndex,
        runId,
        id: childIds[sourceIndex],
        timestamp: now + sourceIndex
    }));

    for (const child of children) {
        await env.SUBMISSIONS.put(child.id, JSON.stringify(child), studioTaskPutOptions(child));
        await queueStudioRpaTask(env, child.id);
    }

    return { parent, children, workflow };
}

export async function advanceStudioPhotographyWorkflow({ env, task }) {
    const workflow = task?.workflow;
    if (workflow?.type !== 'studio_photography' || workflow.stage !== 'retouch' || task.status !== 'done') {
        return { advanced: false };
    }

    const parentRaw = await env.SUBMISSIONS.get(workflow.parentId);
    if (!parentRaw) return { advanced: false, error: '原作图任务不存在' };

    const parent = JSON.parse(parentRaw);
    const parentWorkflow = parent.photographyWorkflow;
    if (!parentWorkflow || parentWorkflow.runId !== workflow.runId) {
        return { advanced: false, stale: true };
    }
    if (parentWorkflow.state === 'completed' || ['pending', 'processing', 'done'].includes(parent.status)) {
        return { advanced: false, duplicate: true };
    }
    if (parent.status === 'rejected') return { advanced: false, cancelled: true };

    try {
        const children = await readTasks(env, parentWorkflow.childIds || []);
        const completed = children.filter(child => child?.status === 'done' && child.resultKeys?.[0]?.key);
        parentWorkflow.completedCount = completed.length;

        if (completed.length !== Number(parentWorkflow.sourceCount || parentWorkflow.childIds?.length || 0)) {
            parent.status = 'photography_processing';
            parent.photographyWorkflow = parentWorkflow;
            await env.SUBMISSIONS.put(parent.id, JSON.stringify(parent), studioTaskPutOptions(parent));
            return { advanced: true, waiting: true, completedCount: completed.length };
        }

        const childByIndex = new Map(children.map(child => [Number(child.workflow?.sourceIndex || 0), child]));
        const retouchedKeys = [];
        for (let index = 0; index < parentWorkflow.sourceCount; index += 1) {
            const child = childByIndex.get(index);
            const result = child?.resultKeys?.[0];
            if (!result?.key) throw new Error(`第 ${index + 1} 张拍摄图片没有收到精修结果`);
            retouchedKeys.push({ ...result });
        }

        parent.productKeys = parent.mode === 'program' && retouchedKeys.length === 1
            ? [{ ...retouchedKeys[0] }, { ...retouchedKeys[0] }]
            : retouchedKeys;
        parent.photographyCompletedAt = new Date().toISOString();
        parent.photographyRetouchCompletedAt = parent.photographyCompletedAt;
        parent.photographyRetouchError = '';
        parent.photographyWorkflow = {
            ...parentWorkflow,
            state: 'completed',
            completedCount: retouchedKeys.length,
            completedAt: parent.photographyCompletedAt
        };
        parent.status = 'pending';
        parent.sentToRpa = false;
        parent.sentToRpaAt = '';
        parent.pausedAuto = false;
        parent.overdueNotified = false;
        parent.autoRpaLastError = '';

        await env.SUBMISSIONS.put(parent.id, JSON.stringify(parent), studioTaskPutOptions(parent));
        await queueStudioRpaTask(env, parent.id);
        return {
            advanced: true,
            waiting: false,
            queuedTaskId: parent.id,
            duplicatedPhoto: parent.mode === 'program' && retouchedKeys.length === 1
        };
    } catch (error) {
        await markStudioPhotographyWorkflowError(env, task, error);
        return { advanced: false, error: String(error?.message || error) };
    }
}

export async function markStudioPhotographyRetouchTimedOut(env, task) {
    if (task?.workflow?.type !== 'studio_photography') return { handled: false };

    task.overdueNotified = true;
    task.overdueNotifiedAt = new Date().toISOString();
    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
    await markStudioPhotographyWorkflowError(
        env,
        task,
        new Error('拍摄图片精修等待 30 分钟仍未收到结果，请重新上传后再试')
    );
    return { handled: true, exhausted: true };
}

async function markStudioPhotographyWorkflowError(env, childTask, error) {
    const workflow = childTask?.workflow;
    if (workflow?.type !== 'studio_photography') return;
    const raw = await env.SUBMISSIONS.get(workflow.parentId).catch(() => null);
    if (!raw) return;

    const parent = JSON.parse(raw);
    if (parent.photographyWorkflow?.runId !== workflow.runId) return;
    const errorText = String(error?.message || error).slice(0, 300);
    parent.status = 'waiting_photos';
    parent.photographyRetouchError = errorText;
    parent.photographyWorkflow = {
        ...parent.photographyWorkflow,
        state: 'error',
        failedAt: new Date().toISOString(),
        error: errorText
    };
    await env.SUBMISSIONS.put(parent.id, JSON.stringify(parent), studioTaskPutOptions(parent));
}

function makeRetouchChild({ parent, sourceKey, sourceIndex, runId, id, timestamp }) {
    return {
        id,
        kind: 'studio',
        mode: 'retouch',
        submitter: parent.submitter,
        category: '图片',
        desc: '',
        want: '',
        note: '',
        scene: '',
        analyzePrompt: '',
        size: '',
        imageName: `拍摄图片精修-${sourceIndex + 1}`,
        productName: parent.productName || parent.imageName || '-',
        title: '',
        subtitle: '',
        otherText: '',
        productKeys: [],
        refKeys: [sourceKey],
        modelKeys: [],
        resultKeys: [],
        silent: true,
        dingtalkNotified: true,
        r2AutoNotified: true,
        status: 'pending',
        sentToRpa: false,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        workflow: {
            type: 'studio_photography',
            parentId: parent.id,
            runId,
            sourceIndex,
            stage: 'retouch'
        }
    };
}

async function readTasks(env, ids) {
    const raws = await Promise.all((ids || []).map(id => env.SUBMISSIONS.get(id).catch(() => null)));
    return raws.map(raw => {
        try { return raw ? JSON.parse(raw) : null; }
        catch { return null; }
    }).filter(Boolean);
}
