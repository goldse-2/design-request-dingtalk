import { dispatchStudioTaskToRpa } from '../api/studio-webhook.js';
import { sendStudioResultImages } from './studio-dingtalk.js';
import { acquireStudioRpaSlot, queueStudioRpaTask, releaseStudioRpaSlot } from './studio-rpa-slot.js';
import { RECORD_RETENTION_SECONDS, studioTaskPutOptions } from './studio-task-storage.js';

export const SHEET_SELF_SLOT_COUNT = 8;

export function sheetSelfSlotKey(parentId, slotIndex) {
    return `sheet-self:slot:${parentId}:${slotIndex}`;
}

export function sheetSelfChildId(parentId, slotIndex, stage, sourceIndex = 0) {
    const sourcePart = stage === 'program' ? '' : `-p${sourceIndex + 1}`;
    return `${parentId}-s${slotIndex + 1}${sourcePart}-${stage}`;
}

export async function getSheetSelfSlot(env, parentId, slotIndex) {
    const raw = await env.SUBMISSIONS.get(sheetSelfSlotKey(parentId, slotIndex));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

export async function getSheetSelfSlots(env, parentId, slotCount = SHEET_SELF_SLOT_COUNT) {
    const count = Math.min(SHEET_SELF_SLOT_COUNT, Math.max(1, Number(slotCount) || SHEET_SELF_SLOT_COUNT));
    return Promise.all(Array.from({ length: count }, (_, index) => getSheetSelfSlot(env, parentId, index)));
}

export async function putSheetSelfSlot(env, slot, completed = false) {
    const options = completed
        ? { expirationTtl: RECORD_RETENTION_SECONDS }
        : undefined;
    await env.SUBMISSIONS.put(sheetSelfSlotKey(slot.parentId, slot.index), JSON.stringify(slot), options);
    return slot;
}

export async function startSheetSelfProgramSlot(env, parent, slot, origin, force = false) {
    slot.stage = 'program';
    slot.error = '';
    slot.failedStage = '';
    slot.errorNotifiedAt = '';
    slot.children = slot.children || {};
    slot.children.program = sheetSelfChildId(parent.id, slot.index, 'program');
    await putSheetSelfSlot(env, slot);

    const task = makeChildTask(parent, slot, {
        id: slot.children.program,
        mode: 'program',
        productKeys: slot.photographer ? slot.cutoutKeys : slot.productKeys,
        refKeys: [slot.referenceKey],
        stage: 'program'
    });
    try {
        return await createAndDispatchChild(env, task, origin, force);
    } catch (error) {
        await markSlotError(env, slot, 'program', error, origin);
        throw error;
    }
}

export async function startSheetSelfPhotographySlot(env, parent, slot, sourceKeys, origin) {
    if (!Array.isArray(sourceKeys) || sourceKeys.length !== 2) throw new Error('需要上传两张拍摄原图');
    slot.sourceKeys = sourceKeys;
    slot.stage = 'retouch';
    slot.error = '';
    slot.failedStage = '';
    slot.errorNotifiedAt = '';
    slot.children = slot.children || {};
    slot.children.retouch = sourceKeys.map((_, index) => sheetSelfChildId(parent.id, slot.index, 'retouch', index));
    slot.children.cutout = sourceKeys.map((_, index) => sheetSelfChildId(parent.id, slot.index, 'cutout', index));
    slot.children.program = sheetSelfChildId(parent.id, slot.index, 'program');
    await putSheetSelfSlot(env, slot);

    const results = [];
    for (let sourceIndex = 0; sourceIndex < sourceKeys.length; sourceIndex++) {
        const task = makeChildTask(parent, slot, {
            id: slot.children.retouch[sourceIndex],
            mode: 'retouch',
            refKeys: [sourceKeys[sourceIndex]],
            stage: 'retouch',
            sourceIndex
        });
        try {
            results.push({ status: 'fulfilled', value: await createAndDispatchChild(env, task, origin) });
        } catch (reason) {
            results.push({ status: 'rejected', reason });
        }
    }
    const failure = results.find(result => result.status === 'rejected');
    if (failure) {
        await markSlotError(env, slot, 'retouch', failure.reason, origin);
        throw failure.reason;
    }
    return results.map(result => result.value);
}

export async function advanceSheetSelfWorkflow({ env, task, origin }) {
    const workflow = task?.workflow;
    if (workflow?.type !== 'sheet_self' || task.status !== 'done') return { advanced: false };

    const parentRaw = await env.SUBMISSIONS.get(workflow.parentId);
    if (!parentRaw) return { advanced: false, error: 'Parent task not found' };
    const parent = JSON.parse(parentRaw);
    if (parent.status === 'rejected') return { advanced: false, cancelled: true };
    const slot = await getSheetSelfSlot(env, workflow.parentId, workflow.slotIndex);
    if (!slot) return { advanced: false, error: 'Workflow slot not found' };

    try {
        if (workflow.stage === 'retouch') {
            const resultKey = task.resultKeys?.[0];
            if (!resultKey?.key) throw new Error('精修结果图片不存在');
            slot.stage = 'cutout';
            slot.error = '';
            slot.failedStage = '';
            await putSheetSelfSlot(env, slot);
            const cutoutTask = makeChildTask(parent, slot, {
                id: slot.children.cutout[workflow.sourceIndex],
                mode: 'cutout',
                refKeys: [resultKey],
                stage: 'cutout',
                sourceIndex: workflow.sourceIndex,
                cutoutOutputFormat: 'jpg'
            });
            await createAndDispatchChild(env, cutoutTask, origin);
            return { advanced: true, stage: 'cutout', nextTaskIds: [cutoutTask.id] };
        }

        if (workflow.stage === 'cutout') {
            const cutoutTasks = await readTasks(env, slot.children.cutout || []);
            if (cutoutTasks.length < 2 || cutoutTasks.some(child => child.status !== 'done' || !child.resultKeys?.[0]?.key)) {
                slot.stage = 'cutout';
                await putSheetSelfSlot(env, slot);
                return { advanced: true, stage: 'cutout', waiting: true };
            }
            slot.cutoutKeys = cutoutTasks
                .sort((left, right) => Number(left.workflow?.sourceIndex || 0) - Number(right.workflow?.sourceIndex || 0))
                .map(child => child.resultKeys[0]);
            await putSheetSelfSlot(env, slot);
            await startSheetSelfProgramSlot(env, parent, slot, origin);
            return { advanced: true, stage: 'program', nextTaskIds: [slot.children.program] };
        }

        if (workflow.stage === 'program') {
            if (!Array.isArray(task.resultKeys) || !task.resultKeys.some(item => item?.key)) {
                throw new Error('图生图已回传完成状态，但没有收到成品图片');
            }
            slot.stage = 'done';
            slot.resultKeys = Array.isArray(task.resultKeys) ? task.resultKeys : [];
            slot.completedAt = task.completedAt || new Date().toISOString();
            slot.error = '';
            slot.failedStage = '';
            await putSheetSelfSlot(env, slot, true);
            await notifySheetSelfSlot(env, parent, slot, origin).catch(async error => {
                slot.resultNotified = false;
                slot.notificationError = String(error?.message || error).slice(0, 300);
                slot.failedStage = 'notify';
                slot.error = slot.notificationError;
                slot.notificationLastAttemptAt = new Date().toISOString();
                await putSheetSelfSlot(env, slot, true);
                if (!slot.errorNotifiedAt) {
                    await notifyAdminWorkflowError(env, parent, slot, origin).then(async () => {
                        slot.errorNotifiedAt = new Date().toISOString();
                        await putSheetSelfSlot(env, slot, true);
                    }).catch(notifyError => console.error('Sheet self notification error alert failed:', notifyError.message));
                }
            });
            await finishSheetSelfParent(env, parent);
            return { advanced: true, stage: 'done', notified: slot.resultNotified === true };
        }
    } catch (error) {
        await markSlotError(env, slot, workflow.stage, error, origin);
        return { advanced: false, error: String(error?.message || error) };
    }
    return { advanced: false };
}

export async function retrySheetSelfSlot(env, parent, slot, origin) {
    if (slot.stage === 'done') {
        await notifySheetSelfSlot(env, parent, slot, origin);
        await finishSheetSelfParent(env, parent);
        return { stage: 'done', notified: true };
    }

    const retouchTasks = await readTasks(env, slot.children?.retouch || []);
    const pendingRetouch = retouchTasks.find(task => task.status !== 'done');
    if (pendingRetouch) {
        await resetChildTimeoutForManualRetry(env, pendingRetouch);
        slot.stage = 'retouch';
        slot.error = '';
        slot.errorNotifiedAt = '';
        await putSheetSelfSlot(env, slot);
        await createAndDispatchChild(env, pendingRetouch, origin, true);
        return { stage: 'retouch' };
    }

    const cutoutTasks = await readTasks(env, slot.children?.cutout || []);
    const pendingCutout = cutoutTasks.find(task => task.status !== 'done');
    if (pendingCutout) {
        await resetChildTimeoutForManualRetry(env, pendingCutout);
        slot.stage = 'cutout';
        slot.error = '';
        slot.errorNotifiedAt = '';
        await putSheetSelfSlot(env, slot);
        await createAndDispatchChild(env, pendingCutout, origin, true);
        return { stage: 'cutout' };
    }

    const programId = slot.children?.program || sheetSelfChildId(parent.id, slot.index, 'program');
    const programTasks = await readTasks(env, [programId]);
    if (programTasks[0]?.status === 'done') {
        slot.stage = 'done';
        slot.resultKeys = programTasks[0].resultKeys || [];
        await putSheetSelfSlot(env, slot, true);
        await notifySheetSelfSlot(env, parent, slot, origin);
        await finishSheetSelfParent(env, parent);
        return { stage: 'done', notified: true };
    }
    if (programTasks[0]) await resetChildTimeoutForManualRetry(env, programTasks[0]);

    if (slot.photographer) {
        if (!Array.isArray(slot.cutoutKeys) || slot.cutoutKeys.length !== 2) throw new Error('两张白底抠图尚未完成');
    }
    await startSheetSelfProgramSlot(env, parent, slot, origin, true);
    return { stage: 'program' };
}

export async function retrySheetSelfChildAfterTimeout(env, task, origin) {
    if (task?.workflow?.type !== 'sheet_self') return { handled: false };
    const slot = await getSheetSelfSlot(env, task.workflow.parentId, task.workflow.slotIndex);
    if (!slot) return { handled: false };
    if (task.workflow.stage === 'retouch' || task.mode === 'retouch') {
        await markSlotError(env, slot, 'retouch', new Error('精修环节等待 30 分钟仍未收到结果，未自动重发'), origin);
        task.overdueNotified = true;
        task.overdueNotifiedAt = new Date().toISOString();
        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
        return { handled: true, exhausted: true, retrySkipped: true };
    }
    const retries = Number(task.workflowTimeoutRetries || 0);
    if (retries >= 1) {
        await markSlotError(env, slot, task.workflow.stage, new Error('首次发送和自动重发后，连续两次各等待 10 分钟仍未收到结果'), origin);
        task.overdueNotified = true;
        task.overdueNotifiedAt = new Date().toISOString();
        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
        return { handled: true, exhausted: true };
    }

    task.workflowTimeoutRetries = retries + 1;
    task.workflowLastTimeoutAt = new Date().toISOString();
    task.sentToRpaAt = '';
    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
    try {
        await createAndDispatchChild(env, task, origin, true);
        slot.stage = task.workflow.stage;
        slot.error = '';
        slot.failedStage = '';
        slot.errorNotifiedAt = '';
        await putSheetSelfSlot(env, slot);
        return { handled: true, retried: true, retries: retries + 1 };
    } catch (error) {
        await markSlotError(env, slot, task.workflow.stage, error, origin);
        task.status = 'processing';
        task.sentToRpa = true;
        task.overdueNotified = true;
        task.overdueNotifiedAt = new Date().toISOString();
        task.resultTimeoutRetryError = String(error?.message || error).slice(0, 300);
        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
        return { handled: true, error: String(error?.message || error) };
    }
}

export async function notifySheetSelfSlot(env, parent, slot, origin) {
    if (slot.resultNotified === true) return;
    if (!Array.isArray(slot.resultKeys) || !slot.resultKeys.some(item => item?.key)) {
        throw new Error('没有可发送给用户的成品图片');
    }
    if (!parent.submitter?.unionId || !env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET) {
        throw new Error('钉钉通知配置不完整');
    }
    const token = await getAccessToken(env);
    const staffId = await getStaffId(token, parent.submitter.unionId);
    if (!staffId) throw new Error('找不到提交人的钉钉账号');
    const taskForNotification = {
        ...parent,
        mode: 'program',
        resultKeys: (slot.resultKeys || []).map((item, index) => ({
            ...item,
            name: `表格自助-第${Number(slot.displayIndex ?? slot.index) + 1}张-${item.name || `成品图-${index + 1}.jpg`}`
        }))
    };
    await sendStudioResultImages(env, token, staffId, taskForNotification, origin);
    slot.resultNotified = true;
    slot.resultNotifiedAt = new Date().toISOString();
    slot.notificationError = '';
    slot.error = '';
    slot.failedStage = '';
    slot.errorNotifiedAt = '';
    slot.notificationLastAttemptAt = slot.resultNotifiedAt;
    await putSheetSelfSlot(env, slot, true);
}

export async function finishSheetSelfParent(env, parent) {
    const slots = await getSheetSelfSlots(env, parent.id, parent.sheetSelfSlotCount);
    const completedSlots = slots.filter(slot => slot?.stage === 'done');
    parent.resultKeys = completedSlots.flatMap(slot => slot.resultKeys || []);
    parent.sheetSelfCompletedCount = completedSlots.length;
    if (completedSlots.length !== slots.length) {
        await env.SUBMISSIONS.put(parent.id, JSON.stringify(parent), studioTaskPutOptions(parent));
        return false;
    }

    parent.status = 'done';
    parent.completedAt = parent.completedAt || new Date().toISOString();
    parent.completeNote = `表格自助 ${slots.length} 张图片已全部完成`;
    parent.dingtalkNotified = slots.every(slot => slot.resultNotified === true);
    parent.r2AutoNotified = false;
    parent.sheetSelfCompleted = true;
    await env.SUBMISSIONS.put(parent.id, JSON.stringify(parent), studioTaskPutOptions(parent));
    return true;
}

function makeChildTask(parent, slot, options) {
    const now = Date.now();
    return {
        id: options.id,
        kind: 'studio',
        mode: options.mode,
        submitter: parent.submitter,
        category: '图片',
        desc: '',
        want: '',
        note: '',
        scene: '',
        analyzePrompt: '',
        size: options.mode === 'program' ? (slot.aPlusDouble ? '1464x1200' : slot.size || '1600x1600') : '',
        imageName: `表格自助-第${Number(slot.displayIndex ?? slot.index) + 1}张`,
        productName: slot.productName || '-',
        title: slot.title || '',
        subtitle: slot.subtitle || '',
        otherText: slot.otherText || '',
        productKeys: options.productKeys || [],
        refKeys: options.refKeys || [],
        modelKeys: [],
        resultKeys: [],
        aPlusDouble: options.mode === 'program' && slot.aPlusDouble === true,
        cutoutOutputFormat: options.cutoutOutputFormat || '',
        silent: true,
        dingtalkNotified: true,
        r2AutoNotified: true,
        status: 'pending',
        timestamp: now,
        createdAt: new Date(now).toISOString(),
        workflow: {
            type: 'sheet_self',
            parentId: parent.id,
            slotIndex: slot.index,
            sourceIndex: Number(options.sourceIndex || 0),
            stage: options.stage
        }
    };
}

async function createAndDispatchChild(env, task, origin, force = false) {
    const existingRaw = await env.SUBMISSIONS.get(task.id).catch(() => null);
    if (existingRaw) {
        const existing = JSON.parse(existingRaw);
        if (existing.status === 'done' || (existing.status === 'processing' && existing.sentToRpa && !force)) return existing;
        task = existing;
    }

    if (!force) {
        task.status = 'pending';
        task.sentToRpa = false;
        task.workflowError = '';
        task.workflowQueuedAt = task.workflowQueuedAt || new Date().toISOString();
        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
        await queueStudioRpaTask(env, task.id);
        return task;
    }

    const slot = await acquireStudioRpaSlot(env, task.id);
    if (!slot.acquired) {
        task.status = 'pending';
        task.sentToRpa = false;
        task.workflowError = '';
        task.workflowQueuedAt = new Date().toISOString();
        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
        await queueStudioRpaTask(env, task.id);
        return task;
    }

    task.status = 'pending';
    task.sentToRpa = false;
    task.workflowError = '';
    const webhookUrl = task.mode === 'program'
        ? env.RPA_WEBHOOK_URL_PROGRAM || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a3a40ac622e84b667229fde/invoke'
        : 'internal';
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await dispatchStudioTaskToRpa({ env, task, origin, webhookUrl, persistWebhook: false });
            task.workflowDispatchAttempts = Number(task.workflowDispatchAttempts || 0) + attempt;
            task.workflowQueuedAt = '';
            await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
            await appendQueue(env.SUBMISSIONS, 'studio:processingQueue:v2', task.id);
            return task;
        } catch (error) {
            lastError = error;
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 400));
        }
    }
    task.status = 'pending';
    task.sentToRpa = false;
    task.workflowError = String(lastError?.message || lastError).slice(0, 300);
    task.workflowLastAttemptAt = new Date().toISOString();
    task.workflowDispatchAttempts = Number(task.workflowDispatchAttempts || 0) + 3;
    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
    if (!slot.alreadyOwned) await releaseStudioRpaSlot(env, task.id);
    throw lastError;
}

