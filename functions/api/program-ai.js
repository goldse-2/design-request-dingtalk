import { generateAiText } from '../_shared/ai-text.js';

const DAILY_LIMIT = 80;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
    if (!env.AI_API_KEY) return jsonError('AI 服务尚未配置', 503);
    if (!env.SUBMISSIONS) return jsonError('AI 次数统计尚未配置', 503);
    const sameOriginError = validateOrigin(request);
    if (sameOriginError) return sameOriginError;

    let body;
    try { body = await request.json(); }
    catch { return jsonError('请求内容无效', 400); }

    const action = String(body.action || '');
    const userId = String(body.userId || '').trim().slice(0, 160);
    if (!userId) return jsonError('请先登录后使用 AI 功能', 401);
    if (!['identify_product', 'generate_copy', 'extract_copy'].includes(action)) return jsonError('不支持的 AI 操作', 400);

    const image = body.imageKey
        ? await loadStoredImage(env, body.imageKey)
        : normalizeImage(body.image);
    if (image.error) return jsonError(image.error, 400);

    const quota = await consumeDailyQuota(env.SUBMISSIONS, userId);
    if (!quota.allowed) {
        return Response.json({ ok: false, error: 'AI 功能暂时不可用，请稍后再试' }, { status: 429 });
    }

    try {
        if (action === 'identify_product') {
            const raw = await generateAiText(env, {
                system: '你是电商产品视觉识别助手。只根据白底产品图识别产品，不猜测看不见的功能。仅输出一条简洁中文产品描述，格式为主要可见颜色或外观特征加具体产品类别，例如：一个黑色面板的美甲灯。控制在4到24个中文字符，不要标题、解释、Markdown、引号、句号或尺寸。',
                user: '请识别图片中的产品，并输出简洁产品描述。',
                images: [image],
                temperature: 0.1,
                maxTokens: 80,
                timeoutMs: 30000
            });
            const productName = sanitizeProductName(raw);
            if (!productName) throw new Error('AI 没有识别出有效产品名称');
            return Response.json({ ok: true, productName, remaining: quota.remaining, limit: DAILY_LIMIT });
        }

        if (action === 'extract_copy') {
            const raw = await generateAiText(env, {
                model: 'gpt-5.6-luna',
                system: '你是电商图片文字提取助手。只提取图片中真实可见的文案，严禁改写、翻译、润色、补充或猜测。按视觉层级区分主标题、副标题和其他文案。只返回严格 JSON，不要代码块或解释，格式必须为 {"title":"","subtitle":"","otherText":""}。只有能够明确判断为主标题或副标题的文字才能分别填入 title 或 subtitle；无法确定是否属于标题的文字必须放入 otherText。otherText 中的每段文字都必须标注图片内的具体位置，格式为“左上角：原文”“画面底部：原文”等，并按从上到下、从左到右的阅读顺序使用中文分号分隔。品牌 Logo 中的文字不提取；模糊、遮挡或无法确认的文字不要猜测。没有对应内容的字段返回空字符串。',
                user: '请逐字读取这张竞品图片中的可见文案，并按主标题、副标题和其他文案分类输出。',
                images: [image],
                temperature: 0,
                maxTokens: 600,
                timeoutMs: 35000
            });
            const copy = parseProgramCopy(raw);
            if (!copy.title && !copy.subtitle && !copy.otherText) throw new Error('图片中没有识别到可提取的文案');
            return Response.json({ ok: true, ...copy, remaining: quota.remaining, limit: DAILY_LIMIT });
        }

        const productName = cleanText(body.productName, 100) || '图中的产品';
        const raw = await generateAiText(env, {
            system: '你是资深电商视觉文案策划。仔细分析用户上传的参考图，并结合产品名称生成自然、具体、有信息量的中文电商文案。只返回严格 JSON，不要代码块或解释，格式必须为 {"title":"","subtitle":"","otherText":""}。title 为8到22字，用完整、有吸引力的短句提炼核心卖点；subtitle 为16到40字，进一步说明产品特点、使用利益或适用场景；otherText 必须生成3到5条完整卖点，每条12到30字，使用中文分号分隔，总长度不少于50个中文字符。每条卖点尽量同时包含一个可见的具体特点和它带来的用户好处，不要只罗列“57颗灯珠；环绕排列；清晰可见”这类过短词组。先根据参考图的构图、可用文字区域、视觉层级和留白判断详略，文字空间充足时应写得更完整，极简画面也至少保留3条有效卖点。标题、副标题和其他文案不得互相重复，不使用“精致设计”“品质升级”“便携实用”等空泛套话。优先准确使用参考图中可辨认的文字和数字；只写图片和产品名称能够支持的内容，不虚构功能、参数、品牌、尺寸或认证。',
            user: `产品名称：${productName}\n请仔细观察参考图中的产品结构、可见特点、已有文字、构图和文字区域，生成可以直接用于电商图片排版的完整标题、副标题和3到5条详细卖点。`,
            images: [image],
            temperature: 0.25,
            maxTokens: 600,
            timeoutMs: 35000
        });
        const copy = parseProgramCopy(raw);
        if (!copy.title && !copy.subtitle && !copy.otherText) throw new Error('AI 没有返回有效文案');
        return Response.json({ ok: true, ...copy, remaining: quota.remaining, limit: DAILY_LIMIT });
    } catch (error) {
        await restoreDailyQuota(env.SUBMISSIONS, quota);
        console.error('Program AI error', error?.status || '', error?.message || '');
        const message = error?.name === 'AbortError'
            ? 'AI 响应超时，请稍后重试'
            : error?.status >= 500
                ? 'AI 服务通道暂时不可用，请稍后重试'
                : error?.status
                    ? 'AI 服务请求失败，请检查接口余额或模型权限'
                    : String(error?.message || 'AI 识别失败，请稍后重试').slice(0, 100);
        return jsonError(message, 503);
    }
}

