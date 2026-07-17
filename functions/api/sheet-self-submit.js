import { SHEET_SELF_SLOT_COUNT, putSheetSelfSlot, startSheetSelfProgramSlot } from '../_shared/sheet-self-workflow.js';
import { studioTaskPutOptions } from '../_shared/studio-task-storage.js';

export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    if (!env.SUBMISSIONS) return Response.json({ ok: false, error: 'Storage not configured' }, { status: 500 });

    let body;
    try { body = await request.json(); }
    catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

    const submitter = normalizeSubmitter(body.submitter);
    const slots = Array.isArray(body.slots) ? body.slots.slice(0, SHEET_SELF_SLOT_COUNT).map((slot, index) => normalizeSlot(slot, index)) : [];
    if (!submitter.unionId || !submitter.name) {
        return Response.json({ ok: false, error: '请先登录钉钉' }, { status: 401 });
    }
    if (!slots.length || slots.length > SHEET_SELF_SLOT_COUNT || slots.some(slot => slot.error)) {
        const error = slots.find(slot => slot.error)?.error || `请至少填写 1 个图片位，最多 ${SHEET_SELF_SLOT_COUNT} 个`;
        return Response.json({ ok: false, error }, { status: 400 });
    }

    const id = `studio-sheet-${crypto.randomUUID()}`;
    const timestamp = Date.now();
    const sizeSummary = [...new Set(slots.map(slot => slot.aPlusDouble ? 'A+ 连续双图 1464 × 1200' : slot.size.replace('x', ' × ')))];
    const parent = {
        id,
        kind: 'studio',
        mode: 'sheet_self',
        submitter,
        category: '图片',
        imageName: `表格自助-${slots.length}张图片`,
        productName: slots[0]?.productName || '表格自助',
        desc: `生成 ${slots.length} 个图片位：${sizeSummary.join('、')}`,
        size: sizeSummary.length === 1 ? slots[0].size : 'mixed',
        productKeys: [],
        refKeys: slots.map(slot => slot.referenceKey),
        modelKeys: [],
        resultKeys: [],
        sheetSelfSlotCount: slots.length,
        photographerSlotCount: slots.filter(slot => slot.photographer).length,
        status: 'processing',
        silent: false,
        dingtalkNotified: false,
        r2AutoNotified: false,
        timestamp,
        createdAt: new Date(timestamp).toISOString()
    };

    try {
        await env.SUBMISSIONS.put(id, JSON.stringify(parent), studioTaskPutOptions(parent));
        await Promise.all(slots.map(slot => putSheetSelfSlot(env, { ...slot, parentId: id })));
    } catch (error) {
        return Response.json({ ok: false, error: '保存任务失败：' + error.message }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    const automaticSlots = slots.filter(slot => !slot.photographer).map(slot => ({ ...slot, parentId: id }));
    const dispatchPromise = (async () => {
        const results = [];
        for (const slot of automaticSlots) {
            try {
                results.push({ status: 'fulfilled', value: await startSheetSelfProgramSlot(env, parent, slot, origin) });
            } catch (reason) {
                results.push({ status: 'rejected', reason: String(reason?.message || reason) });
            }
        }
        return results;
    })();
    const notifyPromise = parent.photographerSlotCount > 0
        ? notifyAdminForPhotography(env, parent, origin).catch(error => console.error('Sheet self admin notification failed:', error.message))
        : Promise.resolve();

    if (waitUntil) {
        waitUntil(dispatchPromise);
        waitUntil(notifyPromise);
    } else {
        await dispatchPromise;
        await notifyPromise;
    }

    return Response.json({
        ok: true,
        id,
        automaticSlots: automaticSlots.length,
        photographerSlots: parent.photographerSlotCount
    });
}

function normalizeSlot(value, index) {
    const slot = value && typeof value === 'object' ? value : {};
    const referenceKey = normalizeFileKey(slot.referenceKey);
    const productKeys = Array.isArray(slot.productKeys) ? slot.productKeys.slice(0, 2).map(normalizeFileKey).filter(Boolean) : [];
    const photographer = slot.photographer === true;
    const requestedSize = normalizeSize(slot.size);
    const aPlusDouble = slot.aPlusDouble === true || requestedSize === '1464x1200';
    const normalized = {
        index,
        displayIndex: Number.isInteger(Number(slot.index)) && Number(slot.index) >= 0 && Number(slot.index) < SHEET_SELF_SLOT_COUNT ? Number(slot.index) : index,
        photographer,
        size: aPlusDouble ? '1464x1200' : requestedSize,
        aPlusDouble,
        productName: cleanText(slot.productName, 100),
        title: cleanText(slot.title, 100),
        subtitle: cleanText(slot.subtitle, 100),
        otherText: cleanText(slot.otherText, 300),
        referenceKey,
        productKeys,
        sourceKeys: [],
        cutoutKeys: [],
        resultKeys: [],
        resultNotified: false,
        notificationError: '',
        children: {},
        stage: photographer ? 'waiting_photos' : 'queued',
        error: ''
    };
    const displayNumber = normalized.displayIndex + 1;
    if (!normalized.productName) normalized.error = `第 ${displayNumber} 张请填写产品名称`;
    else if (!referenceKey) normalized.error = aPlusDouble
        ? `第 ${displayNumber} 张请上传 A+ 上下两张 1464 × 600 图片`
        : `第 ${displayNumber} 张请上传要模仿的参考图`;
    else if (!photographer && productKeys.length !== 2) normalized.error = `第 ${displayNumber} 张请上传两张白底产品图，或开启“由摄影师决定”`;
    return normalized;
}

function normalizeSize(value) {
    const size = String(value || '').replace(/[×\s]/g, 'x').toLowerCase();
    return ['1600x1600', '1464x600', '1464x1200'].includes(size) ? size : '1600x1600';
}

function normalizeFileKey(value) {
    if (!value || typeof value !== 'object') return null;
    const key = String(value.key || '').trim();
    if (!key || !key.startsWith('studio/sheet-self/')) return null;
    return { key, name: cleanText(value.name || '图片.jpg', 160) };
}

function normalizeSubmitter(value) {
    return {
        unionId: cleanText(value?.unionId, 160),
        name: cleanText(value?.name, 80),
        avatar: cleanText(value?.avatar, 500)
    };
}

function cleanText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

async function notifyAdminForPhotography(env, parent, origin) {
    if (!env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET || !env.ADMIN_USER_ID) return;
    const tokenResponse = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: env.DINGTALK_APPKEY, appSecret: env.DINGTALK_APPSECRET })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenData.accessToken) throw new Error('获取钉钉令牌失败');
    const content = `表格自助任务需要摄影协助\n\n提交人：${parent.submitter.name}\n需要摄影：${parent.photographerSlotCount} 个图片位\n任务ID：${parent.id}\n\n去管理台上传拍摄原图：${origin}/admin.html`;
    const response = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': tokenData.accessToken },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds: [env.ADMIN_USER_ID],
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
