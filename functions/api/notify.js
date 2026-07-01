export async function onRequestPost(context) {
    const { request, env } = context;

    const webhookUrl = env.DINGTALK_WEBHOOK;
    if (!webhookUrl) {
        return Response.json({ ok: false, error: 'DINGTALK_WEBHOOK not configured' }, { status: 500 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { taskType, remarks, urgent, data } = body;
    if (!taskType || !data) {
        return Response.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }

    const submissionId = crypto.randomUUID();
    const timestamp = Date.now();

    const submission = {
        id: submissionId,
        taskType,
        remarks: remarks || '',
        urgent: urgent || false,
        data,
        timestamp,
        createdAt: new Date(timestamp).toISOString()
    };

    if (env.SUBMISSIONS) {
        try {
            await env.SUBMISSIONS.put(submissionId, JSON.stringify(submission), {
                metadata: { taskType, urgent: urgent ? 'yes' : 'no', timestamp }
            });
        } catch (err) {
            console.error('KV storage failed:', err);
        }
    }

    const message = buildMarkdown(taskType, remarks, urgent, data);

    const dtRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            msgtype: 'markdown',
            markdown: {
                title: `作图需求·${data.basicInfo['型号'] || taskType}`,
                text: message
            }
        })
    });

    const dtJson = await dtRes.json();

    if (dtJson.errcode === 0) {
        return Response.json({ ok: true, id: submissionId });
    } else {
        return Response.json({ ok: false, error: dtJson.errmsg || 'DingTalk error' }, { status: 502 });
    }
}

function buildMarkdown(taskType, remarks, urgent, data) {
    const info = data.basicInfo;
    const lines = [];

    lines.push(`## 📋 作图需求${urgent ? ' 🔴加急' : ''}`);
    lines.push(`**类型：** ${taskType}　**产品：** ${info['型号'] || '-'}　**交表：** ${info['交表时间'] || '-'}`);
    if (urgent) lines.push(`> ⚠️ **加急任务，优先处理**`);
    lines.push('');

    if (info['整体要求']) lines.push(`> ${info['整体要求']}`);
    if (info['补充描述']) lines.push(`> ${info['补充描述']}`);
    if (remarks) lines.push(`> 备注：${remarks}`);
    lines.push('');

    lines.push(`**共 ${data.images.length} 张图片**`);
    lines.push('');

    const mainImages = data.images.filter(i => i.区域 === '主图');
    const otherImages = data.images.filter(i => i.区域 !== '主图');

    if (mainImages.length) {
        lines.push('#### 主图');
        for (const img of mainImages) lines.push(formatImage(img));
    }

    if (otherImages.length) {
        const sections = [...new Set(otherImages.map(i => i.区域))];
        for (const sec of sections) {
            lines.push(`#### ${sec}`);
            for (const img of otherImages.filter(i => i.区域 === sec)) lines.push(formatImage(img));
        }
    }

    lines.push('---');
    lines.push(`提交时间：${data.submitTime}　文件：${data.fileName}`);

    return lines.join('\n');
}

function formatImage(img) {
    const size = (img.图片要求?.match(/(\d{3,4}[*×x]\d{3,4})/i) || [])[1] || '';
    const parts = [`**第${img.序号}张**`];
    if (size) parts.push(`\`${size}\``);
    if (img.图片要求) parts.push(img.图片要求.slice(0, 80) + (img.图片要求.length > 80 ? '…' : ''));
    return '- ' + parts.join('　');
}
