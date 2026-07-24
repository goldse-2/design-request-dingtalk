import { taskNeedsRpaTranslation, translateForRpa, translateProgramFieldsForRpa } from '../_shared/ai-translate.js';
import { claimStudioNotification, markStudioNotificationFailed, markStudioNotificationSent, sendStudioResultImages, studioNotificationLeaseActive } from '../_shared/studio-dingtalk.js';
import { isAdminLibraryCutoutTask } from '../_shared/studio-library-replacement.js';
import { recolorImage } from '../_shared/variant-recolor-core.js';
import { editImageWithPrompt } from '../_shared/image-edit-core.js';
import { studioTaskPutOptions } from '../_shared/studio-task-storage.js';
import { advanceSheetSelfWorkflow, retrySheetSelfChildAfterTimeout } from '../_shared/sheet-self-workflow.js';
import { acquireStudioRpaSlot, claimStudioRpaRetrySlot, ensureStudioRpaSlot, getStudioRpaGlobalPause, releaseStudioRpaSlot, studioRpaTimeoutMinutes } from '../_shared/studio-rpa-slot.js';
import { advanceStudioPhotographyWorkflow, markStudioPhotographyRetouchTimedOut } from '../_shared/studio-photography-workflow.js';
import { processDueEtaReminders, shouldRunEtaReminderCheck } from '../_shared/eta-reminders.js';
import { createProgramRpaParams } from '../_shared/studio-no-product.js';

const DIRECT_IMAGE_PROCESSING_LEASE_MS = 20 * 60 * 1000;

