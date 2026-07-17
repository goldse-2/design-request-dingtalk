import { SHEET_SELF_SLOT_COUNT, getSheetSelfSlot, putSheetSelfSlot, retrySheetSelfSlot, startSheetSelfPhotographySlot, startSheetSelfProgramSlot } from '../_shared/sheet-self-workflow.js';

export async function onRequestPost(context) {
    const { request, env } = context;
    if (!env.SUBMISSIONS || !env.SUBMISSION_FILES) {
        return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });
    }

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return retrySlot(context);

    let form;
    try { form = await request.formData(); }
    catch { return Response.json({ ok: false, error: '上传格式错误' }, { status: 400 }); }

    const parentId = String(form.get('parentId') || '').trim();
    const slotIndex = Number(form.get('slotIndex'));
    const needsProcessing = String(form.get('needsProcessing') || 'true') !== 'false';
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
        if (needsProcessing) {
            await startSheetSelfPhotographySlot(env, loaded.parent, loaded.slot, sourceKeys, origin);
            return Response.json({ ok: true, parentId, slotIndex, stage: loaded.slot.skipRetouch ? 'cutout' : 'retouch', needsProcessing: true, skipRetouch: loaded.slot.skipRetouch === true, duplicatedSource });
        }
        loaded.slot.sourceKeys = sourceKeys;
        loaded.slot.cutoutKeys = sourceKeys;
        loaded.slot.processingSkipped = true;
        loaded.slot.error = '';
        loaded.slot.failedStage = '';
        await putSheetSelfSlot(env, loaded.slot);
        await startSheetSelfProgramSlot(env, loaded.parent, loaded.slot, origin);
        return Response.json({ ok: true, parentId, slotIndex, stage: 'program', needsProcessing: false, duplicatedSource });
    } catch (error) {
        const stageText = needsProcessing ? '精修' : '图生图';
        return Response.json({ ok: false, error: `图片已保存，但发送${stageText}失败：${error.message}` }, { status: 502 });
    }
}

async function retrySlot(context) {
    const { request, env } = context;
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }
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
