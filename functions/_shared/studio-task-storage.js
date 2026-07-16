export const RECORD_RETENTION_DAYS = 20;
export const RECORD_RETENTION_SECONDS = RECORD_RETENTION_DAYS * 24 * 60 * 60;
export const RECORD_RETENTION_MS = RECORD_RETENTION_SECONDS * 1000;

export function studioTaskPutOptions(task, now = Date.now()) {
    const options = { metadata: studioTaskMetadata(task) };
    if (task.status !== 'done' && task.status !== 'rejected') return options;

    const anchor = studioTaskRetentionAnchor(task, now);
    options.expiration = Math.max(
        Math.floor(now / 1000) + 60,
        Math.floor(anchor / 1000) + RECORD_RETENTION_SECONDS
    );
    return options;
}

export function studioTaskRetentionAnchor(task, fallback = Date.now()) {
    const completedAt = Date.parse(task.completedAt || task.rejectedAt || '');
    if (Number.isFinite(completedAt)) return completedAt;
    const timestamp = Number(task.timestamp);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

export function studioTaskMetadata(task) {
    return {
        kind: 'studio',
        mode: task.mode,
        status: task.status,
        timestamp: task.timestamp,
        unionId: task.submitter?.unionId || '',
        sentToRpa: Boolean(task.sentToRpa),
        sentToRpaAt: task.sentToRpaAt || '',
        pausedAuto: Boolean(task.pausedAuto),
        overdueNotified: Boolean(task.overdueNotified),
        dingtalkNotified: Boolean(task.dingtalkNotified),
        r2AutoNotified: Boolean(task.r2AutoNotified),
        dingtalkNotificationState: task.dingtalkNotificationState || '',
        dingtalkNotificationStartedAt: task.dingtalkNotificationStartedAt || '',
        completedAt: task.completedAt || task.rejectedAt || ''
    };
}