async function markSlotError(env, slot, stage, error, origin = '') {
    slot.stage = 'error';
    slot.failedStage = stage;
    slot.error = String(error?.message || error).slice(0, 300);
    slot.lastErrorAt = new Date().toISOString();
    await putSheetSelfSlot(env, slot);
    if (!slot.errorNotifiedAt) {
        try {
            const parentRaw = await env.SUBMISSIONS.get(slot.parentId);
            const parent = parentRaw ? JSON.parse(parentRaw) : null;
            await notifyAdminWorkflowError(env, parent, slot, origin);
            slot.errorNotifiedAt = new Date().toISOString();
            await putSheetSelfSlot(env, slot);
        } catch (notifyError) {
            console.error('Sheet self workflow error notification failed:', notifyError.message);
        }
    }
}

async function readTasks(env, ids) {
    const raws = await Promise.all((ids || []).map(id => env.SUBMISSIONS.get(id).catch(() => null)));
    return raws.filter(Boolean).map(raw => JSON.parse(raw));
}

async function resetChildTimeoutForManualRetry(env, task) {
    task.overdueNotified = false;
    task.overdueNotifiedAt = '';
    task.workflowTimeoutRetries = 0;
    task.workflowLastTimeoutAt = '';
    task.resultTimeoutRetryError = '';
    task.workflowError = '';
    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
}

