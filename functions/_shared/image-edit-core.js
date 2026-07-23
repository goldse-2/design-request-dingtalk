const DEFAULT_API_BASE = 'https://api.apikey.fun/v1';
const DEFAULT_FALLBACK_API_BASE = 'https://jojocode.com';
const DEFAULT_MODEL = 'gpt-5.6-sol';
const modelAvailabilityCache = new Map();

export async function editImageWithPrompt({ env, prompt, mimeType, base64, maxBytes = 20 * 1024 * 1024 }) {
    const providers = imageProviders(env);
    if (!providers.length) throw new Error('AI image service is not configured');

    const safeMimeType = String(mimeType || 'image/png');
    const safeBase64 = String(base64 || '');
    if (!safeBase64 || !safeMimeType.startsWith('image/')) throw new Error('Image file is required');
    if (estimateBase64Bytes(safeBase64) > maxBytes) throw new Error('Image is too large');

    let lastError = new Error('AI image model is unavailable');
    for (const provider of providers) {
        const available = await providerHasModel(provider);
        if (available === false) {
            lastError = new Error('AI image model is unavailable');
            continue;
        }
        try {
            return await editImageWithProvider({
                ...provider,
                prompt,
                mimeType: safeMimeType,
                base64: safeBase64
            });
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

async function editImageWithProvider({ apiBase, apiKey, model, actorAuthorization, prompt, mimeType, base64 }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
        let { response, data } = await callResponsesApi({
            apiBase,
            apiKey,
            model,
            prompt,
            mimeType,
            base64,
            signal: controller.signal,
            actorAuthorization,
            toolMode: 'high'
        });
        if (!response.ok && shouldRetryWithBasicImageTool(response.status)) {
            ({ response, data } = await callResponsesApi({
                apiBase,
                apiKey,
                model,
                prompt,
                mimeType,
                base64,
                signal: controller.signal,
                actorAuthorization,
                toolMode: 'basic'
            }));
        }
        if (!response.ok && (response.status === 400 || response.status === 422)) {
            ({ response, data } = await callResponsesApi({
                apiBase,
                apiKey,
                model,
                prompt,
                mimeType,
                base64,
                signal: controller.signal,
                actorAuthorization,
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
    return [400, 422].includes(Number(status));
}

function imageProviders(env) {
    const providers = [];
    const primaryKey = env.APIKEYFUN_API_KEY || env.AI_IMAGE_API_KEY;
    if (primaryKey) {
        providers.push({
            apiKey: String(primaryKey),
            apiBase: String(env.APIKEYFUN_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, ''),
            model: String(env.APIKEYFUN_IMAGE_MODEL || DEFAULT_MODEL),
            actorAuthorization: ''
        });
    }
    const fallbackKey = env.AI_IMAGE_FALLBACK_API_KEY || env.AI_API_KEY;
    if (fallbackKey) {
        const fallback = {
            apiKey: String(fallbackKey),
            apiBase: String(env.AI_IMAGE_FALLBACK_API_BASE || env.AI_API_BASE || DEFAULT_FALLBACK_API_BASE).replace(/\/+$/, ''),
            model: String(env.AI_IMAGE_FALLBACK_MODEL || DEFAULT_MODEL),
            actorAuthorization: String(env.AI_API_ACTOR_AUTHORIZATION || '')
        };
        if (!providers.some(provider => provider.apiKey === fallback.apiKey && provider.apiBase === fallback.apiBase)) {
            providers.push(fallback);
        }
    }
    return providers;
}

async function providerHasModel(provider) {
    const cacheKey = `${provider.apiBase}\n${provider.apiKey}\n${provider.model}`;
    const cached = modelAvailabilityCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.available;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(buildEndpoint(provider.apiBase, 'models'), {
            headers: providerHeaders(provider),
            signal: controller.signal
        });
        if (!response.ok) return null;
        const data = await response.json().catch(() => ({}));
        const modelIds = Array.isArray(data?.data) ? data.data.map(item => String(item?.id || '')) : [];
        if (!modelIds.length) return null;
        const available = modelIds.includes(provider.model);
        modelAvailabilityCache.set(cacheKey, { available, expiresAt: Date.now() + 5 * 60 * 1000 });
        return available;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function providerHeaders(provider, includeContentType = false) {
    const headers = { 'Authorization': `Bearer ${provider.apiKey}` };
    if (includeContentType) headers['Content-Type'] = 'application/json';
    if (provider.actorAuthorization) headers['x-openai-actor-authorization'] = provider.actorAuthorization;
    return headers;
}

async function callResponsesApi({ apiBase, apiKey, model, actorAuthorization, prompt, mimeType, base64, signal, toolMode }) {
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
        headers: providerHeaders({ apiKey, actorAuthorization }, true),
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
