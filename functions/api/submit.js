export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;

    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { taskType, remarks, submitter, data } = body;
    if (!taskType || !data) {
        return Response.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }

    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    const submissionId = crypto.randomUUID();
    const timestamp = Date.now();

    const originalFile = data.originalFile || '';
    const fileName = data.fileName || 'submission.xlsx';
    const dataForStorage = { ...data };
    delete dataForStorage.originalFile;
    dataForStorage.basicInfo = { ...(dataForStorage.basicInfo || {}) };
    const currentProductName = String(dataForStorage.basicInfo['型号'] || '').trim();
    if (!currentProductName || currentProductName === '未知产品') {
        const inferredName = spreadsheetBaseName(fileName);
        if (inferredName) dataForStorage.basicInfo['型号'] = inferredName;
    }

    let fileKey = '';
    if (originalFile && env.SUBMISSION_FILES) {
        try {
            const bytes = base64ToBytes(originalFile);
            fileKey = `submissions/${submissionId}/${fileName}`;
            await env.SUBMISSION_FILES.put(fileKey, bytes, {
                httpMetadata: {
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    contentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`
                }
            });
        } catch (err) {
            console.error('R2 upload failed:', err.message);
            fileKey = '';
        }
    }

    const submission = {
        id: submissionId,
        taskType,
        remarks: remarks || '',
        submitter: submitter || null,
        data: dataForStorage,
        fileKey,
        fileName,
        timestamp,
        createdAt: new Date(timestamp).toISOString()
    };

    try {
        await env.SUBMISSIONS.put(submissionId, JSON.stringify(submission), {
            metadata: { taskType, timestamp }
        });
    } catch (err) {
        console.error('KV storage failed:', err);
        return Response.json({ ok: false, error: 'Storage failed' }, { status: 500 });
    }

    const queuePosition = await getQueuePosition(env, timestamp);

    if (env.DINGTALK_APPKEY && env.DINGTALK_APPSECRET) {
        const origin = new URL(request.url).origin;
        const p = (async () => {
            const accessToken = await getAccessToken(env).catch(() => null);
            if (!accessToken) return;
            if (env.ADMIN_USER_ID) {
                await notifyAdmin(accessToken, env, submission, origin).catch(e => console.error('Admin notify failed:', e.message));
            }
            if (submission.submitter?.unionId) {
                await notifySubmitter(accessToken, env, submission, queuePosition, origin).catch(e => console.error('Submitter notify failed:', e.message));
            }
        })();
        if (waitUntil) waitUntil(p);
    }

    return Response.json({ ok: true, id: submissionId, queuePosition });
}

async function getQueuePosition(env, timestamp) {
    try {
        // 获取所有任务（包括普通表格提交和 studio- 开头的图片制作任务）
        const list = await env.SUBMISSIONS.list({ limit: 1000 });
        const results = await Promise.all(list.keys.map(k => env.SUBMISSIONS.get(k.name)));
        
        // 统计在当前任务之前的待处理任务数量
        const pendingBeforeMe = results
            .filter(Boolean)
            .map(r => {
                try {
                    return JSON.parse(r);
                } catch {
                    return null;
                }
            })
            .filter(s => {
                if (!s) return false;
                
                // 排除已归档的任务
                if (s.archived) return false;
                
                // 排除已完成/已驳回的 Studio 任务
                if (s.kind === 'studio' || String(s.id || '').startsWith('studio-')) {
                    if (s.status === 'done' || s.status === 'rejected') return false;
                }
                
                // 只统计比当前任务更早提交的
                const isEarlier = s.timestamp < timestamp;
                return isEarlier;
            }).length;
        
        return pendingBeforeMe;
    } catch (e) {
        console.error('getQueuePosition failed:', e);
        return 0;
    }
}

async function getAccessToken(env) {
    const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey: env.DINGTALK_APPKEY, appSecret: env.DINGTALK_APPSECRET })
    });
    const data = await res.json();
    if (!data.accessToken) throw new Error('Token failed: ' + JSON.stringify(data));
    return data.accessToken;
}

async function getStaffId(accessToken, unionId) {
    const res = await fetch(`https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unionid: unionId })
    });
    const data = await res.json();
    if (data.errcode !== 0) throw new Error('getStaffId failed: ' + data.errmsg);
    return data.result?.userid;
}

async function sendText(accessToken, env, userIds, content) {
    const res = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': accessToken },
        body: JSON.stringify({
            robotCode: env.DINGTALK_APPKEY,
            userIds,
            msgKey: 'sampleText',
            msgParam: JSON.stringify({ content })
        })
    });
    return await res.json();
}

async function notifyAdmin(accessToken, env, submission, origin) {
    const product = submission.data?.basicInfo?.['型号'] || '-';
    const imgCount = submission.data?.images?.length || 0;
    const submitterName = submission.submitter?.name || '匿名用户';
    const beijingTime = new Date(submission.timestamp).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    let content = `📋 新作图需求\n\n`;
    content += `提交人：${submitterName}\n`;
    content += `任务类型：${submission.taskType}\n`;
    content += `产品型号：${product}\n`;
    content += `图片数量：${imgCount} 张\n`;
    content += `提交时间：${beijingTime}\n`;
    if (submission.remarks) content += `备注：${submission.remarks}\n`;
    if (submission.fileKey) content += `\n下载原表格：${origin}/api/download/${submission.id}\n`;
    content += `\n查看详情：${origin}/admin.html`;

    return sendText(accessToken, env, [env.ADMIN_USER_ID], content);
}

async function notifySubmitter(accessToken, env, submission, queuePosition, origin) {
    await new Promise(r => setTimeout(r, 5000));

    const freshPosition = await getQueuePosition(env, submission.timestamp);
    const staffId = await getStaffId(accessToken, submission.submitter.unionId);

    const product = submission.data?.basicInfo?.['型号'] || '未知产品';
    const queueNum = freshPosition + 1; // 用户是第几个
    
    // 根据排队位置显示不同的处理时间
    let progressText = '';
    if (queueNum <= 3) {
        progressText = '当前进度：尽快处理 5-7天（视频除外）';
    } else if (queueNum <= 6) {
        progressText = '当前进度：正在排队 7天内处理（视频除外）';
    } else {
        progressText = '当前进度：忙碌中 - 大概10-20天开始处理（视频除外）';
    }

    let content = `✅ 任务已提交成功\n\n`;
    content += `📋 ${submission.taskType}\n`;
    content += `产品：${product}\n\n`;
    
    if (freshPosition === 0) {
        content += `🎉 当前无人排队，您的任务将优先处理\n`;
    } else {
        content += `📊 您是第 ${queueNum} 个排队中\n`;
    }
    
    content += `受理人：卢梓城\n`;
    content += `${progressText}\n\n`;
    content += `完成后会自动通知您`;

    return sendText(accessToken, env, [staffId], content);
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function spreadsheetBaseName(value) {
    let name = String(value || '').trim().split(/[\\/]/).pop() || '';
    try { name = decodeURIComponent(name); } catch {}
    return name.replace(/\.(xlsx|xls)$/i, '').trim();
}