export async function onRequestGet(context) {
    const { env, request, waitUntil } = context;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    try {
        const now = Date.now();
        const url = new URL(request.url);
        const rpaOnly = url.searchParams.get('rpaOnly') === '1';
        const imageOnly = url.searchParams.get('imageOnly') === '1';
        let etaReminders = { checked: false, pending: 0, due: 0, notified: 0, errors: [] };
        if (rpaOnly && shouldRunEtaReminderCheck(now)) {
            try {
                etaReminders = await processDueEtaReminders(env, now);
            } catch (error) {
                etaReminders.errors.push({ id: '', error: String(error?.message || error).slice(0, 200) });
                console.error('ETA reminder check failed:', error.message);
            }
        }
        const autoSendThreshold = 2 * 60 * 1000;
        const autoSent = [];
        const autoErrors = [];
        const notified = [];
        const RPA_QUEUE_KEY = 'studio:rpaQueue:v2';
        const IMAGE_QUEUE_KEY = 'studio:imageQueue:v2';
        const PROCESSING_QUEUE_KEY = 'studio:processingQueue:v2';
        const selectedQueueKey = imageOnly ? IMAGE_QUEUE_KEY : RPA_QUEUE_KEY;

        let autoQueueIds = imageOnly
            ? await listDueImageTaskIds(env.SUBMISSIONS, now)
            : await readQueue(env.SUBMISSIONS, selectedQueueKey);
        let processingQueueIds = imageOnly ? [] : await readQueue(env.SUBMISSIONS, PROCESSING_QUEUE_KEY);
        if (!imageOnly && (autoQueueIds === null || processingQueueIds === null)) {
            const migrated = await migrateQueues(env);
            await writeQueue(env.SUBMISSIONS, RPA_QUEUE_KEY, migrated.rpaQueueIds);
            await writeQueue(env.SUBMISSIONS, IMAGE_QUEUE_KEY, migrated.imageQueueIds);
            await writeQueue(env.SUBMISSIONS, PROCESSING_QUEUE_KEY, migrated.processingQueueIds);
            autoQueueIds = imageOnly ? migrated.imageQueueIds : migrated.rpaQueueIds;
            processingQueueIds = imageOnly ? [] : migrated.processingQueueIds;
        }

        const initialAutoQueue = [...autoQueueIds];
        const initialProcessingQueue = [...processingQueueIds];
        let rpaSlot = imageOnly
            ? { busy: false, taskId: '' }
            : await ensureStudioRpaSlot(env, processingQueueIds);
        const globalPause = imageOnly
            ? { paused: false, updatedAt: '' }
            : await getStudioRpaGlobalPause(env);

        const autoBatchIds = globalPause.paused ? [] : autoQueueIds.slice(0, 1);
        const processingBatchIds = imageOnly
            ? []
            : unique([rpaSlot.taskId, ...processingQueueIds.slice(0, 10)].filter(Boolean));
        const deferredAutoQueue = autoQueueIds.slice(autoBatchIds.length);
        const processingBatchSet = new Set(processingBatchIds);
        const deferredProcessingQueue = processingQueueIds.filter(id => !processingBatchSet.has(id));
        const autoSendTasks = await readStudioTasks(env, autoBatchIds);
        const tasks = await readStudioTasks(env, processingBatchIds);
        const nextAutoQueue = [];
        const nextProcessingQueue = [];

        if (autoSendTasks.length) {
            const autoModes = new Set(autoSendTasks.map(task => task.mode));
            const programWebhook = autoModes.has('program')
                ? await safeKvGet(env.SUBMISSIONS, 'studio:rpaWebhookUrl:program') || env.RPA_WEBHOOK_URL_PROGRAM || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a3a40ac622e84b667229fde/invoke'
                : '';
            const freeWebhook = autoModes.has('free')
                ? env.RPA_WEBHOOK_URL_FREE || await safeKvGet(env.SUBMISSIONS, 'studio:rpaWebhookUrl:free') || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a31134a622e84b6672263ee/invoke'
                : '';
            const retouchWebhook = env.RPA_WEBHOOK_URL_RETOUCH || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a543c91645904b3178e096b/invoke';
            const cutoutWebhook = autoModes.has('cutout')
                ? env.RPA_WEBHOOK_URL_CUTOUT || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a573bbfc272480ce63d81d4/invoke'
                : '';
            const origin = new URL(request.url).origin;
            for (const task of autoSendTasks) {
                const isImageTask = isDirectImageTask(task.mode);
                if (imageOnly !== isImageTask) continue;
                const createdAt = typeof task.timestamp === 'number'
                    ? task.timestamp
                    : new Date(task.createdAt || task.timestamp || 0).getTime();
                const requiresApprovalDelay = !['sheet_self', 'studio_photography'].includes(task.workflow?.type)
                    && task.mode !== 'cutout'
                    && !task.photographyCompletedAt;
                const priorityRequested = Boolean(task.rpaQueuePriorityAt);
                if (!imageOnly && requiresApprovalDelay && !priorityRequested && (!createdAt || (now - createdAt) < autoSendThreshold)) {
                    nextAutoQueue.push(task.id);
                    continue;
                }
                if (!imageOnly && task.pausedAuto) continue;

                if (isImageTask) {
                    if (directImageProcessingLeaseActive(task, now)) {
                        nextAutoQueue.push(task.id);
                        continue;
                    }
                    let activeTask = task;
                    let ownsProcessingLease = false;
                    const nextAttemptAt = Date.parse(task.backgroundNextAttemptAt || '');
                    if (Number.isFinite(nextAttemptAt) && nextAttemptAt > now) {
                        nextAutoQueue.push(task.id);
                        continue;
                    }
                    try {
                        const processingClaim = await claimDirectImageProcessing(env, task.id, now);
                        if (!processingClaim.claimed) {
                            nextAutoQueue.push(task.id);
                            continue;
                        }
                        activeTask = processingClaim.task;
                        ownsProcessingLease = true;
                        const result = activeTask.mode === 'resize_ai'
                            ? await processResizeAiTask(env, activeTask)
                            : activeTask.mode === 'watermark'
                                ? await processWatermarkTask(env, activeTask)
                                : activeTask.mode === 'translate_image'
                                    ? await processTranslationTaskStep(env, activeTask)
                                : await processVariantTaskStep(env, activeTask, origin);
                        activeTask.backgroundProcessingLeaseToken = '';
                        activeTask.backgroundProcessingLeaseUntil = '';
                        activeTask.backgroundFailureCount = 0;
                        activeTask.backgroundLastError = '';
                        activeTask.backgroundNextAttemptAt = '';
                        activeTask.backgroundLastAttemptAt = new Date().toISOString();
                        await env.SUBMISSIONS.put(activeTask.id, JSON.stringify(activeTask), studioTaskPutOptions(activeTask));
                        autoSent.push(activeTask.id);
                        const needsNotify = result.done && activeTask.submitter?.unionId && !activeTask.dingtalkNotified && !activeTask.r2AutoNotified;
                        let notifyOk = !needsNotify;
                        if (needsNotify && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET) {
                            let notificationClaim;
                            try {
                                notificationClaim = await claimStudioNotification(env, activeTask.id);
                                if (notificationClaim.claimed) {
                                    await notifyUserDone(env, notificationClaim.task, origin);
                                    await markStudioNotificationSent(env, activeTask.id);
                                }
                                notifyOk = true;
                            } catch (e) {
                                console.error('Notify background image task done failed:', e.message);
                                if (notificationClaim?.claimed) {
                                    await markStudioNotificationFailed(env, activeTask.id, e).catch(markError => {
                                        console.error('Mark background image notification failure failed:', activeTask.id, markError.message);
                                    });
                                }
                            }
                        }
                        if (!result.done || !notifyOk) nextAutoQueue.push(activeTask.id);
                    } catch (e) {
                        if (!ownsProcessingLease) {
                            console.error('Direct image processing claim failed:', task.id, e.message);
                            nextAutoQueue.push(task.id);
                            continue;
                        }
                        const errMsg = String(e.message || e).slice(0, 300);
                        const failureCount = Math.max(0, Number(activeTask.backgroundFailureCount || 0)) + 1;
                        autoErrors.push({ id: activeTask.id, error: errMsg });
                        activeTask.backgroundProcessingLeaseToken = '';
                        activeTask.backgroundProcessingLeaseUntil = '';
                        activeTask.backgroundFailureCount = failureCount;
                        activeTask.backgroundLastError = errMsg;
                        activeTask.backgroundLastAttemptAt = new Date().toISOString();
                        const retryDelay = /image model is unavailable/i.test(errMsg)
                            ? 60 * 60 * 1000
                            : imageRetryDelayMs(failureCount);
                        activeTask.backgroundNextAttemptAt = new Date(now + retryDelay).toISOString();
                        await env.SUBMISSIONS.put(activeTask.id, JSON.stringify(activeTask), studioTaskPutOptions(activeTask));
                        console.error('Background image task failed:', activeTask.id, e.message);
                        nextAutoQueue.push(activeTask.id);
                    }
                    continue;
                }

                if (task.status !== 'pending' || task.sentToRpa || task.pausedAuto) continue;

                const webhookUrl = task.mode === 'program'
                    ? programWebhook
                    : task.mode === 'retouch'
                        ? retouchWebhook
                        : task.mode === 'cutout'
                            ? cutoutWebhook
                        : freeWebhook;
                if (!webhookUrl) continue;

                let acquiredSlot = null;
                try {
                    acquiredSlot = await acquireStudioRpaSlot(env, task.id, processingQueueIds);
                    if (!acquiredSlot.acquired) {
                        nextAutoQueue.push(task.id);
                        continue;
                    }
                    rpaSlot = { busy: true, taskId: task.id };
                    const { payload, pickedSize } = buildRpaPayload(task, origin);
                    if (task.mode === 'free' && taskNeedsRpaTranslation(task)) {
                        payload.params["描述"] = await translateForRpa(env, payload.params["描述"]);
                    } else if (task.mode === 'program') {
                        const translatedFields = await translateProgramFieldsForRpa(env, {
                            productName: task.noProductImage === true ? '-' : (task.productName || '-'),
                            title: task.title || '-',
                            subtitle: task.subtitle || '-',
                            otherText: task.otherText || '-'
                        });
                        if (task.noProductImage !== true) payload.params["产品名称"] = translatedFields.productName;
                        payload.params["标题"] = translatedFields.title;
                        payload.params["副标题"] = translatedFields.subtitle;
                        payload.params["其他文案"] = translatedFields.otherText;
                    }
                    const res = await fetchWithTimeout(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    }, 12000);
                    const text = await res.text();
                    if (!res.ok) throw new Error('RPA webhook HTTP ' + res.status + ': ' + text.slice(0, 300));

                    task.status = 'processing';
                    task.sentToRpa = true;
                    task.sentToRpaAt = new Date().toISOString();
                    task.autoRpaLastAttemptAt = new Date().toISOString();
                    task.autoRpaLastResponse = text.slice(0, 300);
                    task.rpaSentPayload = payload;
                    task.rpaQueuePriorityAt = '';
                    task.manualRpaResendQueued = false;
                    task.manualRpaResendQueuedAt = '';
                    if (!task.size && pickedSize) task.size = pickedSize;
                    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));

                    autoSent.push(task.id);
                    nextProcessingQueue.push(task.id);
                    if (!isAdminLibraryCutoutTask(task) && !task.silent && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET && env.ADMIN_USER_ID) {
                        await notifyAutoSent(env, task).catch(e => console.error('Notify auto-sent failed:', e.message));
                    }
                } catch (e) {
                    if (acquiredSlot?.acquired && !acquiredSlot.alreadyOwned) {
                        await releaseStudioRpaSlot(env, task.id).catch(() => {});
                        rpaSlot = { busy: false, taskId: '' };
                    }
                    const errMsg = String(e.message || e).slice(0, 300);
                    autoErrors.push({ id: task.id, error: errMsg });
                    task.autoRpaLastError = errMsg;
                    task.autoRpaLastAttemptAt = new Date().toISOString();
                    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
                    console.error('Auto send RPA failed:', task.id, e.message);
                    nextAutoQueue.push(task.id);
                }
            }
        }

        for (const task of tasks) {
            if (!task) continue;
            if (task.status === 'done' && task.workflow?.type === 'sheet_self') {
                const advanceResult = await advanceSheetSelfWorkflow({ env, task, origin: new URL(request.url).origin });
                nextProcessingQueue.push(...(advanceResult.nextTaskIds || []));
                continue;
            }
            if (task.status === 'done' && task.workflow?.type === 'studio_photography') {
                await advanceStudioPhotographyWorkflow({ env, task });
                continue;
            }
            if (task.status === 'done' && !task.dingtalkNotified && !task.r2AutoNotified) {
                if (studioNotificationLeaseActive(task, now)) {
                    nextProcessingQueue.push(task.id);
                    continue;
                }
                if (task.submitter?.unionId && env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET) {
                    task.dingtalkNotificationState = 'sending';
                    task.dingtalkNotificationStartedAt = new Date().toISOString();
                    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
                    try {
                        await notifyUserDone(env, task, new URL(request.url).origin);
                        await markStudioNotificationSent(env, task.id);
                    } catch (error) {
                        console.error('Retry result notification failed:', task.id, error.message);
                        await markStudioNotificationFailed(env, task.id, error).catch(markError => {
                            console.error('Mark retry notification failure failed:', task.id, markError.message);
                        });
                        nextProcessingQueue.push(task.id);
                    }
                }
                continue;
            }
            if (task.status !== 'processing' || !task.sentToRpa) continue;
            if (task.overdueNotified) {
                if (rpaSlot.taskId === task.id) {
                    await releaseStudioRpaSlot(env, task.id);
                    rpaSlot = { busy: false, taskId: '' };
                }
                deferredProcessingQueue.push(task.id);
                continue;
            }
            if (rpaSlot.taskId !== task.id) {
                nextProcessingQueue.push(task.id);
                continue;
            }
            const sentAt = task.sentToRpaAt ? new Date(task.sentToRpaAt).getTime() : 0;
            const isRetouchStage = task.mode === 'retouch'
                || (task.workflow?.type === 'sheet_self' && task.workflow.stage === 'retouch');
            const timeoutThreshold = studioRpaTimeoutMinutes(task) * 60 * 1000;
            if (!sentAt || (now - sentAt) < timeoutThreshold) {
                nextProcessingQueue.push(task.id);
                continue;
            }
            if (globalPause.paused) {
                nextProcessingQueue.push(task.id);
                continue;
            }

            if (task.workflow?.type === 'sheet_self') {
                const retries = Math.max(0, Number(task.workflowTimeoutRetries || 0));
                if (retries < 1) {
                    const retryClaim = await claimStudioRpaRetrySlot(env, task.id);
                    if (!retryClaim.claimed) {
                        nextProcessingQueue.push(task.id);
                        continue;
                    }
                }
                const retryResult = await retrySheetSelfChildAfterTimeout(env, task, new URL(request.url).origin, retries < 1);
                if (retryResult.retried) nextProcessingQueue.push(task.id);
                if (retryResult.retried) autoSent.push(task.id);
                if (retryResult.error) autoErrors.push({ id: task.id, error: retryResult.error });
                if (retryResult.exhausted || retryResult.error) {
                    await releaseStudioRpaSlot(env, task.id);
                    rpaSlot = { busy: false, taskId: '' };
                    deferredProcessingQueue.push(task.id);
                }
                continue;
            }

            if (task.workflow?.type === 'studio_photography') {
                await markStudioPhotographyRetouchTimedOut(env, task);
                await releaseStudioRpaSlot(env, task.id);
                rpaSlot = { busy: false, taskId: '' };
                deferredProcessingQueue.push(task.id);
                continue;
            }

            if (isRetouchStage) {
                const result = await markTaskOverdue(env, task, 'retouch');
                if (result.notified) notified.push(task.id);
                await releaseStudioRpaSlot(env, task.id);
                rpaSlot = { busy: false, taskId: '' };
                (result.settled ? deferredProcessingQueue : nextProcessingQueue).push(task.id);
                continue;
            }

            const timeoutRetries = Math.max(0, Number(task.resultTimeoutRetryCount || 0));
            if (timeoutRetries < 1) {
                const retryClaim = await claimStudioRpaRetrySlot(env, task.id);
                if (!retryClaim.claimed) {
                    nextProcessingQueue.push(task.id);
                    continue;
                }
                task.resultTimeoutRetryCount = 1;
                task.resultTimeoutFirstAt = new Date().toISOString();
                try {
                    await resendStudioTaskAfterResultTimeout(env, task, new URL(request.url).origin);
                    autoSent.push(task.id);
                    nextProcessingQueue.push(task.id);
                } catch (error) {
                    const errorText = String(error?.message || error).slice(0, 300);
                    task.status = 'processing';
                    task.sentToRpa = true;
                    task.resultTimeoutRetryError = errorText;
                    task.resultTimeoutRetryFailedAt = new Date().toISOString();
                    autoErrors.push({ id: task.id, error: errorText });
                    const result = await markTaskOverdue(env, task, 'retry_failed');
                    if (result.notified) notified.push(task.id);
                    await releaseStudioRpaSlot(env, task.id);
                    rpaSlot = { busy: false, taskId: '' };
                    (result.settled ? deferredProcessingQueue : nextProcessingQueue).push(task.id);
                }
                continue;
            }

            const result = await markTaskOverdue(env, task, 'twice');
            if (result.notified) notified.push(task.id);
            await releaseStudioRpaSlot(env, task.id);
            rpaSlot = { busy: false, taskId: '' };
            (result.settled ? deferredProcessingQueue : nextProcessingQueue).push(task.id);
        }

        // Rotate background image work after every step. A failed or multi-image task
        // must not keep the queue head and block every task submitted behind it.
        const finalAutoQueue = imageOnly
            ? unique([...deferredAutoQueue, ...nextAutoQueue])
            : unique([...nextAutoQueue, ...deferredAutoQueue]);
        const finalProcessingQueue = unique([...nextProcessingQueue, ...deferredProcessingQueue]);
        if (!imageOnly && !queuesEqual(initialAutoQueue, finalAutoQueue)) {
            await writeQueue(env.SUBMISSIONS, selectedQueueKey, finalAutoQueue);
        }
        if (!imageOnly && !queuesEqual(initialProcessingQueue, finalProcessingQueue)) {
            await writeQueue(env.SUBMISSIONS, PROCESSING_QUEUE_KEY, finalProcessingQueue);
        }

        return Response.json({
            ok: true,
            checked: tasks.length,
            autoChecked: autoSendTasks.length,
            autoSent: autoSent.length,
            autoSentTasks: autoSent,
            autoErrors,
            notified: notified.length,
            tasks: notified,
            rpaOnly,
            imageOnly,
            queueType: imageOnly ? 'image' : 'rpa',
            queueRemaining: finalAutoQueue.length,
            processingQueueRemaining: imageOnly ? null : finalProcessingQueue.length,
            globalPaused: globalPause.paused,
            globalPauseUpdatedAt: globalPause.updatedAt,
            etaReminders
        });
    } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}

