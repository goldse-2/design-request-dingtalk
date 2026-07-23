const INDEX_KEY = 'studio-guides-index-v1';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const CATEGORIES = new Set(['getting-started', 'faq']);
const BLOCK_TYPES = new Set(['heading', 'subheading', 'paragraph', 'image']);
const DEFAULT_ARTICLES = [
    {
        id: 'guide-default-quick-start', category: 'getting-started', title: '第一次使用：从选择模式到收到成品',
        subtitle: '了解自助处理台的基本提交步骤和完成后的收图方式。', published: true, cover: null,
        createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z',
        blocks: [
            { type: 'heading', text: '选择适合你的处理方式', fontSize: 30 },
            { type: 'paragraph', text: '进入自助处理台后，先选择自由模式、图生图模式、表格自助、精修图片、白底抠图或尺寸修改。不同模式需要的素材不同，页面会保留当前填写的内容，切换前请确认任务类型。', fontSize: 16 },
            { type: 'subheading', text: '提交前检查', fontSize: 22 },
            { type: 'paragraph', text: '确认图片已经上传完成，标题、文案和尺寸填写正确。图生图任务请上传竞品图片；有不同产品角度时上传不同角度，没有时可以使用相同角度。', fontSize: 16 },
            { type: 'subheading', text: '提交后无需停留在页面', fontSize: 22 },
            { type: 'paragraph', text: '任务完成后会通过钉钉通知并发送成品下载入口。关闭网页不会取消已经提交的任务，你也可以在“我的任务”中查看当前状态。', fontSize: 16 }
        ]
    },
    {
        id: 'guide-default-image-to-image', category: 'getting-started', title: '图生图模式怎么准备图片',
        subtitle: '竞品图片、产品白底图和摄影师拍摄功能的使用说明。', published: true, cover: null,
        createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z',
        blocks: [
            { type: 'heading', text: '先上传竞品图片', fontSize: 30 },
            { type: 'paragraph', text: '竞品图片决定构图、场景和排版方向。上传后可以使用“修改原图文案”，系统会识别图片中的标题、副标题和其他文案，识别结果会用中文显示，提交时再自动翻译为英语。', fontSize: 16 },
            { type: 'subheading', text: '再准备产品素材', fontSize: 22 },
            { type: 'paragraph', text: '正常任务需要产品白底图。没有白底图、需要补拍角度或无需产品时，可以开启对应选项；开启摄影师决定后，提交任务即可，不需要在页面等待拍摄完成。', fontSize: 16 },
            { type: 'subheading', text: '尺寸选择', fontSize: 22 },
            { type: 'paragraph', text: '自动识别会根据竞品图片匹配常用尺寸；自定义模式可以选择 2K、4K 或填写宽高。A+ 连续双图会按上下两部分处理，并在完成后分别导出。', fontSize: 16 }
        ]
    },
    {
        id: 'guide-default-sheet-self', category: 'getting-started', title: '表格自助：一次提交多张设计图',
        subtitle: '适合连续制作同一产品的多张电商图片。', published: true, cover: null,
        createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z',
        blocks: [
            { type: 'heading', text: '按照图片位逐项填写', fontSize: 30 },
            { type: 'paragraph', text: '先填写统一的产品名称，再为每个图片位选择尺寸、上传竞品图片并确认标题和文案。默认显示 3 个图片位，可以继续添加，未使用的图片位不需要上传。', fontSize: 16 },
            { type: 'subheading', text: '需要摄影师补图时', fontSize: 22 },
            { type: 'paragraph', text: '打开“由摄影师决定”后，该图片位可以先不上传白底图。提交后摄影师会在管理台补传原图，并根据开关继续进行精修、白底抠图和作图。整个流程通常需要 1 至 3 小时。', fontSize: 16 },
            { type: 'subheading', text: '每张完成后都会通知', fontSize: 22 },
            { type: 'paragraph', text: '系统会逐张处理，不需要等全部图片完成才收图。某一张失败时会从失败环节继续，不会让已经完成的图片重新开始。', fontSize: 16 }
        ]
    },
    {
        id: 'guide-default-queue-time', category: 'faq', title: '为什么任务显示排队中？',
        subtitle: '了解处理顺序、预计时间和任务状态。', published: true, cover: null,
        createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z',
        blocks: [
            { type: 'heading', text: '同一时间只处理一个任务', fontSize: 30 },
            { type: 'paragraph', text: 'RPA 电脑会按队列逐个执行任务。页面显示“排队中”表示任务已经提交成功，正在等待前面的任务完成，并不是提交失败。', fontSize: 16 },
            { type: 'subheading', text: '大致处理时间', fontSize: 22 },
            { type: 'paragraph', text: '自由模式通常每个任务约 8 分钟，图生图约 15 分钟，精修图片约 20 分钟。实际时间会受图片数量和任务复杂度影响。', fontSize: 16 },
            { type: 'subheading', text: '什么时候需要联系管理员', fontSize: 22 },
            { type: 'paragraph', text: '如果任务长时间停在同一个环节，或页面明确显示连续处理失败，可以通过“问题反馈/协助”提交任务 ID 和截图。', fontSize: 16 }
        ]
    },
    {
        id: 'guide-default-upload-failed', category: 'faq', title: '图片或成品上传失败怎么办？',
        subtitle: '按顺序检查格式、大小、网络和任务状态。', published: true, cover: null,
        createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z',
        blocks: [
            { type: 'heading', text: '先不要重复提交任务', fontSize: 30 },
            { type: 'paragraph', text: '看到上传失败时先保留当前页面，确认网络稳定后重新上传同一个文件。系统会识别同一批上传，避免网络重试造成重复成品。', fontSize: 16 },
            { type: 'subheading', text: '检查文件要求', fontSize: 22 },
            { type: 'paragraph', text: '前台图片请遵守页面显示的单张大小限制。成品上传平台支持常见图片格式和 Adobe Illustrator 的 AI 文件；A+ 拆分和普通白底抠图等需要读取像素的任务仍应上传图片文件，矢量图白底任务则上传 AI 文件。', fontSize: 16 },
            { type: 'subheading', text: '仍然失败时', fontSize: 22 },
            { type: 'paragraph', text: '请在问题反馈中选择“需要协助”，上传失败截图并填写任务 ID。不要新建相同任务，管理员可以从原任务继续处理。', fontSize: 16 }
        ]
    }
];

