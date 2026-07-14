const DEFAULT_API_BASE = 'https://api.apikey.fun/v1';
const DEFAULT_MODEL = 'gpt-image-2';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export async function recolorImage({ env, scope, colorName, colorHex, mimeType, base64 }) {
    const apiKey = env.APIKEYFUN_API_KEY || env.AI_IMAGE_API_KEY;
    if (!apiKey) throw new Error('改色服务尚未配置');

    const safeScope = scope === 'background' ? 'background' : 'product';
    const safeColorName = String(colorName || '').trim().slice(0, 40);
    const safeColorHex = String(colorHex || '').trim().slice(0, 20);
    const safeMimeType = String(mimeType || 'image/png');
    const safeBase64 = String(base64 || '');

    if (!safeBase64 || !safeMimeType.startsWith('image/')) throw new Error('请上传图片文件');
    if (estimateBase64Bytes(safeBase64) > MAX_IMAGE_BYTES) throw new Error('图片单张不能超过 15MB');
    if (!safeColorName && !safeColorHex) throw new Error('请选择目标颜色');

    const prompt = buildPrompt(safeScope, safeColorName, safeColorHex)
        + '\nReturn the final image in JPEG format with an opaque background.';
    const apiBase = String(env.APIKEYFUN_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
    const model = String(env.APIKEYFUN_IMAGE_MODEL || DEFAULT_MODEL);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
        let { response, data } = await callResponsesApi({ apiBase, apiKey, model, prompt, mimeType: safeMimeType, base64: safeBase64, signal: controller.signal, withTool: true });
        if (!response.ok && response.status === 400) {
            ({ response, data } = await callResponsesApi({ apiBase, apiKey, model, prompt, mimeType: safeMimeType, base64: safeBase64, signal: controller.signal, withTool: false }));
        }
        if (!response.ok) {
            const error = data?.error?.message || data?.message || `AI HTTP ${response.status}`;
            throw new Error(normalizeUpstreamError(error));
        }

        const result = extractImageResult(data);
        if (!result) throw new Error('AI 没有返回图片，请重试');
        return result;
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('改色响应超时，请稍后重试');
        throw error;
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
    if (withTool) {
        body.tools = [{
            type: 'image_generation',
            output_format: 'jpeg',
            background: 'opaque'
        }];
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

function normalizeUpstreamError(message) {
    const text = String(message || '');
    if (/quota|balance|credit|insufficient/i.test(text)) return '改色接口余额不足或额度受限';
    if (/model|permission|not found/i.test(text)) return '改色模型不可用，请检查模型权限';
    return '改色服务请求失败，请稍后重试';
}