function imageRetryDelayMs(failureCount) {
    if (failureCount <= 1) return 3 * 60 * 1000;
    if (failureCount === 2) return 10 * 60 * 1000;
    if (failureCount === 3) return 30 * 60 * 1000;
    return 60 * 60 * 1000;
}

async function safeKvGet(kv, key) {
    try {
        return await kv.get(key);
    } catch (err) {
        console.error('KV get failed:', key, err.message);
        return null;
    }
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err?.name === 'AbortError') throw new Error('RPA webhook timed out');
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

async function readQueue(kv, key) {
    const raw = await safeKvGet(kv, key);
    if (raw === null || raw === undefined) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return unique(parsed.filter(id => typeof id === 'string' && id.startsWith('studio-')));
    } catch (err) {
        console.error('Read studio queue failed:', key, err.message);
        return [];
    }
}

async function listDueImageTaskIds(kv, now) {
    const listed = await kv.list({ prefix: 'studio-', limit: 1000 });
    return (listed.keys || [])
        .filter(key => {
            const metadata = key.metadata || {};
            if (metadata.kind !== 'studio' || !isDirectImageTask(metadata.mode)) return false;
            const active = metadata.status === 'pending'
                || metadata.status === 'processing'
                || (metadata.status === 'done' && !metadata.dingtalkNotified && !metadata.r2AutoNotified);
            if (!active) return false;
            const processingLeaseUntil = Date.parse(metadata.backgroundProcessingLeaseUntil || '');
            if (Number.isFinite(processingLeaseUntil) && processingLeaseUntil > now) return false;
            const nextAttemptAt = Date.parse(metadata.backgroundNextAttemptAt || '');
            return !Number.isFinite(nextAttemptAt) || nextAttemptAt <= now;
        })
        .sort((left, right) => {
            const leftAttempt = Date.parse(left.metadata?.backgroundLastAttemptAt || '') || 0;
            const rightAttempt = Date.parse(right.metadata?.backgroundLastAttemptAt || '') || 0;
            if (leftAttempt !== rightAttempt) return leftAttempt - rightAttempt;
            return Number(left.metadata?.timestamp || 0) - Number(right.metadata?.timestamp || 0);
        })
        .map(key => key.name);
}