export async function onRequestGet({ request, env }) {
    if (!env.SUBMISSIONS) return jsonError('帮助内容存储尚未配置', 503);
    const includeAll = new URL(request.url).searchParams.get('all') === '1';
    const articles = await readArticles(env.SUBMISSIONS);
    return Response.json({
        ok: true,
        articles: articles
            .filter(article => includeAll || article.published)
            .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
    });
}

export async function onRequestPost({ request, env }) {
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) return jsonError('帮助内容存储尚未配置', 503);
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) return uploadImage(request, env);

    let body;
    try { body = await request.json(); }
    catch { return jsonError('请求内容无效', 400); }
    if (body.action !== 'save') return jsonError('不支持的操作', 400);

    const normalized = normalizeArticle(body.article);
    if (normalized.error) return jsonError(normalized.error, 400);

    const articles = await readArticles(env.SUBMISSIONS);
    const now = new Date().toISOString();
    const index = articles.findIndex(article => article.id === normalized.article.id);
    let saved;
    if (index >= 0) {
        const previous = articles[index];
        saved = { ...normalized.article, id: previous.id, createdAt: previous.createdAt || now, updatedAt: now };
        articles[index] = saved;
        await deleteUnusedImages(env.SUBMISSION_FILES, previous, saved);
    } else {
        saved = { ...normalized.article, id: 'guide-' + crypto.randomUUID(), createdAt: now, updatedAt: now };
        articles.unshift(saved);
    }
    await env.SUBMISSIONS.put(INDEX_KEY, JSON.stringify(articles.slice(0, 100)));
    return Response.json({ ok: true, article: saved });
}

export async function onRequestDelete({ request, env }) {
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) return jsonError('帮助内容存储尚未配置', 503);
    let body;
    try { body = await request.json(); }
    catch { return jsonError('请求内容无效', 400); }
    const id = cleanText(body.id, 100);
    if (!id) return jsonError('缺少文章 ID', 400);

    const articles = await readArticles(env.SUBMISSIONS);
    const target = articles.find(article => article.id === id);
    if (!target) return jsonError('文章不存在', 404);
    await Promise.all([...articleImageKeys(target)].map(key => env.SUBMISSION_FILES.delete(key).catch(() => {})));
    await env.SUBMISSIONS.put(INDEX_KEY, JSON.stringify(articles.filter(article => article.id !== id)));
    return Response.json({ ok: true });
}

