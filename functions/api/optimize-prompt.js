const DEFAULT_API_BASE = 'https://jojocode.com';
const DEFAULT_MODEL = 'claude-opus-4-8';

export async function onRequestPost({ request, env }) {
    if (!env.AI_API_KEY) {
        return Response.json({ ok: false, error: 'AI 服务尚未配置' }, { status: 503 });
    }

    const origin = request.headers.get('Origin');
    const requestUrl = new URL(request.url);
    if (!origin || (new URL(origin).host !== requestUrl.host && !isLocalOrigin(origin))) {
        return Response.json({ ok: false, error: '不允许跨站调用' }, { status: 403 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ ok: false, error: '请求内容无效' }, { status: 400 });
    }

    const prompt = String(body.prompt || '').trim();
    if (prompt.length < 2) {
        return Response.json({ ok: false, error: '请先输入需要美化的提示词' }, { status: 400 });
    }
    if (prompt.length > 3000) {
        return Response.json({ ok: false, error: '提示词不能超过 3000 字' }, { status: 400 });
    }

    const size = String(body.size || '').slice(0, 80);
    const apiBase = String(env.AI_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
    const model = String(env.AI_TEXT_MODEL || DEFAULT_MODEL);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
        const response = await fetch(`${apiBase}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.AI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                temperature: 0.45,
                max_tokens: 1200,
                messages: [
                    {
                        role: 'system',
                        content: '你是专业电商视觉提示词编辑。把用户的原始描述优化为适合 GPT Image 2.0 的中文生图提示词。保留用户的产品、数量、文字内容、品牌要求和核心意图，不得擅自改变；补充清晰的主体、构图、场景、材质、光线、镜头、色彩、空间关系和电商画面质量要求。避免空泛形容词，避免解释、标题、Markdown、引号和负面提示词列表。只输出可直接用于生图的一段提示词，控制在 800 个中文字符内。'
                    },
                    {
                        role: 'user',
                        content: `目标尺寸：${size || '未指定'}\n原始提示词：${prompt}`
                    }
                ]
            }),
            signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const upstreamMessage = data?.error?.message || data?.message || '';
            console.error('Prompt optimizer upstream error', response.status, upstreamMessage);
            const message = response.status >= 500
                ? 'AI 服务通道暂时不可用，请稍后重试'
                : 'AI 服务请求失败，请检查接口余额或模型权限';
            return Response.json({ ok: false, error: message }, { status: 503 });
        }

        const optimized = extractText(data).trim().slice(0, 3000);
        if (!optimized) {
            return Response.json({ ok: false, error: 'AI 没有返回有效提示词，请重试' }, { status: 502 });
        }
        return Response.json({ ok: true, optimized });
    } catch (error) {
        const message = error?.name === 'AbortError'
            ? 'AI 响应超时，请稍后重试'
            : 'AI 服务连接失败，请稍后重试';
        return Response.json({ ok: false, error: message }, { status: 503 });
    } finally {
        clearTimeout(timeout);
    }
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
