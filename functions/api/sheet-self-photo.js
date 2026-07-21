import { SHEET_SELF_SLOT_COUNT, getSheetSelfSlot, retrySheetSelfSlot, startSheetSelfPhotographySlot, startSheetSelfProgramSlot } from '../_shared/sheet-self-workflow.js';

export async function onRequestPost(context) {
    const { request, env } = context;
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return handleJsonRequest(context);

    let form;
    try { form = await request.formData(); }
    catch { return Response.json({ ok: false, error: '上传格式错误' }, { status: 400 }); }

    const parentId = String(form.get('parentId') || '').trim();
    const slotIndex = Number(form.get('slotIndex'));
    const legacyNeedsProcessing = String(form.get('needsProcessing') || 'true') !== 'false';
    const files = form.getAll('files').filter(file => file && typeof file !== 'string');
    const loaded = await loadParentAndSlot(env, parentId, slotIndex);
    if (loaded.error) return loaded.error;
    if (!loaded.slot.photographer) return Response.json({ ok: false, error: '该图片位不需要摄影师提供图片' }, { status: 400 });
    if (!['waiting_photos', 'error'].includes(loaded.slot.stage)) {
        return Response.json({ ok: false, error: '该图片位已经进入处理流程' }, { status: 409 });
    }
    if (files.length < 1 || files.length > 2) return Response.json({ ok: false, error: '请上传一张或两张图片' }, { status: 400 });

    const duplicatedSource = files.length === 1;
    const processingFiles = duplicatedSource ? [files[0], files[0]] : files;
    const legacyFlags = parseProcessingFlags(form.get('processingFlags'), files.length, legacyNeedsProcessing);
    const requestedRetouchFlags = form.has('retouchFlags')
        ? parseProcessingFlags(form.get('retouchFlags'), files.length, !loaded.slot.skipRetouch)
        : legacyFlags.map(flag => flag && loaded.slot.skipRetouch !== true);
    const requestedCutoutFlags = form.has('cutoutFlags')
        ? parseProcessingFlags(form.get('cutoutFlags'), files.length, loaded.slot.cutoutEnabled !== false)
        : legacyFlags;
    const retouchFlags = duplicatedSource
        ? [requestedRetouchFlags[0], requestedRetouchFlags[0]]
        : requestedRetouchFlags;
    const cutoutFlags = duplicatedSource
        ? [requestedCutoutFlags[0], requestedCutoutFlags[0]]
        : requestedCutoutFlags;
    const needsProcessing = retouchFlags.some(Boolean) || cutoutFlags.some(Boolean);
    const sourceKeys = [];
    for (let index = 0; index < processingFiles.length; index++) {
        const file = processingFiles[index];
        if (!file.type?.startsWith('image/')) return Response.json({ ok: false, error: '只能上传图片文件' }, { status: 400 });
        if (file.size > 15 * 1024 * 1024) return Response.json({ ok: false, error: '拍摄原图单张不能超过 15MB' }, { status: 413 });
        const ext = safeExtension(file.name, file.type);
        const key = `studio/sheet-self/photos/${parentId}/slot-${slotIndex + 1}-${index + 1}-${crypto.randomUUID()}.${ext}`;
        await env.SUBMISSION_FILES.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type || 'image/jpeg' }
        });
        sourceKeys.push({ key, name: file.name || `拍摄原图-${index + 1}.${ext}` });
    }

    try {
        const origin = new URL(request.url).origin;
        await startSheetSelfPhotographySlot(env, loaded.parent, loaded.slot, sourceKeys, origin, { retouchFlags, cutoutFlags });
        return Response.json({
            ok: true,
            parentId,
            slotIndex,
            stage: loaded.slot.stage,
            needsProcessing,
            retouchEnabled: retouchFlags.some(Boolean),
            cutoutEnabled: cutoutFlags.some(Boolean),
            duplicatedSource,
            retouchFlags,
            cutoutFlags,
            mixedProcessing: hasMixedSteps(retouchFlags, cutoutFlags)
        });
    } catch (error) {
        const stageText = retouchFlags.some(Boolean)
            ? '精修'
            : (cutoutFlags.some(Boolean) ? '白底抠图' : (loaded.slot.photographyOnly ? '发送用户' : '图生图'));
        return Response.json({ ok: false, error: `图片已保存，但发送${stageText}失败：${error.message}` }, { status: 502 });
    }
}

async function handleJsonRequest(context) {
    const { request, env } = context;
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }
    if (body.action === 'library') return useLibraryImages(context, body);
    if (body.action === 'no_product') return startWithoutProductImages(context, body);
    if (body.action !== 'retry') return Response.json({ ok: false, error: '不支持的操作' }, { status: 400 });

    return retrySlot(context, body);
}

async function startWithoutProductImages(context, body) {
    const { request, env } = context;
    const parentId = String(body.parentId || '').trim();
    const slotIndex = Number(body.slotIndex);
    const loaded = await loadParentAndSlot(env, parentId, slotIndex);
    if (loaded.error) return loaded.error;
    if (!loaded.slot.photographer || loaded.slot.photographyOnly) {
        return Response.json({ ok: false, error: '该图片位不支持无需图片处理' }, { status: 400 });
    }
    if (loaded.slot.noProductImage === true && ['program', 'done'].includes(loaded.slot.stage)) {
        return Response.json({ ok: true, duplicate: true, parentId, slotIndex, stage: loaded.slot.stage });
    }
    if (loaded.slot.stage !== 'waiting_photos') {
        return Response.json({ ok: false, error: '该图片位已经进入处理流程，请刷新管理台' }, { status: 409 });
    }

    loaded.slot.noProductImage = true;
    loaded.slot.analyzePrompt = '';
    loaded.slot.productKeys = [];
    loaded.slot.sourceKeys = [];
    loaded.slot.cutoutKeys = [];
    loaded.slot.processingFlags = [false, false];
    loaded.slot.retouchFlags = [false, false];
    loaded.slot.cutoutFlags = [false, false];
    loaded.slot.processingSkipped = true;
    loaded.slot.noProductSelectedAt = new Date().toISOString();
    loaded.slot.children = {};

    try {
        await startSheetSelfProgramSlot(env, loaded.parent, loaded.slot, new URL(request.url).origin);
        return Response.json({ ok: true, parentId, slotIndex, stage: loaded.slot.stage, noProductImage: true });
    } catch (error) {
        return Response.json({ ok: false, error: `已切换为无需图片，但加入图生图队列失败：${error.message}` }, { status: 502 });
    }
}

