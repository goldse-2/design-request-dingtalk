const DEFAULT_API_BASE = 'https://api.apikey.fun/v1';
const DEFAULT_MODEL = 'gpt-image-2';

export async function editImageWithPrompt({ env, prompt, mimeType, base64, maxBytes = 20 * 1024 * 1024 }) {
    const apiKey = env.APIKEYFUN_API_KEY || env.AI_IMAGE_API_KEY;
    if (!apiKey) throw new Error('AI image service is not configured');

    const safeMimeType = String(mimeType || 'image/png');
    const safeBase64 = String(base64 || '');
    if (!safeBase64 || !safeMimeType.startsWith('image/')) throw new Error('Image file is required');
    if (estimateBase64Bytes(safeBase64) > maxBytes) throw new Error('Image is too large');

    const apiBase = String(env.APIKEYFUN_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
    const model = String(env.APIKEYFUN_IMAGE_MODEL || DEFAULT_MODEL);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
        let { response, data } = await callResponsesApi({
            apiBase,
            apiKey,
            model,
            prompt,
            mimeType: safeMimeType,
            base64: safeBase64,
            signal: controller.signal,
            toolMode: 'high'
        });
        if (!response.ok && shouldRetryWithBasicImageTool(response.status)) {
            ({ response, data } = await callResponsesApi({
                apiBase,
                apiKey,
                model,
                prompt,
                mimeType: safeMimeType,
                base64: safeBase64,
                signal: controller.signal,
                toolMode: 'basic'
            }));
        }
        if (!response.ok && (response.status === 400 || response.status === 422)) {
            ({ response, data } = await callResponsesApi({
                apiBase,
                apiKey,
                model,
                prompt,
                mimeType: safeMimeType,
                base64: safeBase64,
                signal: controller.signal,
                toolMode: 'none'
            }));
        }
        if (!response.ok) {
            const error = data?.error?.message || data?.message || `AI HTTP ${response.status}`;
            throw new Error(normalizeUpstreamError(error, response.status));
        }
        const result = extractImageResult(data);
        if (!result) throw new Error('AI did not return an image');
        return result;
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('AI image edit timed out');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function shouldRetryWithBasicImageTool(status) {
    return [400, 422, 500, 502, 503, 504].includes(Number(status));
}

async function callResponsesApi({ apiBase, apiKey, model, prompt, mimeType, base64, signal, toolMode }) {
    const body = {
        model,
        input: [{
            role: 'user',
            content: [
                { type: 'input_text', text: prompt },
                { type: 'input_image', image_url: `data:${mimeType};base64,${base64}` }
            ]
        }],
        store: false
    };
    if (toolMode !== 'none') {
        const imageTool = {
            type: 'image_generation',
            output_format: 'jpeg',
            background: 'opaque'
        };
        if (toolMode === 'high') {
            imageTool.quality = 'high';
            imageTool.input_fidelity = 'high';
            imageTool.output_compression = 100;
            imageTool.size = 'auto';
        }
        body.tools = [imageTool];
    }

    const response = await fetch(buildEndpoint(apiBase, 'responses'), {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
}

function extractImageResult(data) {
    const candidates = [];
    collectImages(data, candidates);
    const image = candidates.find(Boolean);
    if (!image) return null;
    if (image.url) return { url: image.url, mimeType: image.mimeType || 'image/png' };
    const base64 = image.base64 || image.b64_json || image.image_base64;
    if (!base64) return null;
    const mimeType = inferImageMimeType(base64, image.mimeType);
    return { dataUrl: `data:${mimeType};base64,${base64}`, mimeType };
}

function collectImages(value, candidates) {
    if (!value || candidates.length > 20) return;
    if (Array.isArray(value)) {
        value.forEach(item => collectImages(item, candidates));
        return;
    }
    if (typeof value !== 'object') return;
    if (value.type === 'image_generation_call' && value.result) {
        candidates.push({ base64: value.result, mimeType: inferImageMimeType(value.result) });
    }
    if (value.type === 'output_image' || value.type === 'image') {
        candidates.push({
            url: value.url,
            base64: value.image_base64 || value.base64 || value.b64_json,
            mimeType: inferImageMimeType(
                value.image_base64 || value.base64 || value.b64_json,
                value.mime_type || value.mimeType
            )
        });
    }
    if (value.b64_json || value.image_base64 || value.base64 || value.url) {
        candidates.push({
            url: value.url,
            base64: value.b64_json || value.image_base64 || value.base64,
            mimeType: inferImageMimeType(
                value.b64_json || value.image_base64 || value.base64,
                value.mime_type || value.mimeType
            )
        });
    }
    Object.keys(value).forEach(key => collectImages(value[key], candidates));
}

function inferImageMimeType(base64, fallback = 'image/png') {
    const value = String(base64 || '').replace(/\s/g, '');
    if (value.startsWith('/9j/')) return 'image/jpeg';
    if (value.startsWith('iVBOR')) return 'image/png';
    if (value.startsWith('UklGR')) return 'image/webp';
    return fallback || 'image/png';
}

function buildEndpoint(apiBase, path) {
    return /\/v\d+$/i.test(apiBase) ? `${apiBase}/${path}` : `${apiBase}/v1/${path}`;
}

function estimateBase64Bytes(value) {
    const clean = value.replace(/\s/g, '');
    return Math.floor(clean.length * 3 / 4);
}

function normalizeUpstreamError(message, status) {
    const text = String(message || '');
    if (/quota|balance|credit|insufficient/i.test(text)) return 'AI image quota or balance is insufficient';
    if (/model|permission|not found/i.test(text)) return 'AI image model is unavailable';
    const safeDetail = text
        .replace(/sk-[a-z0-9_-]+/gi, '[redacted]')
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    const statusText = Number.isInteger(status) ? ` (HTTP ${status})` : '';
    return safeDetail && !/^AI HTTP \d+$/i.test(safeDetail)
        ? `AI image edit request failed${statusText}: ${safeDetail}`
        : `AI image edit request failed${statusText}`;
}
