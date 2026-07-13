const DEFAULT_API_BASE = 'https://api.apikey.fun/v1';
const DEFAULT_MODEL = 'gpt-image-2';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
    const sameOriginError = validateOrigin(request);
    if (sameOriginError) return sameOriginError;

    const apiKey = env.APIKEYFUN_API_KEY || env.AI_IMAGE_API_KEY;
    if (!apiKey) {
        return Response.json({ ok: false, error: '改色服务尚未配置' }, { status: 503 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ ok: false, error: '请求内容无效' }, { status: 400 });
    }

    const image = body.image || {};
    const scope = body.scope === 'background' ? 'background' : 'product';
    const colorName = String(body.colorName || '').trim().slice(0, 40);
    const colorHex = String(body.colorHex || '').trim().slice(0, 20);
    const mimeType = String(image.mimeType || 'image/png');
    const base64 = String(image.base64 || '');

    if (!base64 || !mimeType.startsWith('image/')) {
        return Response.json({ ok: false, error: '请上传图片文件' }, { status: 400 });
    }
    if (estimateBase64Bytes(base64) > MAX_IMAGE_BYTES) {
        return Response.json({ ok: false, error: '图片单张不能超过 15MB' }, { status: 413 });
    }
    if (!colorName && !colorHex) {
        return Response.json({ ok: false, error: '请选择目标颜色' }, { status: 400 });
    }

    const prompt = buildPrompt(scope, colorName, colorHex);
    const apiBase = String(env.APIKEYFUN_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
    const model = String(env.APIKEYFUN_IMAGE_MODEL || DEFAULT_MODEL);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
        let { response, data } = await callResponsesApi({ apiBase, apiKey, model, prompt, mimeType, base64, signal: controller.signal, withTool: true });
        if (!response.ok && response.status === 400) {
            ({ response, data } = await callResponsesApi({ apiBase, apiKey, model, prompt, mimeType, base64, signal: controller.signal, withTool: false }));
        }
        if (!response.ok) {
            const error = data?.error?.message || data?.message || `AI HTTP ${response.status}`;
            return Response.json({ ok: false, error: normalizeUpstreamError(error) }, { status: 502 });
        }

        const result = extractImageResult(data);
        if (!result) {
            return Response.json({ ok: false, error: 'AI 没有返回图片，请重试' }, { status: 502 });
        }
        return Response.json({ ok: true, result });
    } catch (error) {
        const message = error?.name === 'AbortError' ? '改色响应超时，请稍后重试' : '改色服务连接失败，请稍后重试';
        return Response.json({ ok: false, error: message }, { status: 503 });
    } finally {
        clearTimeout(timeout);
    }
}

async function callResponsesApi({ apiBase, apiKey, model, prompt, mimeType, base64, signal, withTool }) {
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
    if (withTool) body.tools = [{ type: 'image_generation' }];
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

function buildPrompt(scope, colorName, colorHex) {
    const color = [colorName, colorHex].filter(Boolean).join(' ');
    if (scope === 'background') {
        return [
            `将图片背景改成 ${color}。`,
            '严格保持产品主体、产品颜色、材质、文字、logo、轮廓、角度和光影不变。',
            '只调整背景色和背景氛围，让画面自然、干净、适合电商展示。',
            '输出默认 2K 高清图片，不要添加水印、边框或额外文字。'
        ].join('\n');
    }
    return [
        `将图片中产品的主色改成 ${color}。`,
        '严格保持背景、构图、角度、文字、logo、产品形状、材质纹理和真实光影不变。',
        '只改变产品可见外观颜色，让颜色替换自然、边缘干净、细节完整。',
        '输出默认 2K 高清图片，不要添加水印、边框或额外文字。'
    ].join('\n');
}

function extractImageResult(data) {
    const candidates = [];
    collectImages(data, candidates);
    const image = candidates.find(Boolean);
    if (!image) return null;
    if (image.url) return { url: image.url, mimeType: image.mimeType || 'image/png' };
    const base64 = image.base64 || image.b64_json || image.image_base64;
    if (!base64) return null;
    const mimeType = image.mimeType || 'image/png';
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
        candidates.push({ base64: value.result, mimeType: 'image/png' });
    }
    if (value.type === 'output_image' || value.type === 'image') {
        candidates.push({
            url: value.url,
            base64: value.image_base64 || value.base64 || value.b64_json,
            mimeType: value.mime_type || value.mimeType || 'image/png'
        });
    }
    if (value.b64_json || value.image_base64 || value.base64 || value.url) {
        candidates.push({
            url: value.url,
            base64: value.b64_json || value.image_base64 || value.base64,
            mimeType: value.mime_type || value.mimeType || 'image/png'
        });
    }
    Object.keys(value).forEach(key => collectImages(value[key], candidates));
}

function buildEndpoint(apiBase, path) {
    return /\/v\d+$/i.test(apiBase) ? `${apiBase}/${path}` : `${apiBase}/v1/${path}`;
}

function estimateBase64Bytes(value) {
    const clean = value.replace(/\s/g, '');
    return Math.floor(clean.length * 3 / 4);
}

function normalizeUpstreamError(message) {
    const text = String(message || '');
    if (/quota|balance|credit|insufficient/i.test(text)) return '改色接口余额不足或额度受限';
    if (/model|permission|not found/i.test(text)) return '改色模型不可用，请检查模型权限';
    return '改色服务请求失败，请稍后重试';
}

function validateOrigin(request) {
    const origin = request.headers.get('Origin');
    const requestUrl = new URL(request.url);
    if (origin && new URL(origin).host === requestUrl.host) return null;
    const referer = request.headers.get('Referer');
    if (referer && new URL(referer).host === requestUrl.host) return null;
    if (request.headers.get('Sec-Fetch-Site') === 'same-origin') return null;
    return Response.json({ ok: false, error: '不允许跨站调用' }, { status: 403 });
}