async function writeQueue(kv, key, ids) {
    const cleanIds = unique((Array.isArray(ids) ? ids : [])
        .filter(id => typeof id === 'string' && id.startsWith('studio-')))
        .slice(-500);
    await kv.put(key, JSON.stringify(cleanIds));
}

function unique(ids) {
    return [...new Set(Array.isArray(ids) ? ids : [])];
}

function queuesEqual(left, right) {
    if (left.length !== right.length) return false;
    return left.every((id, index) => id === right[index]);
}

async function migrateQueues(env) {
    const rpaQueueIds = [];
    const imageQueueIds = [];
    const processingQueueIds = [];
    let cursor;
    let pages = 0;

    do {
        const listOptions = { prefix: 'studio-', limit: 1000 };
        if (cursor) listOptions.cursor = cursor;
        const listed = await env.SUBMISSIONS.list(listOptions);
        pages += 1;

        for (const key of listed.keys || []) {
            const meta = key.metadata || {};
            const mode = meta.mode || '';
            const status = meta.status || '';
            const isBackgroundTask = isDirectImageTask(mode);

            if (isBackgroundTask) {
                if (['pending', 'processing', 'done'].includes(status)
                    && !meta.dingtalkNotified
                    && !meta.r2AutoNotified
                    && !directImageProcessingLeaseActive(meta)) {
                    imageQueueIds.push(key.name);
                }
                continue;
            }

            if (['free', 'program', 'retouch', 'cutout'].includes(mode)
                && status === 'pending'
                && !meta.sentToRpa
                && !meta.pausedAuto) {
                rpaQueueIds.push(key.name);
            }

            if (status === 'processing'
                && meta.sentToRpa) {
                processingQueueIds.push(key.name);
            }
        }

        cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor && pages < 5);

    return {
        rpaQueueIds: unique(rpaQueueIds),
        imageQueueIds: unique(imageQueueIds),
        processingQueueIds: unique(processingQueueIds)
    };
}

async function readStudioTasks(env, keys) {
    const tasks = [];
    for (const key of keys) {
        try {
            const raw = await env.SUBMISSIONS.get(key);
            if (!raw) continue;
            const task = JSON.parse(raw);
            if (task && task.kind === 'studio') tasks.push(task);
        } catch (err) {
            console.error('Read studio task failed:', key, err.message);
        }
    }
    return tasks;
}

export function directImageProcessingLeaseActive(task, now = Date.now()) {
    const leaseUntil = Date.parse(task?.backgroundProcessingLeaseUntil || '');
    return Number.isFinite(leaseUntil) && leaseUntil > now;
}

export async function claimDirectImageProcessing(env, taskId, now = Date.now()) {
    const raw = await env.SUBMISSIONS.get(taskId);
    if (!raw) throw new Error('Direct image task not found while claiming processing');
    const task = JSON.parse(raw);
    if (task.dingtalkNotified || task.r2AutoNotified) {
        return { claimed: false, reason: 'completed', task };
    }
    if (directImageProcessingLeaseActive(task, now)) {
        return { claimed: false, reason: 'processing', task };
    }

    const token = crypto.randomUUID();
    task.backgroundProcessingLeaseToken = token;
    task.backgroundProcessingLeaseUntil = new Date(now + DIRECT_IMAGE_PROCESSING_LEASE_MS).toISOString();
    await env.SUBMISSIONS.put(taskId, JSON.stringify(task), studioTaskPutOptions(task));

    // Concurrent monitors may start together; only the final confirmed lease owner can continue.
    await new Promise(resolve => setTimeout(resolve, 100));
    const confirmedRaw = await env.SUBMISSIONS.get(taskId);
    if (!confirmedRaw) throw new Error('Direct image task disappeared while claiming processing');
    const confirmed = JSON.parse(confirmedRaw);
    if (confirmed.backgroundProcessingLeaseToken !== token) {
        return { claimed: false, reason: 'claimed_elsewhere', task: confirmed };
    }
    return { claimed: true, reason: 'claimed', task: confirmed };
}

async function processVariantTaskStep(env, task, origin) {
    if (!env.SUBMISSION_FILES) throw new Error('R2 storage not configured');
    const refKeys = Array.isArray(task.refKeys) ? task.refKeys : [];
    if (!refKeys.length) throw new Error('Variant images not found');

    const index = Math.max(0, Number(task.variantNextIndex || 0));
    if (index >= refKeys.length) {
        task.status = 'done';
        task.completedAt = task.completedAt || new Date().toISOString();
        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
        return { done: true };
    }

    const source = refKeys[index];
    const sourceObject = await env.SUBMISSION_FILES.get(source.key);
    if (!sourceObject) throw new Error('Variant source image missing');

    const mimeType = sourceObject.httpMetadata?.contentType || guessContentType(source.name || source.key);
    const base64 = arrayBufferToBase64(await sourceObject.arrayBuffer());
    const result = await recolorImage({
        env,
        scope: task.variantScope,
        colorName: task.colorName,
        colorHex: task.colorHex,
        mimeType,
        base64
    });
    const stored = await storeVariantResult(env, task, result, source.name || `source-${index + 1}.png`, index);

    const nextIndex = index + 1;
    task.resultKeys = [
        ...(Array.isArray(task.resultKeys) ? task.resultKeys.filter(item => item?.key !== stored.key) : []),
        stored
    ];
    task.status = nextIndex >= refKeys.length ? 'done' : 'processing';
    task.variantNextIndex = nextIndex;
    task.variantLastAttemptAt = new Date().toISOString();
    task.variantLastError = '';
    if (task.status === 'done') {
        task.completedAt = new Date().toISOString();
        task.completeNote = '变体改色完成';
    }

    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
    return { done: task.status === 'done', stored };
}

