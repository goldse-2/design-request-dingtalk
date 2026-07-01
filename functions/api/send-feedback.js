export async function onRequestPost(context) {
    const { request, env } = context;
    
    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { submissionId, message, images } = body;
    
    if (!submissionId || !message) {
        return Response.json({ ok: false, error: 'Missing required fields' }, { status: 400 });
    }

    if (!env.SUBMISSIONS || !env.DINGTALK_APPKEY || !env.DINGTALK_APPSECRET) {
        return Response.json({ ok: false, error: 'Service not configured' }, { status: 500 });
    }

    try {
        // Try SUBMISSIONS first, then STUDIO_TASKS
        let raw = await env.SUBMISSIONS.get(submissionId);
        let isStudio = false;
        if (!raw && env.STUDIO_TASKS) {
            raw = await env.STUDIO_TASKS.get(submissionId);
            isStudio = true;
        }
        if (!raw) {
            return Response.json({ ok: false, error: 'Task not found' }, { status: 404 });
        }

        const submission = JSON.parse(raw);
        
        if (!submission.submitter || !submission.submitter.unionId) {
            return Response.json({ ok: false, error: 'No submitter info' }, { status: 400 });
        }

        const accessToken = await getAccessToken(env.DINGTALK_APPKEY, env.DINGTALK_APPSECRET);
        const staffId = await getStaffId(accessToken, submission.submitter.unionId);
        
        const productName = isStudio
            ? (submission.imageName || submission.desc || '未命名任务')
            : (submission.data?.basicInfo?.['型号'] || submission.taskType || '未命名任务');
        
        // Send text message
        const content = `任务反馈\n\n产品：${productName}\n\n${message}`;
        
        await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': accessToken },
            body: JSON.stringify({
                robotCode: env.DINGTALK_APPKEY,
                userIds: [staffId],
                msgKey: 'sampleText',
                msgParam: JSON.stringify({ content })
            })
        });

        // Send images if provided
        if (images && images.length > 0 && env.SUBMISSION_FILES) {
            try {
                const origin = env.SITE_ORIGIN || 'https://design-request-dingtalk.pages.dev';
                const imgUrls = [];
                for (let i = 0; i < images.length; i++) {
                    const binary = atob(images[i]);
                    const bytes = new Uint8Array(binary.length);
                    for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
                    const key = `feedback-images/${submissionId}-${Date.now()}-${i}.jpg`;
                    await env.SUBMISSION_FILES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
                    imgUrls.push(`${origin}/api/reject-image/${submissionId}-${Date.now()}-${i}`);
                }
                const mdText = imgUrls.map((u, i) => `![反馈图${i + 1}](${u})`).join('\n');
                await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': accessToken },
                    body: JSON.stringify({
                        robotCode: env.DINGTALK_APPKEY,
                        userIds: [staffId],
                        msgKey: 'sampleMarkdown',
                        msgParam: JSON.stringify({ title: '反馈附图', text: mdText })
                    })
                });
            } catch (e) {
                console.error('Image send failed:', e);
            }
        }

        return Response.json({ ok: true });
    } catch (err) {
        console.error('Send feedback failed:', err);
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}

async function getAccessToken(appKey, appSecret) {
    const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey, appSecret })
    });
    const data = await res.json();
    if (!data.accessToken) throw new Error('Token failed');
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