async function uploadImage(request, env) {
    let form;
    try { form = await request.formData(); }
    catch { return jsonError('图片上传内容无效', 400); }
    if (form.get('action') !== 'upload_image') return jsonError('不支持的操作', 400);
    const file = form.get('file');
    if (!file || typeof file === 'string') return jsonError('请选择图片', 400);
    if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type || '')) return jsonError('请选择 JPG、PNG 或 WebP 图片', 400);
    if (file.size > MAX_IMAGE_BYTES) return jsonError('图片单张不能超过 8MB', 413);

    const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png';
    const key = `studio-guides/${crypto.randomUUID()}.${ext}`;
    try {
        await env.SUBMISSION_FILES.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type || 'image/png' }
        });
    } catch (error) {
        console.error('Studio guide image upload failed', error?.message || error);
        return jsonError('图片存储暂时不可用，请稍后重试', 503);
    }
    return Response.json({
        ok: true,
        image: { key, url: `/api/library-file/${encodeURIComponent(key)}`, name: cleanText(file.name, 120) || `image.${ext}` }
    });
}

function normalizeArticle(value) {
    const title = cleanText(value?.title, 80);
    const subtitle = cleanText(value?.subtitle, 160);
    const category = CATEGORIES.has(value?.category) ? value.category : '';
    if (!title) return { error: '请填写文章标题' };
    if (!category) return { error: '请选择文章分类' };

    const blocks = Array.isArray(value?.blocks)
        ? value.blocks.slice(0, 60).map(normalizeBlock).filter(Boolean)
        : [];
    if (!blocks.length) return { error: '请至少添加一段正文或一张图片' };

    return {
        article: {
            id: /^guide-[a-z0-9-]{10,}$/i.test(String(value?.id || '')) ? String(value.id) : '',
            category,
            title,
            subtitle,
            cover: normalizeImage(value?.cover),
            blocks,
            published: value?.published !== false
        }
    };
}

function normalizeBlock(block) {
    const type = BLOCK_TYPES.has(block?.type) ? block.type : '';
    if (!type) return null;
    if (type === 'image') {
        const image = normalizeImage(block);
        return image ? { type, ...image, alt: cleanText(block.alt, 120) } : null;
    }
    const text = cleanMultiline(block?.text, type === 'paragraph' ? 8000 : 500);
    if (!text) return null;
    const defaults = { heading: 30, subheading: 22, paragraph: 16 };
    const size = Math.round(Number(block?.fontSize) || defaults[type]);
    return { type, text, fontSize: Math.min(48, Math.max(12, size)) };
}

function normalizeImage(value) {
    const key = String(value?.key || '').trim();
    if (!key.startsWith('studio-guides/')) return null;
    return {
        key,
        url: `/api/library-file/${encodeURIComponent(key)}`,
        name: cleanText(value?.name, 120) || '文章图片'
    };
}

async function readArticles(storage) {
    const raw = await storage.get(INDEX_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_ARTICLES));
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function deleteUnusedImages(storage, previous, next) {
    const nextKeys = articleImageKeys(next);
    const removed = [...articleImageKeys(previous)].filter(key => !nextKeys.has(key));
    await Promise.all(removed.map(key => storage.delete(key).catch(() => {})));
}

function articleImageKeys(article) {
    const keys = new Set();
    if (article?.cover?.key?.startsWith('studio-guides/')) keys.add(article.cover.key);
    for (const block of article?.blocks || []) {
        if (block?.type === 'image' && block.key?.startsWith('studio-guides/')) keys.add(block.key);
    }
    return keys;
}

function cleanText(value, maxLength) {
    return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, maxLength);
}

function cleanMultiline(value, maxLength) {
    return String(value || '').replace(/\r/g, '').trim().slice(0, maxLength);
}

function jsonError(error, status) {
    return Response.json({ ok: false, error }, { status });
}