async function processTranslationTaskStep(env, task) {
    if (!env.SUBMISSION_FILES) throw new Error('R2 storage not configured');
    const refKeys = Array.isArray(task.refKeys) ? task.refKeys : [];
    const dimensions = Array.isArray(task.translationDimensions) ? task.translationDimensions : [];
    if (!refKeys.length || dimensions.length !== refKeys.length) {
        throw new Error('Translation source images or dimensions are missing');
    }

    const index = Math.max(0, Number(task.translationNextIndex || 0));
    if (index >= refKeys.length) {
        task.status = 'done';
        task.completedAt = task.completedAt || new Date().toISOString();
        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
        return { done: true };
    }

    const source = refKeys[index];
    const target = normalizeTranslationTarget(dimensions[index]);
    let pending = task.translationPendingResult?.index === index ? task.translationPendingResult : null;
    let generated;

    if (pending?.key) {
        const pendingObject = await env.SUBMISSION_FILES.get(pending.key);
        if (pendingObject) {
            generated = {
                bytes: await pendingObject.arrayBuffer(),
                mimeType: pendingObject.httpMetadata?.contentType || pending.mimeType || 'image/jpeg'
            };
        } else {
            pending = null;
        }
    }

    if (!generated) {
        const sourceObject = await env.SUBMISSION_FILES.get(source.key);
        if (!sourceObject) throw new Error('Translation source image missing');
        const mimeType = sourceObject.httpMetadata?.contentType || guessContentType(source.name || source.key);
        const result = await editImageWithPrompt({
            env,
            prompt: buildTranslationPrompt(task.translationLanguage, target),
            mimeType,
            base64: arrayBufferToBase64(await sourceObject.arrayBuffer()),
            maxBytes: 15 * 1024 * 1024
        });
        generated = await resultToBytes(result);
        const pendingKey = `studio-results/${task.id}/translation-pending-${index + 1}.${extensionFromMime(generated.mimeType)}`;
        await env.SUBMISSION_FILES.put(pendingKey, generated.bytes, {
            httpMetadata: { contentType: generated.mimeType }
        });
        task.translationPendingResult = { index, key: pendingKey, mimeType: generated.mimeType };
        task.translationLastAttemptAt = new Date().toISOString();
        await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
        pending = task.translationPendingResult;
    }

    const exact = await transformToExactJpeg(env, generated, target);
    const stored = await storeTranslationResult(env, task, exact, source.name || `source-${index + 1}.png`, index, target);
    if (pending?.key) await env.SUBMISSION_FILES.delete(pending.key).catch(() => {});

    const nextIndex = index + 1;
    task.resultKeys = [
        ...(Array.isArray(task.resultKeys) ? task.resultKeys.filter(item => item?.key !== stored.key) : []),
        stored
    ];
    task.status = nextIndex >= refKeys.length ? 'done' : 'processing';
    task.translationNextIndex = nextIndex;
    task.translationPendingResult = null;
    task.translationLastAttemptAt = new Date().toISOString();
    task.translationLastError = '';
    if (task.status === 'done') {
        task.completedAt = new Date().toISOString();
        task.completeNote = `图片语言转换完成：${translationLanguageName(task.translationLanguage)}`;
    }

    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
    return { done: task.status === 'done', stored };
}

export function buildTranslationPrompt(language, target) {
    const targetLanguage = ({
        en: 'English',
        fr: 'French',
        ja: 'Japanese',
        de: 'German'
    })[language] || 'English';
    return [
        `Translate all consumer-facing copy in this image into natural, accurate ${targetLanguage}.`,
        'Keep brand names, logos, product model names, SKU codes, numbers, measurements, and universally recognized symbols unchanged unless they are clearly part of a translatable sentence.',
        'Replace the original copy in place. Preserve the original meaning, information completeness, text hierarchy, font style, weight, size, color, alignment, spacing, line breaks, and visual position as closely as possible.',
        'Preserve every non-text element exactly, including the product, people, background, composition, colors, materials, lighting, shadows, decorations, icons, and layout.',
        'Do not add, remove, crop, stretch, recompose, retouch, recolor, or simplify any content. Do not add explanations, borders, logos, or watermarks.',
        `The final image must keep the original aspect ratio and be suitable for exact restoration to ${target.width}x${target.height}px.`,
        'Return only one final image in JPEG format with an opaque background.'
    ].join('\n');
}

function normalizeTranslationTarget(value) {
    const width = Number(value?.width);
    const height = Number(value?.height);
    if (!Number.isInteger(width) || !Number.isInteger(height)
        || width < 1 || width > 10000 || height < 1 || height > 10000) {
        throw new Error('Invalid original image dimensions');
    }
    return { width, height };
}

async function processResizeAiTask(env, task) {
    if (!env.SUBMISSION_FILES) throw new Error('R2 storage not configured');
    if (task.status === 'done' && Array.isArray(task.resultKeys) && task.resultKeys.length) return { done: true };

    const refKeys = Array.isArray(task.refKeys) ? task.refKeys : [];
    const source = refKeys[0];
    if (!source?.key) throw new Error('Resize source image not found');

    const target = parseResizeTarget(task.resizeTarget || task.size || '1464x600');
    const sourceObject = await env.SUBMISSION_FILES.get(source.key);
    if (!sourceObject) throw new Error('Resize source image missing');

    const mimeType = sourceObject.httpMetadata?.contentType || guessContentType(source.name || source.key);
    const base64 = arrayBufferToBase64(await sourceObject.arrayBuffer());
    const prompt = buildResizePrompt(target, task.resizeReflow === true, task.aPlusDouble === true);
    const result = await editImageWithPrompt({
        env,
        prompt,
        mimeType,
        base64,
        maxBytes: 20 * 1024 * 1024
    });
    const stored = await storeResizeAiResult(env, task, result, source.name || 'resize-source.png', target);

    task.resultKeys = stored;
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.completeNote = task.aPlusDouble === true
        ? 'A+ 连续双图尺寸修改完成：600 × 900，已拆成上下两张 600 × 450'
        : `AI 尺寸修改完成：${target.width} × ${target.height}`;
    task.backgroundLastAttemptAt = new Date().toISOString();
    task.backgroundLastError = '';

    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
    return { done: true, stored };
}

async function processWatermarkTask(env, task) {
    if (!env.SUBMISSION_FILES) throw new Error('R2 storage not configured');
    if (task.status === 'done' && Array.isArray(task.resultKeys) && task.resultKeys.length) return { done: true };

    const source = Array.isArray(task.refKeys) ? task.refKeys[0] : null;
    if (!source?.key) throw new Error('Watermark source image not found');
    const sourceObject = await env.SUBMISSION_FILES.get(source.key);
    if (!sourceObject) throw new Error('Watermark source image missing');

    const mimeType = sourceObject.httpMetadata?.contentType || guessContentType(source.name || source.key);
    const base64 = arrayBufferToBase64(await sourceObject.arrayBuffer());
    const prompt = buildWatermarkPrompt(task.watermarkType, task.watermarkText);
    const result = await editImageWithPrompt({
        env,
        prompt,
        mimeType,
        base64,
        maxBytes: 15 * 1024 * 1024
    });
    const stored = await storeWatermarkResult(env, task, result, source.name || 'watermark-source.png');

    task.resultKeys = [stored];
    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.completeNote = task.watermarkType === 'other'
        ? `去水印完成：${String(task.watermarkText || '').slice(0, 80)}`
        : '豆包水印去除完成';
    task.backgroundLastAttemptAt = new Date().toISOString();
    task.backgroundLastError = '';
    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
    return { done: true, stored };
}