async function loadStoredImage(env, value) {
    const key = String(value || '').trim();
    if (!key.startsWith('studio/sheet-self/')) return { error: '不允许读取该图片' };
    if (!env.SUBMISSION_FILES) return { error: '图片存储尚未配置' };

    try {
        const object = await env.SUBMISSION_FILES.get(key);
        if (!object) return { error: '图片不存在，请重新上传' };
        const bytes = await object.arrayBuffer();
        if (bytes.byteLength > MAX_IMAGE_BYTES) return { error: '图片单张不能超过 8MB' };
        const mimeType = detectImageMimeType(bytes, object.httpMetadata?.contentType, key);
        if (!mimeType) return { error: '请选择 JPG、PNG 或 WebP 图片' };
        return normalizeImage({ mimeType, base64: arrayBufferToBase64(bytes) });
    } catch (error) {
        console.error('Program AI stored image error', error?.message || '');
        return { error: '读取图片失败，请重新上传后再试' };
    }
}

function detectImageMimeType(bytes, contentType, key) {
    const declared = String(contentType || '').toLowerCase().split(';')[0].trim();
    if (/^image\/(?:jpeg|png|webp)$/.test(declared)) return declared;
    const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
    if (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return 'image/jpeg';
    if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) return 'image/png';
    if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46
        && view[8] === 0x57 && view[9] === 0x45 && view[10] === 0x42 && view[11] === 0x50) return 'image/webp';
    if (/\.jpe?g$/i.test(key)) return 'image/jpeg';
    if (/\.png$/i.test(key)) return 'image/png';
    if (/\.webp$/i.test(key)) return 'image/webp';
    return '';
}

function arrayBufferToBase64(bytes) {
    const view = new Uint8Array(bytes);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < view.length; offset += chunkSize) {
        binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

function normalizeImage(value) {
    const mimeType = String(value?.mimeType || '').toLowerCase();
    const base64 = String(value?.base64 || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
    if (!/^image\/(?:jpeg|png|webp)$/i.test(mimeType)) return { error: '请选择 JPG、PNG 或 WebP 图片' };
    if (!base64 || !/^[a-z0-9+/]+={0,2}$/i.test(base64)) return { error: '图片内容无效，请重新上传' };
    const byteLength = Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    if (byteLength > MAX_IMAGE_BYTES) return { error: '图片单张不能超过 8MB' };
    return { mimeType, base64 };
}

function sanitizeProductName(value) {
    return String(value || '')
        .replace(/^```(?:text)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .replace(/^(?:产品名称|识别结果|描述)\s*[:：]\s*/i, '')
        .replace(/["'“”‘’。，.!！?？\r\n]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 50);
}

function parseProgramCopy(value) {
    const text = String(value || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            try { parsed = JSON.parse(match[0]); } catch {}
        }
    }
    if (!parsed || typeof parsed !== 'object') return { title: '', subtitle: '', otherText: '' };
    return {
        title: cleanText(parsed.title, 100),
        subtitle: cleanText(parsed.subtitle, 100),
        otherText: cleanText(parsed.otherText, 300)
    };
}

async function consumeDailyQuota(kv, userId) {
    const key = await quotaKey(userId);
    const count = Math.max(0, Number(await kv.get(key)) || 0);
    if (count >= DAILY_LIMIT) return { key, count, allowed: false, remaining: 0 };
    await kv.put(key, String(count + 1), { expirationTtl: 172800 });
    return { key, count, allowed: true, remaining: DAILY_LIMIT - count - 1, previousRemaining: DAILY_LIMIT - count };
}

async function restoreDailyQuota(kv, quota) {
    if (!quota?.allowed) return;
    if (quota.count === 0) await kv.delete(quota.key);
    else await kv.put(quota.key, String(quota.count), { expirationTtl: 172800 });
}

async function quotaKey(userId) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(userId)));
    const hash = [...new Uint8Array(digest)].slice(0, 12).map(value => value.toString(16).padStart(2, '0')).join('');
    return `program-ai-quota:${shanghaiDateKey()}:${hash}`;
}

function shanghaiDateKey() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function validateOrigin(request) {
    const origin = request.headers.get('Origin');
    const requestUrl = new URL(request.url);
    if (origin && (isSameHost(origin, requestUrl.host) || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin))) return null;
    const referer = request.headers.get('Referer');
    if (referer && isSameHost(referer, requestUrl.host)) return null;
    if (request.headers.get('Sec-Fetch-Site') === 'same-origin') return null;
    return jsonError('不允许跨站调用', 403);
}

function isSameHost(value, host) {
    try { return new URL(value).host === host; }
    catch { return false; }
}

function cleanText(value, maxLength) {
    return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, maxLength);
}

function jsonError(error, status) {
    return Response.json({ ok: false, error }, { status });
}
