const DEFAULT_API_BASE = 'https://jojocode.com';
const DEFAULT_MODEL = 'claude-opus-4-7';
const ACTION_LIMITS = { optimize: 30, translate: 60 };

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
    const [optimizeQuota, translateQuota] = await Promise.all([
        readDailyQuota(env.SUBMISSIONS, userId, 'optimize'),
        readDailyQuota(env.SUBMISSIONS, userId, 'translate')
    ]);
    return Response.json({
        ok: true,
        quotas: {
            optimize: { limit: ACTION_LIMITS.optimize, remaining: optimizeQuota.remaining },
            translate: { limit: ACTION_LIMITS.translate, remaining: translateQuota.remaining }
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
    const action = body.action === 'translate' ? 'translate' : 'optimize';
    if (!userId) {
        return Response.json({ ok: false, error: '请先登录后使用 AI 功能' }, { status: 401 });
    }
    if (prompt.length < 2) {
        return Response.json({ ok: false, error: '请先输入需要美化的提示词' }, { status: 400 });
    }
    const inputLimit = action === 'translate' ? 8000 : 3000;
    if (prompt.length > inputLimit) {
        return Response.json({ ok: false, error: `${action === 'translate' ? '翻译内容' : '提示词'}不能超过 ${inputLimit} 字` }, { status: 400 });
    }

    const size = String(body.size || '').slice(0, 80);
    const requestContent = action === 'translate'
        ? {
            system: '你是专业的中英翻译。把用户输入忠实翻译成自然、准确、可直接使用的英文。保留产品名称、品牌、数字、单位、尺寸、专有名词和原有格式，不扩写、不美化、不解释。只输出英文译文，不要标题、引号或 Markdown。',
            user: prompt,
            temperature: 0.1,
            maxTokens: 10000
        }
        : {
            system: '你是专业电商视觉提示词编辑。把用户的原始描述优化为适合 GPT Image 2.0 的中文生图提示词。保留用户的产品、数量、文字内容、品牌要求和核心意图，不得擅自改变；补充清晰的主体、构图、场景、材质、光线、镜头、色彩、空间关系和电商画面质量要求。避免空泛形容词，避免解释、标题、Markdown、引号和负面提示词列表。只输出可直接用于生图的一段提示词，控制在 800 个中文字符内。',
            user: `目标尺寸：${size || '未指定'}\n原始提示词：${prompt}`,
            temperature: 0.45,
            maxTokens: 900
        };
    const apiBase = String(env.AI_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
    const model = String(env.AI_TEXT_MODEL || DEFAULT_MODEL);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    const actionLimit = ACTION_LIMITS[action];
    const quota = await consumeDailyQuota(env.SUBMISSIONS, userId, action);
    if (!quota.allowed) {
        clearTimeout(timeout);
        return Response.json({
            ok: false,
            error: '今日 AI 使用次数已用完，请明天再试',
            action,
            limit: actionLimit,
            remaining: 0
        }, { status: 429 });
    }

    try {
        const response = await fetch(`${apiBase}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.AI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                temperature: requestContent.temperature,
                max_tokens: requestContent.maxTokens,
                messages: [
                    {
                        role: 'system',
                        content: requestContent.system
                    },
                    {
                        role: 'user',
                        content: requestContent.user
                    }
                ]
            }),
            signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            await restoreDailyQuota(env.SUBMISSIONS, quota);
            const upstreamMessage = data?.error?.message || data?.message || '';
            console.error('Prompt optimizer upstream error', response.status, upstreamMessage);
            const message = response.status >= 500
                ? 'AI 服务通道暂时不可用，请稍后重试'
                : 'AI 服务请求失败，请检查接口余额或模型权限';
            return Response.json({ ok: false, error: message, remaining: quota.previousRemaining }, { status: 503 });
        }

        const optimized = extractText(data).trim().slice(0, action === 'translate' ? 8000 : 3000);
        if (!optimized) {
            await restoreDailyQuota(env.SUBMISSIONS, quota);
            return Response.json({ ok: false, error: 'AI 没有返回有效提示词，请重试', remaining: quota.previousRemaining }, { status: 502 });
        }
        return Response.json({ ok: true, optimized, action, limit: actionLimit, remaining: quota.remaining });
    } catch (error) {
        await restoreDailyQuota(env.SUBMISSIONS, quota);
        const message = error?.name === 'AbortError'
            ? 'AI 响应超时，请稍后重试'
            : 'AI 服务连接失败，请稍后重试';
        return Response.json({ ok: false, error: message, remaining: quota.previousRemaining }, { status: 503 });
    } finally {
        clearTimeout(timeout);
    }
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
    const prefix = action === 'translate' ? 'ai-quota-translate' : 'ai-quota';
    return `${prefix}:${shanghaiDateKey()}:${hash}`;
}

function shanghaiDateKey() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

function extractText(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(item => item?.text || '').join('\n');
    }
    return '';
}

function isLocalOrigin(origin) {
    try {
        const host = new URL(origin).hostname;
        return host === '127.0.0.1' || host === 'localhost';
    } catch {
        return false;
    }
}