export function buildWatermarkPrompt(type, watermarkText) {
    const safeWatermarkText = String(watermarkText || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/"/g, "'")
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 80);
    const target = type === 'other'
        ? `the watermark text or watermark mark that reads exactly "${safeWatermarkText}"`
        : 'the Doubao watermark, including any small Doubao icon and text such as "豆包", "豆包AI生成", or equivalent Doubao-generated watermark';
    return [
        `Remove only ${target} from the uploaded image.`,
        'Precisely reconstruct the pixels hidden behind that watermark so the repaired area blends naturally with the surrounding background, texture, lighting, gradients, and edges.',
        'Preserve every other element exactly, including the product, people, composition, colors, materials, shadows, normal copy, titles, labels, logos, brand marks, UI elements, and all text that is not the specified watermark.',
        'Do not crop, resize, recompose, retouch, recolor, rewrite text, remove unrelated content, or add any new object, text, border, logo, or watermark.',
        'Keep the original aspect ratio and visual resolution. Return only one final image in JPEG format with an opaque background.'
    ].join('\n');
}

export function buildResizePrompt(target, allowReflow, aPlusDouble = false) {
    return [
        `Resize and adapt the uploaded image to exactly ${target.width}x${target.height}px.`,
        aPlusDouble
            ? 'This is a vertically joined two-panel A+ composition. Preserve a continuous layout across the horizontal midpoint because the final image will be split into equal upper and lower panels after processing.'
            : '',
        allowReflow
            ? 'Intelligently recompose the image for the target aspect ratio. Adapt the subject scale and position, spacing, background extension, and visual hierarchy so the layout feels balanced and intentional.'
            : 'Keep the original composition intent as much as possible and only make the changes necessary for the target size.',
        'Preserve every original product detail, subject, color, material, text, logo, and lighting style exactly.',
        allowReflow
            ? 'Avoid stretching, hard cropping, awkward empty areas, duplicated elements, or unrelated additions.'
            : 'Avoid stretching, unnecessary cropping, duplicated elements, or unrelated additions.',
        'Use a clean ecommerce-quality result. Do not add watermarks, frames, captions, extra text, or unrelated objects.',
        'Return only one final image in JPEG format with an opaque background.'
    ].filter(Boolean).join('\n');
}

async function storeResizeAiResult(env, task, result, sourceName, target) {
    const fetched = await resultToBytes(result);
    const exact = await transformToExactJpeg(env, fetched, target);
    const safeName = sanitizeName(String(sourceName || 'resize-source.png').replace(/\.[^.]+$/, ''));
    if (task.aPlusDouble === true) {
        if (target.width !== 600 || target.height !== 900) {
            throw new Error('A+ 连续双图尺寸修改必须使用 600x900 输出');
        }
        return storeAPlusResizeParts(env, task, exact, safeName);
    }
    const key = `studio-results/${task.id}/resize-${target.width}x${target.height}-${safeName}.jpg`;
    await env.SUBMISSION_FILES.put(key, exact.bytes, {
        httpMetadata: { contentType: 'image/jpeg' }
    });
    return [{ key, name: `${safeName}-尺寸修改-${target.width}x${target.height}.jpg` }];
}

async function storeAPlusResizeParts(env, task, image, safeName) {
    const target = { width: 600, height: 450 };
    const [top, bottom] = await Promise.all([
        transformToExactJpeg(env, image, target, 'top'),
        transformToExactJpeg(env, image, target, 'bottom')
    ]);
    const parts = [
        { position: 'top', label: '上半部分', image: top },
        { position: 'bottom', label: '下半部分', image: bottom }
    ];
    const stored = [];
    for (const part of parts) {
        const key = `studio-results/${task.id}/resize-600x450-${part.position}-${safeName}.jpg`;
        await env.SUBMISSION_FILES.put(key, part.image.bytes, {
            httpMetadata: { contentType: 'image/jpeg' }
        });
        stored.push({ key, name: `${safeName}-尺寸修改-600x450-${part.label}.jpg` });
    }
    return stored;
}

export async function transformToExactJpeg(env, image, target, gravity = '') {
    if (env.IMAGE_RESIZER?.fetch && (!env.IMAGES?.input || !env.IMAGES?.info)) {
        const query = new URLSearchParams({ width: String(target.width), height: String(target.height) });
        if (gravity) query.set('gravity', gravity);
        const url = `https://image-resizer.internal/resize?${query.toString()}`;
        const response = await env.IMAGE_RESIZER.fetch(new Request(url, {
            method: 'POST',
            headers: { 'Content-Type': image.mimeType },
            body: image.bytes
        }));
        if (!response.ok) throw new Error(`Exact image resize failed: HTTP ${response.status}`);
        const width = Number(response.headers.get('X-Image-Width'));
        const height = Number(response.headers.get('X-Image-Height'));
        if (width !== target.width || height !== target.height) {
            throw new Error(`Exact image resize mismatch: ${width}x${height}`);
        }
        const bytes = await response.arrayBuffer();
        if (detectImageMimeType(bytes, '') !== 'image/jpeg') {
            throw new Error('Exact image resize did not return JPEG bytes');
        }
        return { bytes, mimeType: 'image/jpeg' };
    }

    if (!env.IMAGES?.input || !env.IMAGES?.info) {
        throw new Error('Exact image resizing is not configured');
    }

    const transformed = await env.IMAGES
        .input(new Blob([image.bytes], { type: image.mimeType }).stream())
        .transform({ width: target.width, height: target.height, fit: 'cover', ...(gravity ? { gravity } : {}) })
        .output({ format: 'image/jpeg', quality: 100 });
    const response = transformed.response();
    if (!response.ok) throw new Error(`Exact image resize failed: HTTP ${response.status}`);

    const bytes = await response.arrayBuffer();
    if (detectImageMimeType(bytes, '') !== 'image/jpeg') {
        throw new Error('Exact image resize did not return JPEG bytes');
    }
    const info = await env.IMAGES.info(new Blob([bytes], { type: 'image/jpeg' }).stream());
    if (info.width !== target.width || info.height !== target.height) {
        throw new Error(`Exact image resize mismatch: ${info.width}x${info.height}`);
    }
    return { bytes, mimeType: 'image/jpeg' };
}

export function parseResizeTarget(value) {
    const match = String(value || '').match(/(\d{3,5})\s*[x×*]\s*(\d{3,5})/i);
    if (!match) return { width: 1464, height: 600 };
    return { width: Number(match[1]), height: Number(match[2]) };
}

async function storeVariantResult(env, task, result, sourceName, index) {
    const fetched = await resultToBytes(result);
    const ext = extensionFromMime(fetched.mimeType);
    const safeName = sanitizeName(String(sourceName || `variant-${index + 1}.png`).replace(/\.[^.]+$/, ''));
    const key = `studio-results/${task.id}/variant-${index + 1}-${safeName}.${ext}`;
    await env.SUBMISSION_FILES.put(key, fetched.bytes, {
        httpMetadata: { contentType: fetched.mimeType }
    });
    return { key, name: `${safeName}-变体改色-${index + 1}.${ext}` };
}

