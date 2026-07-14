import { generateAiText } from '../_shared/ai-text.js';
import { buildOptimizeRequest, sanitizeOptimizedPrompt } from './optimize-prompt.js';

export async function onRequestPost({ request, env }) {
    if (!env.AI_API_KEY) {
        return Response.json({ ok: false, error: 'AI 服务尚未配置' }, { status: 503 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ ok: false, error: '请求内容无效' }, { status: 400 });
    }

    const prompt = String(body.prompt || '').trim();
    if (prompt.length < 2) {
        return Response.json({ ok: false, error: '请先输入需要优化的关键词' }, { status: 400 });
    }
    if (prompt.length > 3000) {
        return Response.json({ ok: false, error: '关键词不能超过 3000 字' }, { status: 400 });
    }

    try {
        const optimized = sanitizeOptimizedPrompt(
            await generateAiText(env, buildOptimizeRequest(prompt))
        ).slice(0, 3000);
        if (!optimized) {
            return Response.json({ ok: false, error: 'AI 没有返回有效内容，请重试' }, { status: 502 });
        }
        return Response.json({ ok: true, optimized });
    } catch (error) {
        console.error('Admin prompt optimizer error', error?.status || '', error?.message || '');
        return Response.json({ ok: false, error: 'AI 优化失败，请稍后重试' }, { status: 503 });
    }
}
