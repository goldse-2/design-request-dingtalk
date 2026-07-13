const DEFAULT_API_BASE = 'https://jojocode.com';
const DEFAULT_MODEL = 'claude-opus-4-7';

export async function generateAiText(env, options) {
    const apiBase = String(env.AI_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
    const model = String(env.AI_TEXT_MODEL || DEFAULT_MODEL);
    const mode = String(env.AI_API_MODE || 'chat_completions').toLowerCase();
    const useResponses = mode.includes('response');
    const endpoint = buildEndpoint(apiBase, useResponses ? 'responses' : 'chat/completions');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 45000);

    const headers = {
        'Authorization': `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json'
    };
    if (env.AI_API_ACTOR_AUTHORIZATION) {
        headers['x-openai-actor-authorization'] = String(env.AI_API_ACTOR_AUTHORIZATION);
    }

    const body = useResponses
        ? {
            model,
            instructions: options.system,
            input: options.user,
            max_output_tokens: options.maxTokens,
            store: false
        }
        : {
            model,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            messages: [
                { role: 'system', content: options.system },
                { role: 'user', content: options.user }
            ]
        };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data?.error?.message || data?.message || `AI HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return extractAiText(data).trim();
    } finally {
        clearTimeout(timeout);
    }
}

function buildEndpoint(apiBase, path) {
    return /\/v\d+$/i.test(apiBase) ? `${apiBase}/${path}` : `${apiBase}/v1/${path}`;
}

function extractAiText(data) {
    if (typeof data?.output_text === 'string') return data.output_text;

    const responseText = (data?.output || []).flatMap(item => item?.content || [])
        .map(content => content?.text || content?.output_text || '')
        .join('');
    if (responseText) return responseText;

    const chatContent = data?.choices?.[0]?.message?.content;
    if (typeof chatContent === 'string') return chatContent;
    if (Array.isArray(chatContent)) {
        return chatContent.map(part => part?.text || part?.content || '').join('');
    }
    return '';
}