async function appendQueue(kv, key, taskId) {
    const raw = await kv.get(key).catch(() => null);
    let ids = [];
    if (raw) {
        try { ids = JSON.parse(raw); } catch { ids = []; }
    }
    if (!Array.isArray(ids)) ids = [];
    if (!ids.includes(taskId)) ids.push(taskId);
    await kv.put(key, JSON.stringify(ids.slice(-500)));
}

async function notifyAdminWorkflowError(env, parent, slot, origin) {
    if (!parent || !env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET || !env.ADMIN_USER_ID) return;
    const token = await getAccessToken(env);
    const stageText = { retouch: '精修', cutout: '白底抠图', program: '图生图', notify: '发送钉钉' }[slot.failedStage] || slot.failedStage || '处理';
    const content = `表格自助任务自动重试后仍失败\n\n提交人：${parent.submitter?.name || '未知'}\n图片位：第 ${Number(slot.displayIndex ?? slot.index) + 1} 张\n失败环节：${stageText}\n原因：${slot.error || '-'}\n任务ID：${parent.id}${origin ? `\n\n去管理台处理：${origin}/admin.html` : ''}`;
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [env.ADMIN_USER_ID],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function getAccessToken(env) {
    const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: env.DINGTALK_APPKEY, appSecret: env.DINGTALK_APPSECRET })
    });
    const data = await response.json();
    if (!response.ok || !data.accessToken) throw new Error('获取钉钉令牌失败');
    return data.accessToken;
}

async function getStaffId(accessToken, unionId) {
    const response = await fetch(`https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unionid: unionId })
    });
    const data = await response.json();
    if (!response.ok || data.errcode !== 0) throw new Error(data.errmsg || '查找钉钉用户失败');
    return data.result?.userid || '';
}
