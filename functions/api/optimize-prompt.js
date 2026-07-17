import { generateAiText } from '../_shared/ai-text.js';

const ACTION_LIMITS = { optimize: 30 };

export async function onRequestGet({ request, env }) {
    const sameOriginError = validateOrigin(request);
    if (sameOriginError) return sameOriginError;
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'AI 次数统计尚未配置' }, { status: 503 });
    }

    const userId = new URL(request.url).searchParams.get('userId');
    if (!userId) {
        return Response.json({ ok: false, error: '请先登录后使用 AI 功能' }, { status: 401 });
    }
    const optimizeQuota = await readDailyQuota(env.SUBMISSIONS, userId, 'optimize');
    return Response.json({
        ok: true,
        quotas: {
            optimize: { limit: ACTION_LIMITS.optimize, remaining: optimizeQuota.remaining }
        }
    });
}

export async function onRequestPost({ request, env }) {
    if (!env.AI_API_KEY) {
        return Response.json({ ok: false, error: 'AI 服务尚未配置' }, { status: 503 });
    }
    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'AI 次数统计尚未配置' }, { status: 503 });
    }
    const sameOriginError = validateOrigin(request);
    if (sameOriginError) return sameOriginError;

    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ ok: false, error: '请求内容无效' }, { status: 400 });
    }

    const prompt = String(body.prompt || '').trim();
    const userId = String(body.userId || '').trim();
    if (body.action === 'translate') {
        return Response.json({ ok: false, error: '英文翻译已改为提交 RPA 时自动处理' }, { status: 410 });
    }
    const action = 'optimize';
    if (!userId) {
        return Response.json({ ok: false, error: '请先登录后使用 AI 功能' }, { status: 401 });
    }
    if (prompt.length < 2) {
        return Response.json({ ok: false, error: '请先输入需要美化的提示词' }, { status: 400 });
    }
    const inputLimit = 3000;
    if (prompt.length > inputLimit) {
        return Response.json({ ok: false, error: `提示词不能超过 ${inputLimit} 字` }, { status: 400 });
    }

    const requestContent = buildOptimizeRequest(prompt);
    const actionLimit = ACTION_LIMITS[action];
    const quota = await consumeDailyQuota(env.SUBMISSIONS, userId, action);
    if (!quota.allowed) {
        return Response.json({
            ok: false,
            error: 'AI 功能暂时不可用，请稍后再试',
            action,
            limit: actionLimit,
            remaining: 0
        }, { status: 429 });
    }

    try {
        const optimized = sanitizeOptimizedPrompt(await generateAiText(env, requestContent)).slice(0, 3000);
        if (!optimized) {
            await restoreDailyQuota(env.SUBMISSIONS, quota);
            return Response.json({ ok: false, error: 'AI 没有返回有效提示词，请重试', remaining: quota.previousRemaining }, { status: 502 });
        }
        return Response.json({ ok: true, optimized, action, limit: actionLimit, remaining: quota.remaining });
    } catch (error) {
        await restoreDailyQuota(env.SUBMISSIONS, quota);
        console.error('Prompt optimizer upstream error', error?.status || '', error?.message || '');
        const message = error?.name === 'AbortError'
            ? 'AI 响应超时，请稍后重试'
            : error?.status >= 500
                ? 'AI 服务通道暂时不可用，请稍后重试'
                : error?.status
                    ? 'AI 服务请求失败，请检查接口余额或模型权限'
                    : 'AI 服务连接失败，请稍后重试';
        return Response.json({ ok: false, error: message, remaining: quota.previousRemaining }, { status: 503 });
    }
}

export function buildOptimizeRequest(prompt) {
    return {
        system: '你是专业电商视觉提示词编辑。把用户的原始描述优化为适合 GPT Image 2.0 的中文生图提示词。保留用户的产品、数量、文字内容、品牌要求和核心意图，不得擅自改变。禁止输出任何尺寸、像素、分辨率、画面比例或宽高信息。避免空泛形容词，避免解释、标题、Markdown、引号和负面提示词列表。只输出可直接用于生图的一段提示词，控制在 800 个中文字符内。',
        user: `原始提示词：${prompt}`,
        temperature: 0.45,
        maxTokens: 900
    };
}

function validateOrigin(request) {
    const origin = request.headers.get('Origin');
    const requestUrl = new URL(request.url);
    if (origin && (new URL(origin).host === requestUrl.host || isLocalOrigin(origin))) return null;
    const referer = request.headers.get('Referer');
    if (referer && new URL(referer).host === requestUrl.host) return null;
    if (request.headers.get('Sec-Fetch-Site') === 'same-origin') return null;
    return Response.json({ ok: false, error: '不允许跨站调用' }, { status: 403 });
}

export function sanitizeOptimizedPrompt(value) {
    return String(value || '')
        .replace(/(^|[^\d])\d{3,5}\s*(?:x|X|×|\*)\s*\d{3,5}\s*(?:px|PX|像素)?/g, '$1')
        .replace(/(^|[^\d])\d{1,2}\s*:\s*\d{1,2}(?=$|[^\d])/g, '$1')
        .replace(/(^|[\s,，。；;、（(【[])(?:[248]K|1080p|720p)(?=$|[\s,，。；;、）)】\]])/gi, '$1')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s*([，。；、,.])\s*/g, '$1')
        .replace(/[，,。；;、]{2,}/g, '，')
        .replace(/^[，。；、,.]+/, '')
        .replace(/\s*[，；、,]\s*$/g, '')
        .trim();
}

async function readDailyQuota(kv, userId, action) {
    const key = await quotaKey(userId, action);
    const limit = ACTION_LIMITS[action];
    const count = Math.max(0, Number(await kv.get(key)) || 0);
    return { key, count, limit, remaining: Math.max(0, limit - count) };
}

async function consumeDailyQuota(kv, userId, action) {
    const current = await readDailyQuota(kv, userId, action);
    if (current.count >= current.limit) return { ...current, allowed: false };
    const nextCount = current.count + 1;
    await kv.put(current.key, String(nextCount), { expirationTtl: 172800 });
    return {
        ...current,
        allowed: true,
        nextCount,
        previousRemaining: current.limit - current.count,
        remaining: current.limit - nextCount
    };
}

async function restoreDailyQuota(kv, quota) {
    if (!quota?.allowed) return;
    if (quota.count === 0) await kv.delete(quota.key);
    else await kv.put(quota.key, String(quota.count), { expirationTtl: 172800 });
}

async function quotaKey(userId, action) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId.slice(0, 200)));
    const hash = [...new Uint8Array(digest)].slice(0, 12).map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `ai-quota:${shanghaiDateKey()}:${hash}`;
}

function shanghaiDateKey() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

function isLocalOrigin(origin) {
    try {
        const host = new URL(origin).hostname;
        return host === '127.0.0.1' || host === 'localhost';
    } catch {
        return false;
    }
}
