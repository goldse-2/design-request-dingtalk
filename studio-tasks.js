let currentUser = null;

function getUser() {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    if (session) {
        try {
            const u = JSON.parse(decodeURIComponent(escape(atob(session))));
            if (u.unionId) {
                sessionStorage.setItem('dt_user', JSON.stringify(u));
                localStorage.setItem('dt_user', JSON.stringify(u));
            }
            window.history.replaceState({}, '', window.location.pathname);
            return u.unionId ? u : null;
        } catch {}
    }
    const stored = sessionStorage.getItem('dt_user') || localStorage.getItem('dt_user');
    if (!stored) return null;
    try {
        const u = JSON.parse(stored);
        return u.unionId ? u : null;
    } catch { return null; }
}

function setUserUI(user) {
    const avatar = document.getElementById('userAvatar');
    if (avatar && user.avatar) { avatar.src = user.avatar; avatar.style.display = 'block'; }
    const btn = document.getElementById('userBtn');
    if (btn) { btn.title = user.name + '（点击退出）'; document.getElementById('loginIcon').style.display = 'none'; }
}

function handleUserBtnClick() {
    if (currentUser) {
        sessionStorage.removeItem('dt_user');
        localStorage.removeItem('dt_user');
        location.reload();
    } else {
        showLoginModal();
    }
}
function showLoginModal() {
    const m = document.getElementById('loginModal');
    m.removeAttribute('hidden'); m.classList.add('modal--visible');
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const STATUS_MAP = {
    waiting_photos: { text: '等待摄影补图', color: '#b45309', bg: '#fff7ed' },
    pending: { text: '待处理', color: '#f59e0b', bg: '#fef3c7' },
    processing: { text: '处理中', color: '#3b82f6', bg: '#dbeafe' },
    done: { text: '已完成', color: '#16a34a', bg: '#dcfce7' },
    rejected: { text: '已驳回', color: '#ef4444', bg: '#fee2e2' }
};

async function loadTasks() {
    currentUser = getUser();
    document.getElementById('taskLoading').hidden = true;
    if (!currentUser) {
        const el = document.getElementById('taskNeedLogin');
        el.hidden = false;
        el.style.cursor = 'pointer';
        el.textContent = '请先登录钉钉账号查看任务（点击登录）';
        el.onclick = showLoginModal;
        return;
    }
    setUserUI(currentUser);
    try {
        const res = await fetch('/api/studio-tasks?unionId=' + encodeURIComponent(currentUser.unionId));
        const json = await res.json();
        if (!json.ok || !json.tasks.length) {
            document.getElementById('taskEmpty').hidden = false;
            return;
        }
        
        // 统计队列状态
        const pending = json.tasks.filter(t => t.status === 'pending' && !t.sentToRpa).length;
        const processing = json.tasks.filter(t => t.status === 'processing' || (t.status === 'pending' && t.sentToRpa)).length;
        
        updateQueueStatus(pending, processing);
        
        const list = document.getElementById('taskList');
        json.tasks.forEach(task => list.appendChild(renderTask(task)));
        
        // Long-lived tabs refresh infrequently to stay within the free KV list quota.
        setInterval(() => refreshQueueStatus(), 5 * 60 * 60 * 1000);
    } catch (e) {
        document.getElementById('taskLoading').hidden = false;
        document.getElementById('taskLoading').textContent = '加载失败：' + e.message;
    }
}

function updateQueueStatus(pending, processing) {
    const statusEl = document.getElementById('queueStatus');
    const queueText = document.getElementById('queueText');
    const queuePending = document.getElementById('queuePending');
    const queueProcessing = document.getElementById('queueProcessing');
    const estimateTime = document.getElementById('estimateTime');
    
    if (pending === 0 && processing === 0) {
        statusEl.style.display = 'none';
        return;
    }
    
    statusEl.style.display = 'block';
    queuePending.textContent = pending;
    queueProcessing.textContent = processing;
    
    // 计算预计等待时间（假设每个任务4-8分钟）
    const avgTime = 6; // 平均6分钟
    const totalWait = (pending + processing) * avgTime;
    
    if (totalWait === 0) {
        queueText.textContent = '所有任务已完成';
        estimateTime.textContent = '-';
    } else if (totalWait < 10) {
        queueText.textContent = `${pending + processing} 个任务正在处理`;
        estimateTime.textContent = `${Math.ceil(totalWait)}分钟`;
    } else {
        queueText.textContent = `${pending + processing} 个任务排队中`;
        estimateTime.textContent = `${Math.ceil(totalWait)}分钟`;
    }
}

async function refreshQueueStatus() {
    if (!currentUser) return;
    try {
        const res = await fetch('/api/studio-tasks?unionId=' + encodeURIComponent(currentUser.unionId));
        const json = await res.json();
        if (!json.ok) return;
        
        const pending = json.tasks.filter(t => t.status === 'pending' && !t.sentToRpa).length;
        const processing = json.tasks.filter(t => t.status === 'processing' || (t.status === 'pending' && t.sentToRpa)).length;
        
        updateQueueStatus(pending, processing);
    } catch (e) {
        console.error('刷新队列状态失败:', e);
    }
}

function renderTask(task) {
    const st = STATUS_MAP[task.status] || STATUS_MAP.pending;
    const waitingPhotography = task.status === 'waiting_photos' && task.photographerDecision === true;
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 1px 4px rgba(0,0,0,0.07)';

    const modeText = task.mode === 'sheet_self' ? '表格自助' : task.mode === 'retouch' ? '精修图片' : task.mode === 'cutout' ? '白底抠图' : task.mode === 'variant' ? '变体改色' : task.mode === 'resize_ai' ? '尺寸修改' : task.mode === 'free' ? '自由模式' : '程序模式';
    const time = new Date(task.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    
    const displayTitle = task.imageName ? task.imageName.replace(/^[^-]+-/, '') : '';

    let html = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:10px">
                <span style="font-weight:700;color:#111827">${modeText}</span>
                <span style="font-size:0.75rem;background:${st.bg};color:${st.color};padding:2px 10px;border-radius:10px">${st.text}</span>
                ${task.status === 'pending' && !task.pausedAuto ? `<button onclick="toggleAutoPause('${task.id}', true)" style="font-size:0.7rem;background:#94a3b8;color:#fff;border:none;padding:3px 10px;border-radius:10px;cursor:pointer">⏸ 暂停自动发送</button>` : ''}
                ${task.pausedAuto ? `<button onclick="toggleAutoPause('${task.id}', false)" style="font-size:0.7rem;background:#16a34a;color:#fff;border:none;padding:3px 10px;border-radius:10px;cursor:pointer">▶ 恢复自动发送</button>` : ''}
            </div>
            <span style="font-size:0.78rem;color:#9ca3af">${time}</span>
        </div>`;
    
    // 进度条
    if (task.status !== 'done' && task.status !== 'rejected') {
        const step1 = true; // 已提交
        const step2 = task.sentToRpa || task.status === 'processing'; // 已发送RPA/处理中
        const step3 = task.status === 'done'; // 已完成
        
        html += `
            <div style="background:#f8fafc;border-radius:8px;padding:12px 16px;margin-bottom:12px">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                    <div style="display:flex;align-items:center;gap:8px">
                        <div style="width:20px;height:20px;border-radius:50%;background:#16a34a;display:flex;align-items:center;justify-content:center">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </div>
                        <span style="font-size:0.75rem;color:#16a34a;font-weight:600">已提交</span>
                    </div>
                    <div style="flex:1;height:2px;background:#e5e7eb;margin:0 12px;position:relative">
                        <div style="position:absolute;left:0;top:0;height:100%;background:${step2 ? '#16a34a' : '#e5e7eb'};width:100%;transition:all 0.3s"></div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px">
                        <div style="width:20px;height:20px;border-radius:50%;background:${step2 ? '#16a34a' : '#e5e7eb'};display:flex;align-items:center;justify-content:center">
                            ${step2 ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '<div style="width:8px;height:8px;border-radius:50%;background:#9ca3af"></div>'}
                        </div>
                        <span style="font-size:0.75rem;color:${step2 ? '#16a34a' : (waitingPhotography ? '#b45309' : '#9ca3af')};font-weight:${step2 || waitingPhotography ? '600' : '400'}">${task.status === 'processing' ? '处理中' : (waitingPhotography ? '等待摄影' : '待处理')}</span>
                    </div>
                    <div style="flex:1;height:2px;background:#e5e7eb;margin:0 12px;position:relative">
                        <div style="position:absolute;left:0;top:0;height:100%;background:${step3 ? '#16a34a' : '#e5e7eb'};width:100%;transition:all 0.3s"></div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px">
                        <div style="width:20px;height:20px;border-radius:50%;background:${step3 ? '#16a34a' : '#e5e7eb'};display:flex;align-items:center;justify-content:center">
                            ${step3 ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '<div style="width:8px;height:8px;border-radius:50%;background:#9ca3af"></div>'}
                        </div>
                        <span style="font-size:0.75rem;color:${step3 ? '#16a34a' : '#9ca3af'};font-weight:${step3 ? '600' : '400'}">已完成</span>
                    </div>
                </div>
                ${task.status === 'processing' ? '<div style="font-size:0.72rem;color:#3b82f6;text-align:center;margin-top:6px">' + (task.mode === 'sheet_self' ? `已完成 ${Number(task.sheetSelfCompletedCount || 0)}/${Number(task.sheetSelfSlotCount || 0)} 张，每完成一张就会发到钉钉` : task.mode === 'retouch' ? '⏱ 图片正在精修中，预计约 30 分钟完成...' : task.mode === 'cutout' ? '⏱ 正在进行白底抠图，完成后会通过钉钉通知...' : '⏱ AI 正在生成中，预计还需 4-8 分钟...') + '</div>' : ''}
                ${waitingPhotography ? '<div style="font-size:0.72rem;color:#b45309;text-align:center;margin-top:6px">摄影师补上传照片后，任务会自动开始作图</div>' : ''}
                ${task.status === 'pending' && !task.sentToRpa ? '<div style="font-size:0.72rem;color:#f59e0b;text-align:center;margin-top:6px">📋 任务已提交，等待自动发送到 RPA...</div>' : ''}
            </div>`;
    }
    
    if (displayTitle) html += `<div style="font-size:0.95rem;font-weight:600;color:#111827;margin-bottom:8px">${esc(displayTitle)}</div>`;

    if (task.desc) html += `<div style="font-size:0.85rem;color:#374151;margin-bottom:4px">描述：${esc(task.desc)}</div>`;
    if (task.imageName) html += `<div style="font-size:0.85rem;color:#6b7280;margin-bottom:4px">图片命名：${esc(task.imageName)}</div>`;
    if (task.want) html += `<div style="font-size:0.85rem;color:#374151;margin-bottom:4px">想做成：${esc(task.want)}</div>`;
    if (task.note) html += `<div style="font-size:0.85rem;color:#6b7280;margin-bottom:4px">补充：${esc(task.note)}</div>`;
    if (waitingPhotography && task.photographyNote) html += `<div style="font-size:0.85rem;color:#92400e;margin-bottom:4px">拍摄备注：${esc(task.photographyNote)}</div>`;
    if (task.status === 'rejected' && task.rejectReason) {
        html += `<div style="font-size:0.85rem;color:#ef4444;margin-top:6px">驳回原因：${esc(task.rejectReason)}</div>`;
    }

    card.innerHTML = html;

    // submitted source images
    const allSrc = [...(task.refKeys||[]), ...(task.productKeys||[])];
    if (allSrc.length) {
        const label = document.createElement('div');
        label.style.cssText = 'font-size:0.78rem;color:#9ca3af;margin:10px 0 6px';
        label.textContent = '提交素材';
        card.appendChild(label);
        card.appendChild(buildThumbRow(allSrc, false));
    }

    // result images
    if ((task.status === 'done' || task.mode === 'sheet_self') && task.resultKeys && task.resultKeys.length) {
        const label = document.createElement('div');
        label.style.cssText = 'font-size:0.82rem;color:#16a34a;font-weight:600;margin:14px 0 6px';
        label.textContent = task.status === 'done' ? '✓ 成品图（点击下载）' : `✓ 已完成 ${task.resultKeys.length} 张（点击下载）`;
        card.appendChild(label);
        card.appendChild(buildThumbRow(task.resultKeys, true));
    }

    return card;
}

function buildThumbRow(keys, downloadable) {
    const row = document.createElement('div');
    row.className = 'library-grid';
    keys.forEach(k => {
        const cell = document.createElement('div');
        cell.className = 'lib-card';
        const dl = downloadable ? `?dl=1` : '';
        cell.innerHTML = `
            <div class="lib-card-img-wrap">
                <img src="/api/library-file/${encodeURIComponent(k.key)}" alt="${esc(k.name)}" loading="lazy">
            </div>
            <div class="lib-card-body">
                <div class="lib-card-name">${esc(k.name)}</div>
                ${downloadable ? `<a class="lib-card-dl" href="/api/library-file/${encodeURIComponent(k.key)}?dl=1" download="${esc(k.name)}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    下载
                </a>` : ''}
            </div>`;
        row.appendChild(cell);
    });
    return row;
}

loadTasks();

async function toggleAutoPause(taskId, pause) {
    try {
        const res = await fetch('/api/studio-pause-auto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, pausedAuto: pause })
        });
        if (res.ok) location.reload();
        else alert('操作失败');
    } catch (e) {
        alert('操作失败：' + e.message);
    }
}
