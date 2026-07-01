export async function onRequestPost(context) {
    const { request, env } = context;
    
    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { submissionId, direction } = body;
    
    if (!submissionId || !direction || !['up', 'down'].includes(direction)) {
        return Response.json({ ok: false, error: 'Invalid parameters' }, { status: 400 });
    }

    if (!env.SUBMISSIONS) {
        return Response.json({ ok: false, error: 'KV not configured' }, { status: 500 });
    }

    try {
        const list = await env.SUBMISSIONS.list({ limit: 1000 });
        const submissions = [];
        
        for (const key of list.keys) {
            const raw = await env.SUBMISSIONS.get(key.name);
            if (raw) {
                const sub = JSON.parse(raw);
                if (!sub.archived && sub.status !== 'completed' && sub.status !== 'rejected') {
                    submissions.push(sub);
                }
            }
        }

        submissions.sort((a, b) => {
            const prioA = a.priority ?? a.timestamp ?? 0;
            const prioB = b.priority ?? b.timestamp ?? 0;
            return prioA - prioB;
        });

        const targetIndex = submissions.findIndex(s => s.id === submissionId);
        if (targetIndex === -1) {
            return Response.json({ ok: false, error: 'Submission not found' }, { status: 404 });
        }

        if (direction === 'up' && targetIndex > 0) {
            const prevSub = submissions[targetIndex - 1];
            const targetSub = submissions[targetIndex];
            
            const tempPriority = prevSub.priority ?? prevSub.timestamp;
            prevSub.priority = targetSub.priority ?? targetSub.timestamp;
            targetSub.priority = tempPriority;
            
            await env.SUBMISSIONS.put(prevSub.id, JSON.stringify(prevSub), {
                metadata: { taskType: prevSub.taskType, timestamp: prevSub.timestamp }
            });
            await env.SUBMISSIONS.put(targetSub.id, JSON.stringify(targetSub), {
                metadata: { taskType: targetSub.taskType, timestamp: targetSub.timestamp }
            });
        } else if (direction === 'down' && targetIndex < submissions.length - 1) {
            const nextSub = submissions[targetIndex + 1];
            const targetSub = submissions[targetIndex];
            
            const tempPriority = nextSub.priority ?? nextSub.timestamp;
            nextSub.priority = targetSub.priority ?? targetSub.timestamp;
            targetSub.priority = tempPriority;
            
            await env.SUBMISSIONS.put(nextSub.id, JSON.stringify(nextSub), {
                metadata: { taskType: nextSub.taskType, timestamp: nextSub.timestamp }
            });
            await env.SUBMISSIONS.put(targetSub.id, JSON.stringify(targetSub), {
                metadata: { taskType: targetSub.taskType, timestamp: targetSub.timestamp }
            });
        }

        return Response.json({ ok: true, direction, submissionId });
    } catch (err) {
        console.error('Reorder failed:', err);
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}