async function storeTranslationResult(env, task, image, sourceName, index, target) {
    const safeName = sanitizeName(String(sourceName || `translation-${index + 1}.png`).replace(/\.[^.]+$/, ''));
    const language = translationLanguageName(task.translationLanguage);
    const key = `studio-results/${task.id}/translation-${index + 1}-${target.width}x${target.height}-${safeName}.jpg`;
    await env.SUBMISSION_FILES.put(key, image.bytes, {
        httpMetadata: { contentType: 'image/jpeg' }
    });
    return {
        key,
        name: `${safeName}-${language}-${index + 1}-${target.width}x${target.height}.jpg`,
        width: target.width,
        height: target.height
    };
}

async function storeWatermarkResult(env, task, result, sourceName) {
    const fetched = await resultToBytes(result);
    const ext = extensionFromMime(fetched.mimeType);
    const safeName = sanitizeName(String(sourceName || 'watermark-source.png').replace(/\.[^.]+$/, ''));
    const key = `studio-results/${task.id}/watermark-${safeName}.${ext}`;
    await env.SUBMISSION_FILES.put(key, fetched.bytes, {
        httpMetadata: { contentType: fetched.mimeType }
    });
    return { key, name: `${safeName}-去水印.${ext}` };
}

async function resultToBytes(result) {
    if (result?.dataUrl) {
        const match = String(result.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
        if (!match) throw new Error('Invalid variant data URL');
        const bytes = base64ToBytes(match[2]);
        return { mimeType: detectImageMimeType(bytes, match[1]), bytes };
    }
    if (result?.url) {
        const response = await fetch(result.url);
        if (!response.ok) throw new Error('Variant result image download failed');
        const bytes = await response.arrayBuffer();
        return {
            mimeType: detectImageMimeType(bytes, response.headers.get('content-type') || result.mimeType),
            bytes
        };
    }
    throw new Error('Variant result image missing');
}

function detectImageMimeType(buffer, fallback = 'image/png') {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'image/webp';
    return String(fallback || '').split(';')[0] || 'image/png';
}

async function notifyUserDone(env, task, origin) {
    const token = await getAccessToken(env);
    const staffId = await getStaffId(token, task.submitter.unionId);
    if (!staffId) throw new Error('No staff id');
    const resultCount = Array.isArray(task.resultKeys) ? task.resultKeys.length : 0;
    const modeText = task.mode === 'resize_ai'
        ? `尺寸修改已完成${task.resizeTarget ? '：' + task.resizeTarget : ''}`
        : task.mode === 'watermark'
            ? '去水印已完成'
            : task.mode === 'translate_image'
                ? `图片语言转换已完成：${translationLanguageName(task.translationLanguage)}`
            : '变体改色已完成';
    const content = `图片制作完成 ✅\n\n${modeText}，共 ${resultCount} 张。\n请到网站查看下载：${origin}/studio-tasks.html`;
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [staffId],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
    if (!response.ok) throw new Error(`DingTalk text message failed: ${response.status}`);
    await sendStudioResultImages(env, token, staffId, task, origin);
    return response;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function sanitizeName(name) {
    return name.replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '_').slice(0, 80) || 'variant';
}

function translationLanguageName(value) {
    return ({ en: '英语', fr: '法语', ja: '日语', de: '德语' })[value] || '英语';
}

function guessContentType(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
    return map[ext] || 'image/png';
}

function extensionFromMime(mimeType) {
    return String(mimeType || '').includes('jpeg') ? 'jpg' : String(mimeType || '').includes('webp') ? 'webp' : 'png';
}

function buildRpaPayload(task, origin) {
    const toUrls = (keys) => (keys || []).map(k => ({
        name: k.name,
        url: origin + '/api/public-image/' + encodeKeyToken(k.key)
    }));

    const productUrls = toUrls(task.productKeys);
    const refUrls = toUrls(task.refKeys);
    const modelUrls = toUrls(task.modelKeys);
    const allImageUrls = [...productUrls, ...refUrls].map(x => x.url).filter(Boolean);

    let pickedSize;
    if (task.mode === 'retouch' || task.mode === 'cutout') {
        const sourceImageUrl = refUrls[0]?.url;
        if (!sourceImageUrl) throw new Error(task.mode === 'cutout' ? 'Cutout image not found' : 'Retouch image not found');
        return {
            pickedSize: '',
            payload: {
                params: {
                    "待处理图片链接": sourceImageUrl,
                    "任务ID": task.id,
                    ...(task.mode === 'cutout' ? { "处理类型": task.cutoutMode === 'vector' ? '矢量图白底' : '普通白底' } : {})
                }
            }
        };
    }

    if (task.mode === 'program') {
        pickedSize = normalizeStudioSize(task.size, task.desc || '');
        return {
            pickedSize,
            payload: {
                params: createProgramRpaParams({
                    task,
                    productName: task.productName || '-',
                    title: task.title || '-',
                    subtitle: task.subtitle || '-',
                    otherText: task.otherText || '-',
                    referenceUrl: refUrls[0]?.url,
                    productUrls,
                    sizeRequirement: formatSizeRequirement(pickedSize)
                })
            }
        };
    }

    const userDesc = [task.desc, task.want, task.note].filter(Boolean).join('；');
    pickedSize = normalizeStudioSize(task.size, userDesc);
    const sizeInfo = pickedSize ? '尺寸我要' + formatSizeRequirement(pickedSize) : '';
    const cleanUserDesc = userDesc.replace(/@参考图(\d+)/g, '参考图片$1').replace(/@图片(\d+)/g, '参考图片$1');
    const referenceInfo = allImageUrls.length ? allImageUrls.map((url, i) => '图' + (i + 1) + '链接 ' + url).join(' ') : '';
    const modelInfo = modelUrls.length ? modelUrls.map(x => '请参考我上传的人物图片，保留人物的脸型、发型、五官特征和整体气质，不参考原图的姿势、动作、手部位置、身体角度和构图，身体动作真实、稳定、符合日常生活，身体姿势自然。人物链接： ' + x.url).join(' ') : '';
    const sceneInfo = task.scene ? '场景要求：' + task.scene : '';
    const userNeed = cleanUserDesc ? '我需要：' + cleanUserDesc : '';
    const imageNameInfo = task.imageName ? '图片命名为"' + String(task.imageName).replace(/[\r\n]+/g, ' ').trim() + '"' : '';
    const descText = [referenceInfo, modelInfo, sceneInfo, sizeInfo, '请只生成一张图片', userNeed, imageNameInfo]
        .filter(Boolean).join(' ').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

    return {
        pickedSize,
        payload: {
            params: {
                "描述": descText,
                "任务ID": task.id,
                "尺寸要求": formatSizeRequirement(pickedSize)
            }
        }
    };
}

function encodeKeyToken(key) {
    const bytes = new TextEncoder().encode(String(key || ''));
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeStudioSize(size, desc) {
    const fromSize = extractDimension(size);
    if (fromSize) return fromSize;
    const rawSize = String(size || '');
    if (/4\s*K/i.test(rawSize)) return '4K';
    if (/2\s*K|自动识别/i.test(rawSize)) return '2K 自动识别';
    const text = String(desc || '');
    const fromDesc = extractDimension(text);
    if (fromDesc) return fromDesc;
    if (/A\+|16\s*[:：]\s*9/i.test(text)) return '1464x600';
    return '2K 自动识别';
}

function extractDimension(text) {
    const match = String(text || '').match(/\b\d{3,5}\s*[x×*]\s*\d{3,5}\b/);
    return match ? match[0].replace(/[×*]/g, 'x').replace(/\s+/g, '') : '';
}

function formatSizeRequirement(size) {
    const value = size || '2K 自动识别';
    return /\d{3,5}x\d{3,5}/.test(value) ? value + 'px' : value;
}

function studioModeText(mode) {
    if (mode === 'retouch') return '精修图片';
    if (mode === 'cutout') return '白底抠图';
    if (mode === 'variant') return '变体改色';
    if (mode === 'translate_image') return '转换语言';
    if (mode === 'resize_ai') return '尺寸修改';
    if (mode === 'watermark') return '去水印';
    return mode === 'free' ? '自由模式' : '程序模式';
}

function isDirectImageTask(mode) {
    return mode === 'variant' || mode === 'translate_image' || mode === 'resize_ai' || mode === 'watermark';
}

async function resendStudioTaskAfterResultTimeout(env, task, origin) {
    const webhookUrl = await resolveRpaWebhookUrl(env, task);
    let payload = task.rpaSentPayload;
    let pickedSize = '';

    if (!payload?.params) {
        const built = buildRpaPayload(task, origin);
        payload = built.payload;
        pickedSize = built.pickedSize;
        if (task.mode === 'free' && taskNeedsRpaTranslation(task)) {
            payload.params["描述"] = await translateForRpa(env, payload.params["描述"]);
        } else if (task.mode === 'program') {
            const translatedFields = await translateProgramFieldsForRpa(env, {
                productName: task.noProductImage === true ? '-' : (task.productName || '-'),
                title: task.title || '-',
                subtitle: task.subtitle || '-',
                otherText: task.otherText || '-'
            });
            if (task.noProductImage !== true) payload.params["产品名称"] = translatedFields.productName;
            payload.params["标题"] = translatedFields.title;
            payload.params["副标题"] = translatedFields.subtitle;
            payload.params["其他文案"] = translatedFields.otherText;
        }
    }

    const response = await fetchWithTimeout(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }, 12000);
    const responseText = await response.text();
    if (!response.ok) throw new Error(`RPA webhook HTTP ${response.status}: ${responseText.slice(0, 300)}`);

    const retriedAt = new Date().toISOString();
    task.status = 'processing';
    task.sentToRpa = true;
    task.sentToRpaAt = retriedAt;
    task.resultTimeoutRetriedAt = retriedAt;
    task.resultTimeoutRetryError = '';
    task.autoRpaLastAttemptAt = retriedAt;
    task.autoRpaLastResponse = responseText.slice(0, 300);
    task.rpaSentPayload = payload;
    if (!task.size && pickedSize) task.size = pickedSize;
    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
}

async function resolveRpaWebhookUrl(env, task) {
    if (task.mode === 'program') {
        return await safeKvGet(env.SUBMISSIONS, 'studio:rpaWebhookUrl:program')
            || env.RPA_WEBHOOK_URL_PROGRAM
            || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a3a40ac622e84b667229fde/invoke';
    }
    if (task.mode === 'cutout') {
        return env.RPA_WEBHOOK_URL_CUTOUT
            || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a573bbfc272480ce63d81d4/invoke';
    }
    if (task.mode === 'free') {
        return env.RPA_WEBHOOK_URL_FREE
            || await safeKvGet(env.SUBMISSIONS, 'studio:rpaWebhookUrl:free')
            || 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a31134a622e84b6672263ee/invoke';
    }
    throw new Error(`不支持自动重发的任务模式：${task.mode || 'unknown'}`);
}

async function markTaskOverdue(env, task, reason) {
    const shouldNotify = !isAdminLibraryCutoutTask(task)
        && !task.silent
        && env.DINGTALK_APPKEY
        && env.DINGTALK_APPSECRET
        && env.ADMIN_USER_ID;
    let notified = false;

    if (shouldNotify) {
        try {
            await notifyOverdue(env, task, reason);
            task.overdueNotified = true;
            task.overdueNotifiedAt = new Date().toISOString();
            notified = true;
        } catch (error) {
            console.error('Notify overdue failed:', task.id, error.message);
        }
    } else {
        task.overdueNotified = true;
        task.overdueNotifiedAt = new Date().toISOString();
    }

    await env.SUBMISSIONS.put(task.id, JSON.stringify(task), studioTaskPutOptions(task));
    return { notified, settled: task.overdueNotified === true };
}

async function notifyAutoSent(env, task) {
    const token = await getAccessToken(env);
    const modeText = studioModeText(task.mode);
    const submitterName = task.submitter?.name || '匿名';
    const desc = task.desc ? task.desc.slice(0, 50) + (task.desc.length > 50 ? '...' : '') : '-';
    const content = `✅ 图片制作任务已自动发送\n\n任务 ID：${task.id}\n模式：${modeText}\n提交人：${submitterName}\n描述：${desc}\n\n已自动发送到 RPA，请等待出图。`;
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
    if (!response.ok) throw new Error(`DingTalk HTTP ${response.status}`);
    return response;
}

async function notifyOverdue(env, task, reason = 'twice') {
    const token = await getAccessToken(env);
    const modeText = studioModeText(task.mode);
    const timeoutMinutes = studioRpaTimeoutMinutes(task);
    const detail = reason === 'retouch'
        ? '精修任务已等待 30 分钟仍未收到成品图。系统没有自动重发，任务继续保留在处理队列。'
        : reason === 'retry_failed'
            ? `首次发送 ${timeoutMinutes} 分钟未收到成品图，自动重发时又发生错误。系统已停止继续自动重发，任务继续保留在处理队列。`
            : `首次发送和自动重发后，连续两次各等待 ${timeoutMinutes} 分钟仍未收到成品图。系统已停止继续自动重发，任务继续保留在处理队列。`;
    const content = `⏰ RPA 任务超时提醒\n\n任务 ID：${task.id}\n模式：${modeText}\n提交人：${task.submitter?.name || '匿名'}\n${detail}\n\n请检查 RPA 执行情况，必要时在管理台手动重新发送。`;
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
    if (!response.ok) throw new Error(`DingTalk HTTP ${response.status}`);
    return response;
}

async function getAccessToken(env) {
    const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: env.DINGTALK_APPKEY, appSecret: env.DINGTALK_APPSECRET })
    });
    const data = await res.json();
    if (!data.accessToken) throw new Error('Token failed');
    return data.accessToken;
}

async function getStaffId(accessToken, unionId) {
    const res = await fetch(`https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unionid: unionId })
    });
    const data = await res.json();
    if (data.errcode !== 0) throw new Error('getStaffId failed: ' + data.errmsg);
    return data.result?.userid;
}
