const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const ETA_REMINDER_INDEX_KEY = 'regular:eta-reminders:v1';
const ALLOWED_ETA_DAYS = new Set([0, 3, 8, 20, 30]);
const ETA_LABELS = new Map([
    [0, '当天'],
    [3, '3天'],
    [8, '8天'],
    [20, '20天内'],
    [30, '30天内']
]);
const LEGACY_ETA_DAYS = new Map([
    ['即刻', 0],
    ['当天', 0],
    ['3-5天', 3],
    ['3天', 3],
    ['8-15天', 8],
    ['8天', 8],
    ['20天', 20],
    ['20天内', 20],
    ['30天', 30],
    ['30天内', 30]
]);

export function normalizeEtaSelection(label, daysValue) {
    const numericDays = Number(daysValue);
    const days = ALLOWED_ETA_DAYS.has(numericDays)
        ? numericDays
        : LEGACY_ETA_DAYS.get(String(label || '').trim());
    if (!ALLOWED_ETA_DAYS.has(days)) return null;
    return { days, label: ETA_LABELS.get(days) };
}

export function createEtaDeadline(days, now = Date.now()) {
    if (!ALLOWED_ETA_DAYS.has(Number(days))) return 0;
    const shifted = new Date(now + SHANGHAI_OFFSET_MS);
    const shanghaiDayStart = Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate()
    );
    return shanghaiDayStart + (Number(days) + 1) * DAY_MS - SHANGHAI_OFFSET_MS;
}

export function shouldRunEtaReminderCheck(now = Date.now()) {
    return new Date(now).getUTCMinutes() < 3;
}

export async function scheduleEtaReminder(kv, submission) {
    const id = String(submission?.id || '').trim();
    const dueAt = Number(submission?.etaDueAt || 0);
    if (!id || !Number.isFinite(dueAt) || dueAt <= 0) return;

    const index = await readReminderIndex(kv);
    const next = index
        .filter(item => item.id !== id)
        .concat({ id, dueAt })
        .sort((a, b) => a.dueAt - b.dueAt)
        .slice(0, 500);
    await writeReminderIndex(kv, next);
}

export async function processDueEtaReminders(env, now = Date.now()) {
    const index = await readReminderIndex(env.SUBMISSIONS);
    if (!index.length) return { checked: true, pending: 0, due: 0, notified: 0, errors: [] };

    const future = index.filter(item => item.dueAt > now);
    const due = index.filter(item => item.dueAt <= now).slice(0, 10);
    const deferredDue = index.filter(item => item.dueAt <= now).slice(due.length);
    const retained = future.concat(deferredDue);
    const errors = [];
    let notified = 0;
    let accessToken = '';

    for (const item of due) {
        try {
            const raw = await env.SUBMISSIONS.get(item.id);
            if (!raw) continue;
            const submission = JSON.parse(raw);
            const currentDueAt = Number(submission.etaDueAt || 0);

            if (submission.archived || ['completed', 'rejected'].includes(submission.status)) continue;
            if (currentDueAt !== item.dueAt) {
                if (currentDueAt > now && !submission.etaOverdueNotifiedAt) {
                    retained.push({ id: item.id, dueAt: currentDueAt });
                }
                continue;
            }
            if (submission.etaOverdueNotifiedAt) continue;

            if (!env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET || !env.ADMIN_USER_ID) {
                throw new Error('DingTalk admin notification is not configured');
            }
            if (!accessToken) accessToken = await getAccessToken(env);
            await notifyAdminOverdue(accessToken, env, submission, item.dueAt);

            submission.etaOverdueNotifiedAt = new Date(now).toISOString();
            submission.etaOverdueReminderFor = item.dueAt;
            await env.SUBMISSIONS.put(submission.id, JSON.stringify(submission), {
                metadata: {
                    taskType: submission.taskType,
                    timestamp: submission.timestamp,
                    archived: false
                }
            });
            notified += 1;
        } catch (error) {
            retained.push(item);
            errors.push({ id: item.id, error: String(error?.message || error).slice(0, 200) });
        }
    }

    const next = dedupeReminderIndex(retained).sort((a, b) => a.dueAt - b.dueAt).slice(0, 500);
    if (JSON.stringify(next) !== JSON.stringify(index)) await writeReminderIndex(env.SUBMISSIONS, next);
    return { checked: true, pending: next.length, due: due.length, notified, errors };
}

async function readReminderIndex(kv) {
    const raw = await kv.get(ETA_REMINDER_INDEX_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return dedupeReminderIndex(Array.isArray(parsed) ? parsed : []);
    } catch {
        return [];
    }
}

async function writeReminderIndex(kv, index) {
    await kv.put(ETA_REMINDER_INDEX_KEY, JSON.stringify(index));
}

function dedupeReminderIndex(index) {
    const byId = new Map();
    for (const item of index) {
        const id = String(item?.id || '').trim();
        const dueAt = Number(item?.dueAt || 0);
        if (id && Number.isFinite(dueAt) && dueAt > 0) byId.set(id, { id, dueAt });
    }
    return Array.from(byId.values());
}

async function getAccessToken(env) {
    const response = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: env.DINGTALK_APPKEY, appSecret: env.DINGTALK_APPSECRET })
    });
    const data = await response.json();
    if (!response.ok || !data.accessToken) throw new Error('DingTalk access token failed');
    return data.accessToken;
}

async function notifyAdminOverdue(accessToken, env, submission, dueAt) {
    const productName = submission.data?.basicInfo?.['型号'] || submission.taskType || '未命名任务';
    const submitterName = submission.submitter?.name || '匿名';
    const dueDate = formatShanghaiDate(dueAt - 1);
    const origin = env.SITE_ORIGIN || 'https://design-request-dingtalk.pages.dev';
    const content = [
        '⏰ 任务预计完成时间已到',
        '',
        `产品：${productName}`,
        `任务类型：${submission.taskType || '-'}`,
        `提交人：${submitterName}`,
        `预计时间：${submission.eta || '-'}`,
        `截止日期：${dueDate}`,
        '当前状态：仍未完成',
        '',
        `去处理：${origin}/admin.html`
    ].join('\n');
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-acs-dingtalk-access-token': accessToken
        },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [env.ADMIN_USER_ID],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
    if (!response.ok) throw new Error(`DingTalk reminder HTTP ${response.status}`);
}

function formatShanghaiDate(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(timestamp));
}
