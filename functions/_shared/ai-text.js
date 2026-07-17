const DEFAULT_API_BASE = 'https://jojocode.com';
const DEFAULT_MODEL = 'gpt-5.6-terra';

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

    const images = normalizeImages(options.images);
    const responsesInput = images.length
        ? [{
            role: 'user',
            content: [
                { type: 'input_text', text: String(options.user || '') },
                ...images.map(image => ({ type: 'input_image', image_url: image.dataUrl }))
            ]
        }]
        : options.user;
    const chatUserContent = images.length
        ? [
            { type: 'text', text: String(options.user || '') },
            ...images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } }))
        ]
        : options.user;

    const body = useResponses
        ? {
            model,
            instructions: options.system,
            input: responsesInput,
            max_output_tokens: options.maxTokens,
            store: false
        }
        : {
            model,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            messages: [
                { role: 'system', content: options.system },
                { role: 'user', content: chatUserContent }
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

function normalizeImages(images) {
    if (!Array.isArray(images)) return [];
    return images.slice(0, 2).map(image => {
        const mimeType = /^image\/(?:jpeg|png|webp|gif)$/i.test(String(image?.mimeType || ''))
            ? String(image.mimeType).toLowerCase()
            : 'image/jpeg';
        const base64 = String(image?.base64 || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
        return base64 ? { dataUrl: `data:${mimeType};base64,${base64}` } : null;
    }).filter(Boolean);
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