async function retrySlot(context, body) {
    const { request, env } = context;
    const parentId = String(body.parentId || '').trim();
    const slotIndex = Number(body.slotIndex);
    const loaded = await loadParentAndSlot(env, parentId, slotIndex);
    if (loaded.error) return loaded.error;
    try {
        const result = await retrySheetSelfSlot(env, loaded.parent, loaded.slot, new URL(request.url).origin);
        return Response.json({ ok: true, parentId, slotIndex, ...result });
    } catch (error) {
        return Response.json({ ok: false, error: error.message }, { status: 502 });
    }
}

async function useLibraryImages(context, body) {
    const { request, env } = context;
    const parentId = String(body.parentId || '').trim();
    const slotIndex = Number(body.slotIndex);
    const libraryKeys = Array.isArray(body.libraryKeys) ? body.libraryKeys : [];
    const loaded = await loadParentAndSlot(env, parentId, slotIndex);
    if (loaded.error) return loaded.error;
    if (!loaded.slot.photographer) return Response.json({ ok: false, error: '该图片位不需要摄影师提供图片' }, { status: 400 });
    if (!['waiting_photos', 'error'].includes(loaded.slot.stage)) {
        return Response.json({ ok: false, error: '该图片位已经进入处理流程' }, { status: 409 });
    }
    if (libraryKeys.length < 1 || libraryKeys.length > 2) {
        return Response.json({ ok: false, error: '请从去白底资料库选择一张或两张图片' }, { status: 400 });
    }

    const selectedKeys = [];
    for (const item of libraryKeys) {
        const key = String(item?.key || '').trim();
        const name = cleanLibraryFileName(item?.name, key);
        if (!key.startsWith('library/') || !isSupportedLibraryImage(name)) {
            return Response.json({ ok: false, error: '只能选择去白底资料库中的 JPG、PNG 或 WebP 图片' }, { status: 400 });
        }
        const object = await env.SUBMISSION_FILES.head(key);
        if (!object) return Response.json({ ok: false, error: `资料库图片不存在：${name}` }, { status: 404 });
        selectedKeys.push({ key, name });
    }

    const duplicatedSource = selectedKeys.length === 1;
    const sourceKeys = duplicatedSource
        ? [{ ...selectedKeys[0] }, { ...selectedKeys[0] }]
        : selectedKeys;

    try {
        await startSheetSelfPhotographySlot(env, loaded.parent, loaded.slot, sourceKeys, new URL(request.url).origin, {
            retouchFlags: [false, false],
            cutoutFlags: [false, false]
        });
        return Response.json({
            ok: true,
            parentId,
            slotIndex,
            stage: loaded.slot.stage,
            needsProcessing: false,
            duplicatedSource,
            source: 'library'
        });
    } catch (error) {
        const action = loaded.slot.photographyOnly ? '发送用户' : '发送图生图';
        return Response.json({ ok: false, error: `资料库图片已选入，但${action}失败：${error.message}` }, { status: 502 });
    }
}

async function loadParentAndSlot(env, parentId, slotIndex) {
    if (!parentId || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SHEET_SELF_SLOT_COUNT) {
        return { error: Response.json({ ok: false, error: '任务或图片位参数错误' }, { status: 400 }) };
    }
    const raw = await env.SUBMISSIONS.get(parentId);
    if (!raw) return { error: Response.json({ ok: false, error: '表格自助任务不存在' }, { status: 404 }) };
    const parent = JSON.parse(raw);
    if (parent.mode !== 'sheet_self') return { error: Response.json({ ok: false, error: '不是表格自助任务' }, { status: 400 }) };
    const slot = await getSheetSelfSlot(env, parentId, slotIndex);
    if (!slot) return { error: Response.json({ ok: false, error: '图片位状态不存在' }, { status: 404 }) };
    return { parent, slot };
}

function safeExtension(name, mimeType) {
    const fromName = String(name || '').match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
    return mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
}

function cleanLibraryFileName(name, key) {
    let fallback = String(key || '').split('/').pop() || '资料库图片.jpg';
    try { fallback = decodeURIComponent(fallback); } catch {}
    return String(name || fallback).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 160) || '资料库图片.jpg';
}

function isSupportedLibraryImage(name) {
    return /\.(?:jpe?g|png|webp)$/i.test(String(name || ''));
}

function parseProcessingFlags(rawValue, fileCount, fallback) {
    let values = [];
    try {
        const parsed = JSON.parse(String(rawValue || '[]'));
        if (Array.isArray(parsed)) values = parsed;
    } catch {}
    return Array.from({ length: fileCount }, (_, index) => {
        if (index >= values.length) return fallback;
        return values[index] !== false && values[index] !== 'false';
    });
}

function hasMixedSteps(retouchFlags, cutoutFlags) {
    const combinations = retouchFlags.map((retouch, index) => `${retouch ? 1 : 0}${cutoutFlags[index] ? 1 : 0}`);
    return new Set(combinations).size > 1;
}
