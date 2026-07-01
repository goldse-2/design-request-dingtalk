const ADMIN_PASSWORD = '222666';
const AUTH_KEY = 'admin_authed';

const authWall = document.getElementById('authWall');
const adminMain = document.getElementById('adminMain');
const authInput = document.getElementById('authInput');
const authBtn = document.getElementById('authBtn');
const authError = document.getElementById('authError');

let loadingState, emptyState, submissionsList, filterSelect, statsEl;
let rejectModal, rejectModalClose, rejectCancelBtn, rejectConfirmBtn, rejectReason;
let etaModal, etaModalClose, etaCancelBtn, etaConfirmBtn, etaInput, etaNote;
let allData = [];
let pendingRejectId = null;
let pendingEtaId = null;

function checkAuth() {
    if (sessionStorage.getItem(AUTH_KEY) === '1') {
        showAdmin();
    }
}

function showAdmin() {
    authWall.hidden = true;
    adminMain.hidden = false;

    loadingState = document.getElementById('loadingState');
    emptyState = document.getElementById('emptyState');
    submissionsList = document.getElementById('submissionsList');
    filterSelect = document.getElementById('filterSelect');
    statsEl = document.getElementById('stats');

    rejectModal = document.getElementById('rejectModal');
    rejectModalClose = document.getElementById('rejectModalClose');
    rejectCancelBtn = document.getElementById('rejectCancelBtn');
    rejectConfirmBtn = document.getElementById('rejectConfirmBtn');
    rejectReason = document.getElementById('rejectReason');

    etaModal = document.getElementById('etaModal');
    etaModalClose = document.getElementById('etaModalClose');
    etaCancelBtn = document.getElementById('etaCancelBtn');
    etaConfirmBtn = document.getElementById('etaConfirmBtn');
    etaInput = document.getElementById('etaInput');
    etaNote = document.getElementById('etaNote');

    filterSelect.addEventListener('change', () => filterAndRender(filterSelect.value));
    rejectModalClose.addEventListener('click', () => { rejectModal.hidden = true; rejectModal.classList.remove('modal--visible'); pendingRejectId = null; });
    rejectCancelBtn.addEventListener('click', () => { rejectModal.hidden = true; rejectModal.classList.remove('modal--visible'); pendingRejectId = null; });
    rejectModal.addEventListener('click', e => { if (e.target === rejectModal) { rejectModal.hidden = true; rejectModal.classList.remove('modal--visible'); pendingRejectId = null; } });
    rejectConfirmBtn.addEventListener('click', async () => {
        if (!pendingRejectId) return;
        rejectModal.hidden = true;
        rejectModal.classList.remove('modal--visible');
        await updateStatus(pendingRejectId, 'reject', rejectReason.value.trim(), rejectImages.slice());
        pendingRejectId = null;
    });

    const pasteZone = document.getElementById('rejectPasteZone');
    pasteZone.addEventListener('click', () => document.getElementById('rejectImageInput').click());
    pasteZone.addEventListener('focus', () => pasteZone.style.borderColor = '#6366f1');
    pasteZone.addEventListener('blur', () => pasteZone.style.borderColor = '#d1d5db');
    pasteZone.addEventListener('paste', e => {
        const items = Array.from(e.clipboardData.items).filter(i => i.type.startsWith('image/'));
        if (items.length) { e.preventDefault(); items.forEach(i => addRejectImage(i.getAsFile())); }
    });
    document.addEventListener('paste', e => {
        if (!rejectModal.classList.contains('modal--visible')) return;
        const items = Array.from(e.clipboardData.items).filter(i => i.type.startsWith('image/'));
        if (items.length) { e.preventDefault(); items.forEach(i => addRejectImage(i.getAsFile())); }
    });
    document.getElementById('rejectImageInput').addEventListener('change', e => {
        Array.from(e.target.files).forEach(f => addRejectImage(f));
        e.target.value = '';
    });

    etaModalClose.addEventListener('click', () => { etaModal.hidden = true; etaModal.classList.remove('modal--visible'); pendingEtaId = null; });
    etaCancelBtn.addEventListener('click', () => { etaModal.hidden = true; etaModal.classList.remove('modal--visible'); pendingEtaId = null; });
    etaModal.addEventListener('click', e => { if (e.target === etaModal) { etaModal.hidden = true; etaModal.classList.remove('modal--visible'); pendingEtaId = null; } });
    etaConfirmBtn.addEventListener('click', async () => {
        if (!pendingEtaId) return;
        if (!etaInput.value) { alert('请选择预计完成时间'); return; }
        etaModal.hidden = true;
        etaModal.classList.remove('modal--visible');
        await sendEta(pendingEtaId, etaInput.value, etaNote.value.trim());
        pendingEtaId = null;
    });

    loadSubmissions();
    initLibrary();
    document.getElementById('examplesAdminSection').hidden = false;
    initExamplesToggle();
    loadExamplesAdmin();
    document.getElementById('studioSection').hidden = false;
    loadStudioAdmin();
}

authBtn.addEventListener('click', () => {
    if (authInput.value === ADMIN_PASSWORD) {
        sessionStorage.setItem(AUTH_KEY, '1');
        authError.hidden = true;
        showAdmin();
    } else {
        authError.hidden = false;
        authInput.value = '';
        authInput.focus();
    }
});

authInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') authBtn.click();
});

async function loadSubmissions() {
    loadingState.hidden = false;
    loadingState.textContent = '加载中...';
    submissionsList.innerHTML = '';
    emptyState.hidden = true;

    try {
        const res = await fetch(`/api/submissions?filter=all&limit=100`);
        const json = await res.json();

        if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load');

        allData = json.submissions || [];
        
        // 统计分类（模糊匹配，视频优先）
        const categoryStats = { '图片': 0, '视频': 0, '设计': 0 };
        allData.forEach(sub => {
            const type = (sub.taskType || '').toLowerCase();
            if (type.includes('视频')) categoryStats['视频']++;
            else if (type.includes('图片') || type.includes('图像')) categoryStats['图片']++;
            else if (type.includes('设计')) categoryStats['设计']++;
        });
        
        renderStats(json.stats, categoryStats);
        filterAndRender(filterSelect.value);
    } catch (err) {
        loadingState.hidden = false;
        loadingState.innerHTML = `<p style="color:#ef4444">加载失败：${err.message}</p>`;
    }
}

function renderStats(stats, categoryStats) {
    if (!stats) return;
    
    let html = `
        <div class="stat-card" style="cursor:pointer" onclick="filterByCategory('all')" title="点击查看全部需求">
            <div class="stat-val">${stats.total}</div>
            <div class="stat-label">待处理需求</div>
        </div>
    `;
    
    if (categoryStats) {
        html += Object.entries(categoryStats).map(([cat, count]) => `
            <div class="stat-card" style="cursor:pointer" onclick="filterByCategory('${cat}')" title="点击筛选${cat}任务">
                <div class="stat-val">${count}</div>
                <div class="stat-label">${cat}</div>
            </div>
        `).join('');
    }
    
    statsEl.innerHTML = html;
}

function filterByCategory(category) {
    if (!filterSelect) return;
    filterSelect.value = category;
    filterAndRender(category);
}

function filterAndRender(filter) {
    // 纯前端筛选，速度超快，不需要请求服务器
    let filtered = allData;
    if (filter !== 'all') {
        filtered = allData.filter(sub => {
            const type = (sub.taskType || '').toLowerCase();
            if (filter === '视频') return type.includes('视频');
            if (filter === '图片') return !type.includes('视频') && (type.includes('图片') || type.includes('图像'));
            if (filter === '设计') return type.includes('设计');
            return false;
        });
    }
    
    renderSubmissions(filtered);
}

function renderSubmissions(subs) {
    loadingState.hidden = true;

    if (!subs || subs.length === 0) {
        emptyState.hidden = false;
        submissionsList.innerHTML = '';
        return;
    }

    emptyState.hidden = true;
    try {
        submissionsList.innerHTML = subs.map(sub => renderCard(sub)).join('');
    } catch (err) {
        loadingState.hidden = false;
        loadingState.innerHTML = `<p style="color:#ef4444">渲染失败：${err.message}</p>`;
    }
}

function renderCard(sub) {
    const d = sub.data || {};
    const info = d.basicInfo || {};
    const images = d.images || [];
    const hasRemarks = sub.remarks && sub.remarks.trim();
    const submitter = sub.submitter;

    const dateStr = sub.createdAt
        ? new Date(sub.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';

    return `<div class="sub-card" id="card-${sub.id}">
        <div class="sub-card-head">
            <div class="sub-card-title">
                <span class="sub-product" id="product-${sub.id}">${esc(info['型号'] || '未知产品')}</span>
                <button type="button" onclick="editSubmissionName('${sub.id}')" title="修改名称" style="border:none;background:#f3f4f6;color:#6366f1;border-radius:7px;padding:3px 8px;cursor:pointer;font-size:0.75rem;font-weight:700">编辑名称</button>
                <span class="tag tag-type">${esc(sub.taskType || '')}</span>
                ${sub.eta ? `<span class="tag" style="background:#fef3c7;color:#f59e0b">⏰ 预计${esc(sub.eta)}完成</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:10px">
                <div class="sub-meta">${dateStr}</div>
                <button onclick="deleteSubmission('${sub.id}')" title="删除" style="background:none;border:none;cursor:pointer;color:#d1d5db;font-size:1.1rem;line-height:1;padding:2px 4px" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#d1d5db'">✕</button>
            </div>
        </div>
        <div class="sub-body">
            ${info['交表时间'] ? `<span class="sub-chip">交表 ${esc(info['交表时间'])}</span>` : ''}
            ${info['图片数量'] ? `<span class="sub-chip">${esc(String(info['图片数量']))}</span>` : ''}
            ${images.length > 0 ? `<span class="sub-chip">${images.length} 张图片需求</span>` : ''}
            ${info['颜色要求'] ? `<span class="sub-chip">${esc(String(info['颜色要求']).slice(0, 20))}${String(info['颜色要求']).length > 20 ? '…' : ''}</span>` : ''}
            ${info['品牌'] ? `<span class="sub-chip">品牌: ${esc(info['品牌'])}</span>` : ''}
            ${info['亚马逊名称'] ? `<span class="sub-chip">亚马逊: ${esc(String(info['亚马逊名称']).slice(0, 30))}${String(info['亚马逊名称']).length > 30 ? '…' : ''}</span>` : ''}
            ${info['售后邮箱'] && info['售后邮箱'] !== '未提供' ? `<span class="sub-chip">📧 ${esc(info['售后邮箱'])}</span>` : ''}
            ${info['包装尺寸'] ? `<span class="sub-chip">📏 ${esc(info['包装尺寸'])}</span>` : ''}
            ${info['需要时间'] ? `<span class="sub-chip">⏰ ${esc(info['需要时间'])}</span>` : ''}
        </div>
        ${hasRemarks ? `<div class="sub-remarks">${esc(sub.remarks)}</div>` : ''}
        ${(d.directPhotoKeys && d.directPhotoKeys.length) ? `
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0">
                ${d.directPhotoKeys.map(k => `
                    <a href="/api/library-file/${encodeURIComponent(k.key)}?dl=1" download="${esc(k.name || '')}" title="下载 ${esc(k.name || '')}" style="width:72px;height:72px;display:block">
                        <img src="/api/library-file/${encodeURIComponent(k.key)}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb" loading="lazy">
                    </a>
                `).join('')}
            </div>
            ${d.directDesc ? `<div style="font-size:0.85rem;color:#374151;margin-bottom:6px">描述：${esc(d.directDesc)}</div>` : ''}
        ` : ''}
        ${submitter ? `
            <div class="sub-submitter">
                ${submitter.avatar ? `<img class="sub-submitter-avatar" src="${esc(submitter.avatar)}" alt="">` : ''}
                <span class="sub-submitter-name">${esc(submitter.name || '')}</span>
                <span class="sub-submitter-dept">提交</span>
            </div>
        ` : ''}
        ${images.length > 0 ? `
            <span class="sub-toggle" onclick="toggleImages(this)">查看详情 ↓</span>
            <div class="sub-images" hidden>
                ${images.filter(img => img.photoKey).length > 0 ? `
                    <div style="margin-bottom:12px">
                        <div style="font-size:0.85rem;font-weight:600;color:#6b7280;margin-bottom:8px">📷 产品图片：</div>
                        <div style="display:flex;flex-wrap:wrap;gap:8px">
                            ${images.filter(img => img.photoKey).map(img => `
                                <a href="/api/library-file/${encodeURIComponent(img.photoKey)}?dl=1" download="${esc(img.photoName || '')}" title="下载 ${esc(img.photoName || '')}" style="width:120px;height:120px;display:block">
                                    <img src="/api/library-file/${encodeURIComponent(img.photoKey)}" style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb" loading="lazy">
                                </a>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                ${images.filter(img => img.图片要求).length > 0 ? `<div style="font-size:0.85rem;font-weight:600;color:#6b7280;margin-bottom:8px">📋 图片需求：</div>` : ''}
                ${images.filter(img => img.图片要求).slice(0, 5).map(img => `
                    <div class="sub-img-row">
                        <span class="sub-img-num">${esc(String(img.序号 || ''))}</span>
                        <span>${esc(String(img.图片要求 || '').slice(0, 60))}${String(img.图片要求 || '').length > 60 ? '…' : ''}</span>
                    </div>
                `).join('')}
                ${images.filter(img => img.图片要求).length > 5 ? `<div style="font-size:0.8rem;color:#9ca3af;padding:4px 0">还有 ${images.filter(img => img.图片要求).length - 5} 张...</div>` : ''}
            </div>
        ` : ''}
        <div class="sub-actions">
            <div style="display:flex;gap:6px;align-items:center">
                <button class="btn-icon" onclick="openSortModal()" title="排序"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg></button>
                ${sub.fileKey ? `<button class="btn-download-original" onclick="downloadOriginal('${sub.id}')">📎 下载原表格</button>` : ''}
            </div>
            <div style="display:flex;gap:8px">
                <button class="btn-processing" onclick="markProcessing('${sub.id}')">🛠 处理中</button>
                <button class="btn-eta" onclick="openEta('${sub.id}')">⏰ 预计完成时间</button>
                <button class="btn-reject" onclick="openReject('${sub.id}')">驳回</button>
                <button class="btn-complete" onclick="completeSubmission('${sub.id}')">✓ 完成</button>
            </div>
        </div>
    </div>`;
}

function toggleImages(el) {
    const imagesDiv = el.nextElementSibling;
    const hidden = imagesDiv.hidden;
    imagesDiv.hidden = !hidden;
    el.textContent = hidden ? '收起 ↑' : '查看图片需求 ↓';
}

async function deleteSubmission(id) {
    if (!confirm('确认删除这个需求？删除后不可恢复。')) return;
    const card = document.getElementById('card-' + id);
    if (card) card.style.opacity = '0.55';
    try {
        const res = await fetch('/api/submissions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || res.status);
        if (card) card.remove();
        allData = allData.filter(x => x.id !== id);
        renderStats({ total: allData.length });
        if (!submissionsList.querySelector('.sub-card')) emptyState.hidden = false;
    } catch (e) {
        if (card) card.style.opacity = '1';
        alert('删除失败：' + e.message);
    }
}

async function editSubmissionName(id) {
    const current = document.getElementById('product-' + id)?.textContent || '';
    const name = prompt('请输入新的产品名称：', current === '未知产品' ? '' : current);
    if (name === null) return;
    const productName = name.trim();
    if (!productName) return alert('名称不能为空');
    try {
        const res = await fetch('/api/submissions', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, productName })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || res.status);
        const el = document.getElementById('product-' + id);
        if (el) el.textContent = productName;
        const item = allData.find(x => x.id === id);
        if (item) {
            item.data = item.data || {};
            item.data.basicInfo = item.data.basicInfo || {};
            item.data.basicInfo['型号'] = productName;
        }
    } catch (e) {
        alert('保存失败：' + e.message);
    }
}

let historyLoaded = false;

async function toggleHistory() {
    const content = document.getElementById('historyContent');
    const arrow = document.getElementById('historyArrow');
    if (!content) return;
    const willShow = content.hidden;
    content.hidden = !willShow;
    if (arrow) arrow.style.transform = willShow ? 'rotate(90deg)' : 'rotate(0deg)';
    if (willShow && !historyLoaded) {
        await loadHistory();
        historyLoaded = true;
    }
}

async function loadHistory() {
    const content = document.getElementById('historyContent');
    content.innerHTML = '<div style="color:#9ca3af;font-size:0.9rem">加载中...</div>';
    try {
        const res = await fetch('/api/submissions?history=1');
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || res.status);
        const list = json.submissions || [];
        if (!list.length) {
            content.innerHTML = '<div style="color:#9ca3af;font-size:0.9rem">暂无历史记录</div>';
            return;
        }
        content.innerHTML = list.map(renderHistoryCard).join('');
    } catch (e) {
        content.innerHTML = '<div style="color:#ef4444;font-size:0.9rem">加载失败：' + esc(e.message) + '</div>';
    }
}

function renderHistoryCard(sub) {
    const d = sub.data || {};
    const info = d.basicInfo || {};
    const statusText = sub.status === 'completed' ? ['已完成', '#10b981', '#ecfdf5'] : ['已驳回', '#ef4444', '#fef2f2'];
    const archivedStr = sub.archivedAt
        ? new Date(sub.archivedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
    const photos = (d.directPhotoKeys && d.directPhotoKeys.length) ? d.directPhotoKeys : [];
    return '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:10px">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
        + '<div style="display:flex;align-items:center;gap:10px">'
        + '<span style="font-weight:700;color:#111827">' + esc(info['型号'] || '未知产品') + '</span>'
        + '<span style="font-size:0.75rem;color:#6b7280">' + esc(sub.taskType || '') + '</span>'
        + '<span style="font-size:0.72rem;background:' + statusText[2] + ';color:' + statusText[1] + ';padding:2px 9px;border-radius:10px">' + statusText[0] + '</span>'
        + '</div>'
        + '<span style="font-size:0.76rem;color:#9ca3af">' + archivedStr + '</span>'
        + '</div>'
        + (sub.submitter ? '<div style="font-size:0.8rem;color:#6b7280;margin-bottom:6px">提交人：' + esc(sub.submitter.name || '') + '</div>' : '')
        + (sub.remarks ? '<div style="font-size:0.82rem;color:#374151;margin-bottom:6px">备注：' + esc(sub.remarks) + '</div>' : '')
        + (sub.resultMessage ? '<div style="font-size:0.82rem;color:#6b7280;margin-bottom:6px">处理说明：' + esc(sub.resultMessage) + '</div>' : '')
        + (photos.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">' + photos.map(k => '<a href="/api/library-file/' + encodeURIComponent(k.key) + '?dl=1" target="_blank" style="width:56px;height:56px;display:block"><img src="/api/library-file/' + encodeURIComponent(k.key) + '" style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb" loading="lazy"></a>').join('') + '</div>' : '')
        + (sub.fileKey ? '<button onclick="downloadOriginal(\'' + sub.id + '\')" style="font-size:0.78rem;color:#6366f1;background:#fff;border:1px solid #6366f1;border-radius:7px;padding:5px 12px;cursor:pointer">下载原表格</button>' : '')
        + '</div>';
}

let rejectImages = [];

function addRejectImage(file) {
    const reader = new FileReader();
    reader.onload = ev => {
        const base64 = ev.target.result.split(',')[1];
        const idx = rejectImages.length;
        rejectImages.push(base64);
        const preview = document.getElementById('rejectImagePreview');
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;display:inline-block';
        const img = document.createElement('img');
        img.src = ev.target.result;
        img.style.cssText = 'width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;display:block';
        const btn = document.createElement('button');
        btn.textContent = '×';
        btn.style.cssText = 'position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.55);color:white;border:none;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:12px;line-height:1;padding:0';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            rejectImages.splice(rejectImages.indexOf(base64), 1);
            wrap.remove();
        });
        wrap.appendChild(img);
        wrap.appendChild(btn);
        preview.appendChild(wrap);
        document.getElementById('rejectPasteZone').style.borderColor = '#6366f1';
    };
    reader.readAsDataURL(file);
}

function openReject(id) {
    pendingRejectId = id;
    rejectReason.value = '';
    document.getElementById('rejectImageInput').value = '';
    rejectImages = [];
    document.getElementById('rejectImagePreview').innerHTML = '';
    document.getElementById('rejectPasteZone').style.borderColor = '#d1d5db';
    document.getElementById('rejectPasteZone').style.color = '#9ca3af';
    rejectModal.removeAttribute('hidden');
    rejectModal.classList.add('modal--visible');
}

function openEta(id) {
    pendingEtaId = id;
    etaInput.value = '';
    etaNote.value = '';
    etaModal.removeAttribute('hidden');
    etaModal.classList.add('modal--visible');
}

async function sendEta(id, etaValue, note) {
    const card = document.getElementById(`card-${id}`);
    const etaText = etaValue;

    if (card) card.style.opacity = '0.6';
    try {
        const res = await fetch('/api/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submissionId: id, action: 'eta', eta: etaText, message: note })
        });
        const json = await res.json();
        if (res.ok && json.ok) {
            if (card) {
                card.style.opacity = '';
                let badge = card.querySelector('.sub-eta-badge');
                if (!badge) {
                    badge = document.createElement('div');
                    badge.className = 'sub-eta-badge';
                    const body = card.querySelector('.sub-body');
                    if (body) body.parentNode.insertBefore(badge, body.nextSibling);
                    else card.appendChild(badge);
                }
                badge.textContent = `⏰ 预计完成：${etaText}`;
            }
            const sub = allData.find(s => s.id === id);
            if (sub) sub.eta = etaText;
        } else {
            if (card) card.style.opacity = '';
            alert('发送失败：' + (json.error || res.status));
        }
    } catch (err) {
        if (card) card.style.opacity = '';
        alert('网络错误：' + err.message);
    }
}

async function markProcessing(id) {
    const card = document.getElementById(`card-${id}`);
    if (card) card.style.opacity = '0.6';
    try {
        const res = await fetch('/api/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submissionId: id, action: 'processing', message: '' })
        });
        const json = await res.json();
        if (res.ok && json.ok) {
            if (card) {
                card.style.opacity = '';
                let badge = card.querySelector('.sub-processing-badge');
                if (!badge) {
                    badge = document.createElement('div');
                    badge.className = 'sub-processing-badge';
                    const body = card.querySelector('.sub-body');
                    if (body) body.parentNode.insertBefore(badge, body.nextSibling);
                    else card.appendChild(badge);
                }
                badge.textContent = '🛠 处理中';
            }
            const sub = allData.find(s => s.id === id);
            if (sub) sub.status = 'processing';
        } else {
            if (card) card.style.opacity = '';
            alert('操作失败：' + (json.error || res.status));
        }
    } catch (err) {
        if (card) card.style.opacity = '';
        alert('网络错误：' + err.message);
    }
}

async function completeSubmission(id) {
    if (!confirm('确认标记为完成？完成后记录将从列表中移除并通知提交人。')) return;
    await updateStatus(id, 'complete', '');
}

async function updateStatus(id, action, message, images = []) {
    const card = document.getElementById(`card-${id}`);
    if (card) {
        card.style.opacity = '0.5';
        card.style.pointerEvents = 'none';
    }

    try {
        const res = await fetch('/api/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submissionId: id, action, message, images })
        });
        const json = await res.json();

        if (res.ok && json.ok) {
            card?.remove();
            allData = allData.filter(s => s.id !== id);
            historyLoaded = false;
            const remaining = document.querySelectorAll('.sub-card').length;
            if (remaining === 0) emptyState.hidden = false;
            const total = statsEl.querySelector('.stat-card .stat-val');
            if (total) total.textContent = String(Math.max(0, parseInt(total.textContent) - 1));
        } else {
            if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
            alert('操作失败：' + (json.error || res.status));
        }
    } catch (err) {
        if (card) { card.style.opacity = ''; card.style.pointerEvents = ''; }
        alert('网络错误：' + err.message);
    }
}

function downloadOriginal(id) {
    window.location.href = `/api/download/${id}`;
}

function downloadCSV(id) {
    const sub = allData.find(s => s.id === id);
    if (!sub) return;

    const rows = [];
    rows.push(['序号', '区域', '图片要求', '尺寸', '文案', '参考链接']);
    for (const img of (sub.data.images || [])) {
        rows.push([img.序号, img.区域, img.图片要求, img.尺寸, img.文案, img.参考链接].map(v => `"${String(v || '').replace(/"/g, '""')}"`));
    }

    const info = sub.data.basicInfo || {};
    rows.unshift([]);
    rows.unshift([`"型号: ${info['型号'] || ''}  类型: ${sub.taskType}  交表: ${info['交表时间'] || ''}"`]);

    const csvContent = '\uFEFF' + rows.map(r => Array.isArray(r) ? r.join(',') : r).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${info['型号'] || 'submission'}_${sub.taskType}_解析结果.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function deleteSubmission(id) {
    
    try {
        const res = await fetch('/api/update-status', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submissionId: id, action: 'reject', message: '管理员删除' })
        });
        if (res.ok) {
            const card = document.getElementById('card-' + id);
            if (card) card.remove();
        }
    } catch(e) { alert('删除失败：' + e.message); }
}

// ── Library Management ──────────────────────────────────
let libPendingFiles = [];

function initLibrary() {
    document.getElementById('librarySection').hidden = false;

    const libUploadBtn = document.getElementById('libUploadBtn');
    const libFileInput = document.getElementById('libFileInput');
    const libFolderBtn = document.getElementById('libFolderBtn');
    const libFolderInput = document.getElementById('libFolderInput');
    const libFileAlreadyWired = libUploadBtn?.dataset.wired === '1';
    const libFolderAlreadyWired = libFolderBtn?.dataset.wired === '1';
    if (libUploadBtn) libUploadBtn.dataset.wired = '1';
    if (libFolderBtn) libFolderBtn.dataset.wired = '1';

    // ── Category management ──────────────────────────────
    const DEFAULT_CATS = ['美甲灯', '工具', '护理', '家居', '模特'];
    function loadCats() {
        try { return JSON.parse(localStorage.getItem('lib_categories')) || DEFAULT_CATS; }
        catch { return DEFAULT_CATS; }
    }
    function saveCats(cats) { localStorage.setItem('lib_categories', JSON.stringify(cats)); }

    function buildCategorySelect(selectEl, selectedVal) {
        const cats = loadCats();
        selectEl.innerHTML = '';
        cats.forEach(c => {
            const o = document.createElement('option');
            o.value = c; o.textContent = c;
            if (c === selectedVal) o.selected = true;
            selectEl.appendChild(o);
        });
        const addOpt = document.createElement('option');
        addOpt.value = '__add__'; addOpt.textContent = '＋ 新建分类…';
        selectEl.appendChild(addOpt);
    }

    function handleCategorySelect(selectEl, onPick) {
        selectEl.addEventListener('change', () => {
            if (selectEl.value !== '__add__') { if (onPick) onPick(selectEl.value); return; }
            const name = prompt('请输入新分类名称：');
            if (!name || !name.trim()) { selectEl.value = loadCats()[0]; return; }
            const trimmed = name.trim();
            const cats = loadCats();
            if (!cats.includes(trimmed)) { cats.push(trimmed); saveCats(cats); }
            buildCategorySelect(selectEl, trimmed);
            if (onPick) onPick(trimmed);
        });
    }

    const libCatSel = document.getElementById('libCategory');
    buildCategorySelect(libCatSel, loadCats()[0]);
    handleCategorySelect(libCatSel);

    // ── File pickers ─────────────────────────────────────
    if (!libFileAlreadyWired) {
        libUploadBtn.onclick = () => libFileInput.click();
        libFileInput.onchange = e => {
            const files = Array.from(e.target.files);
            if (!files.length) return;
            document.getElementById('libUploadStatus').textContent = '已选择 ' + files.length + ' 个文件，等待预览加载';
            files.forEach(addLibFile);
            e.target.value = '';
        };
    }

    if (!libFolderAlreadyWired) {
        libFolderBtn.onclick = () => libFolderInput.click();
        libFolderInput.onchange = e => {
            const files = Array.from(e.target.files);
            if (!files.length) return;
            const folderName = files[0].webkitRelativePath.split('/')[0];
            document.getElementById('libProduct').value = folderName;
            document.getElementById('libUploadStatus').textContent = '已选择文件夹“' + folderName + '”，共 ' + files.length + ' 个文件';
            files.forEach(addLibFile);
            e.target.value = '';
        };
    }

    document.getElementById('libConfirmBtn').addEventListener('click', async () => {
        await doLibUpload();
    });

    loadLibraryAdmin();
}

// Build a category <select> for the admin product detail panel (move category)
function buildMoveCatSelect(currentCat) {
    const DEFAULT_CATS = ['美甲灯', '工具', '护理', '家居', '模特'];
    let cats;
    try { cats = JSON.parse(localStorage.getItem('lib_categories')) || DEFAULT_CATS; }
    catch { cats = DEFAULT_CATS; }
    let html = '';
    cats.forEach(c => {
        html += `<option value="${esc(c)}"${c === currentCat ? ' selected' : ''}>${esc(c)}</option>`;
    });
    html += `<option value="__add__">＋ 新建分类…</option>`;
    return html;
}

function addLibFile(file) {
    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();
    reader.onload = ev => {
        const base64 = ev.target.result.split(',')[1];
        const idx = libPendingFiles.length;
        libPendingFiles.push({ name: file.name, base64, mimeType: file.type });

        const preview = document.getElementById('libUploadPreview');
        preview.style.display = 'grid';
        const wrap = document.createElement('div');
        wrap.className = 'lib-upload-thumb';
        wrap.dataset.idx = idx;
        wrap.innerHTML = `
            ${isImage ? `<img src="${ev.target.result}" alt="">` : `<div style="height:80px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:0.75rem">文件</div>`}
            <button onclick="removeLibFile(${idx}, this.parentNode)">×</button>
            <div class="lib-upload-name">${esc(file.name)}</div>`;
        preview.appendChild(wrap);
        document.getElementById('libConfirmBtn').hidden = false;

        const uploadProductInput = document.getElementById('libProduct');
        if (!uploadProductInput.value.trim()) uploadProductInput.focus();
    };
    reader.readAsDataURL(file);
}

function removeLibFile(idx, el) {
    libPendingFiles[idx] = null;
    el.remove();
    if (!document.querySelectorAll('#libUploadPreview .lib-upload-thumb').length) {
        document.getElementById('libUploadPreview').style.display = 'none';
        document.getElementById('libConfirmBtn').hidden = true;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('libUploadBtn');
    if (!btn) return;
    btn.addEventListener('keydown', async e => {
        if (e.key !== 'Enter') return;
        await doLibUpload();
    });
});

async function doLibUpload() {
    const product = document.getElementById('libProduct').value.trim();
    const category = document.getElementById('libCategory')?.value || '未分类';
    if (!product) { alert('请先填写产品名称'); document.getElementById('libProduct').focus(); return; }
    const files = libPendingFiles.filter(Boolean);
    if (!files.length) { alert('请先选择文件'); return; }

    const status = document.getElementById('libUploadStatus');
    status.textContent = '上传中...';

    try {
        const uploaded = [];
        for (let i = 0; i < files.length; i++) {
            status.textContent = '上传中...（' + (i + 1) + '/' + files.length + '）';
            const res = await fetch('/api/library-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product, category, files: [files[i]] })
            });
            const json = await res.json();
            if (!res.ok || !json.ok) {
                throw new Error(json.error || ('第 ' + (i + 1) + ' 个文件上传失败'));
            }
            uploaded.push(...(json.uploaded || []));
        }

        status.textContent = `✓ 已上传 ${uploaded.length} 个文件`;
        libPendingFiles = [];
        document.getElementById('libUploadPreview').innerHTML = '';
        document.getElementById('libUploadPreview').style.display = 'none';
        document.getElementById('libProduct').value = '';
        document.getElementById('libConfirmBtn').hidden = true;
        loadLibraryAdmin();
    } catch (e) {
        status.textContent = '上传失败：' + e.message;
    }
}

async function loadLibraryAdmin() {
    const container = document.getElementById('libAdminContent');
    container.innerHTML = '<p style="color:#9ca3af;font-size:0.85rem">加载中...</p>';
    try {
        const res = await fetch('/api/library');
        const json = await res.json();
        if (!json.ok || !Object.keys(json.categories || {}).length) {
            container.innerHTML = '<p style="color:#9ca3af;font-size:0.85rem;padding:16px 0">暂无文件</p>';
            return;
        }
        container.innerHTML = '';

        const folderGrid = document.createElement('div');
        folderGrid.className = 'library-grid';
        folderGrid.style.marginBottom = '16px';
        container.appendChild(folderGrid);

        const detailPanel = document.createElement('div');
        detailPanel.id = 'adminLibDetail';
        detailPanel.hidden = true;
        detailPanel.style.cssText = 'background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.07);margin-bottom:12px';
        container.appendChild(detailPanel);

        const allGroups = {};
        for (const [cat, products] of Object.entries(json.categories)) {
            for (const [product, files] of Object.entries(products)) {
                allGroups[`${cat}/${product}`] = { cat, product, files };
            }
        }

        function renderFolders() {
            folderGrid.innerHTML = '';
            for (const [, { cat, product, files }] of Object.entries(allGroups)) {
                const cover = files.find(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f.name)) || files[0];
                const isImg = /\.(png|jpg|jpeg|webp|gif)$/i.test(cover.name);
                const card = document.createElement('div');
                card.className = 'lib-card';
                card.style.cssText = 'cursor:pointer;position:relative';
                card.innerHTML = `
                    <div class="lib-card-img-wrap" style="position:relative">
                        ${isImg ? `<img src="/api/library-file/${encodeURIComponent(cover.key)}" alt="" loading="lazy">` : `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`}
                        <span style="position:absolute;bottom:6px;right:8px;background:rgba(0,0,0,0.5);color:#fff;font-size:0.7rem;padding:2px 7px;border-radius:10px">${files.length} 个</span>
                    </div>
                    <div class="lib-card-body">
                        <div class="lib-card-name">${esc(product)}</div>
                        <div class="lib-card-meta" style="color:#9ca3af">${esc(cat)}</div>
                        <div class="lib-card-meta" style="color:#6366f1">点击管理 →</div>
                    </div>`;
                const delBtn = document.createElement('button');
                delBtn.title = '删除整个文件夹';
                delBtn.style.cssText = 'position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;background:rgba(220,38,38,0.85);color:#fff;border:none;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;z-index:10;opacity:0;transition:opacity 0.15s';
                delBtn.textContent = '×';
                delBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!confirm(`确认删除「${product}」文件夹及其全部 ${files.length} 个文件？`)) return;
                    for (const f of files) {
                        await fetch('/api/library-upload', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: f.key }) });
                    }
                    delete allGroups[`${cat}/${product}`];
                    detailPanel.hidden = true;
                    renderFolders();
                });
                card.appendChild(delBtn);
                card.addEventListener('mouseenter', () => delBtn.style.opacity = '1');
                card.addEventListener('mouseleave', () => delBtn.style.opacity = '0');
                card.addEventListener('click', () => openAdminFolder(product, files, detailPanel, allGroups, renderFolders));
                folderGrid.appendChild(card);
            }
            if (!Object.keys(allGroups).length) {
                folderGrid.innerHTML = '<p style="color:#9ca3af;font-size:0.85rem;padding:8px 0">暂无文件</p>';
            }
        }
        renderFolders();

    } catch (e) {
        container.innerHTML = '<p style="color:#ef4444;font-size:0.85rem">加载失败：' + e.message + '</p>';
    }
}


function openAdminFolder(product, files, detailPanel, groups, renderFolders) {
    detailPanel.hidden = false;
    detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    renderAdminDetail(product, files, detailPanel, groups, renderFolders);
}

function renderAdminDetail(product, files, detailPanel, groups, renderFolders) {
    detailPanel.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px';

    const left = document.createElement('div');
    left.style.cssText = 'display:flex;align-items:center;gap:10px';

    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = '← 收起';
    collapseBtn.style.cssText = 'background:none;border:1.5px solid #e5e7eb;border-radius:7px;padding:4px 10px;font-size:0.8rem;color:#6b7280;cursor:pointer';
    collapseBtn.onclick = () => { detailPanel.hidden = true; };

    const titleEl = document.createElement('span');
    titleEl.style.cssText = 'font-size:1rem;font-weight:700;color:#111827';
    titleEl.textContent = product;

    const renameBtn = document.createElement('button');
    renameBtn.textContent = '重命名';
    renameBtn.style.cssText = 'font-size:0.76rem;color:#6366f1;background:#eef2ff;border:1px solid #c7d2fe;border-radius:7px;padding:4px 9px;cursor:pointer;font-weight:600';
    renameBtn.onclick = async () => {
        const currentCat = (files[0]?.key || '').split('/')[1] ? decodeURIComponent((files[0].key).split('/')[1]) : '未分类';
        const newName = prompt('请输入新的文件夹名称：', product);
        if (!newName || !newName.trim()) return;
        const trimmed = newName.trim();
        if (trimmed === product) return;
        if (!confirm(`确认将「${product}」重命名为「${trimmed}」？`)) return;
        renameBtn.disabled = true;
        renameBtn.textContent = '重命名中...';
        try {
            for (const f of files) {
                const oldKey = f.key;
                const getRes = await fetch(`/api/library-file/${encodeURIComponent(oldKey)}`);
                if (!getRes.ok) throw new Error('读取文件失败：' + f.name);
                const blob = await getRes.blob();
                const base64 = await new Promise(resolve => {
                    const fr = new FileReader();
                    fr.onload = () => resolve(fr.result.split(',')[1]);
                    fr.readAsDataURL(blob);
                });
                await fetch('/api/library-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product: trimmed, category: currentCat, files: [{ name: f.name, base64, mimeType: blob.type }] }) });
                await fetch('/api/library-upload', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: oldKey }) });
            }
            detailPanel.hidden = true;
            loadLibraryAdmin();
        } catch (err) {
            alert('重命名失败：' + err.message);
            renameBtn.disabled = false;
            renameBtn.textContent = '重命名';
        }
    };

    const countEl = document.createElement('span');
    countEl.style.cssText = 'font-size:0.8rem;color:#9ca3af';
    countEl.textContent = files.length + ' 个文件';

    left.append(collapseBtn, titleEl, renameBtn, countEl);

    const appendBtn = document.createElement('button');
    appendBtn.textContent = '+ 追加文件';
    appendBtn.style.cssText = 'font-size:0.8rem;color:#6366f1;background:none;border:1.5px dashed #c7d2fe;border-radius:7px;padding:5px 12px;cursor:pointer';
    appendBtn.onclick = () => doLibUploadToProduct(product, currentCat, appendBtn);

    // ── Move category select ─────────────────────────────
    const currentCat = (files[0]?.key || '').split('/')[1] ? decodeURIComponent((files[0].key).split('/')[1]) : '未分类';
    const moveSel = document.createElement('select');
    moveSel.style.cssText = 'font-size:0.8rem;border:1.5px solid #e5e7eb;border-radius:7px;padding:5px 10px;cursor:pointer;color:#374151;background:#fff';
    moveSel.innerHTML = buildMoveCatSelect(currentCat);
    moveSel.addEventListener('change', async () => {
        let newCat = moveSel.value;
        if (newCat === '__add__') {
            const name = prompt('请输入新分类名称：');
            if (!name || !name.trim()) { moveSel.value = currentCat; return; }
            newCat = name.trim();
            const DEFAULT_CATS = ['美甲灯', '工具', '护理', '家居', '模特'];
            let cats;
            try { cats = JSON.parse(localStorage.getItem('lib_categories')) || DEFAULT_CATS; }
            catch { cats = DEFAULT_CATS; }
            if (!cats.includes(newCat)) { cats.push(newCat); localStorage.setItem('lib_categories', JSON.stringify(cats)); }
        }
        if (newCat === currentCat) return;
        if (!confirm(`将「${product}」移动到分类「${newCat}」？`)) { moveSel.value = currentCat; return; }
        moveSel.disabled = true;
        for (const f of files) {
            const oldKey = f.key;
            const newKey = `library/${encodeURIComponent(newCat)}/${encodeURIComponent(product)}/${encodeURIComponent(f.name)}`;
            const getRes = await fetch(`/api/library-file/${encodeURIComponent(oldKey)}`);
            if (!getRes.ok) continue;
            const blob = await getRes.blob();
            const base64 = await new Promise(resolve => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result.split(',')[1]);
                fr.readAsDataURL(blob);
            });
            await fetch('/api/library-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product, category: newCat, files: [{ name: f.name, base64, mimeType: blob.type }] }) });
            await fetch('/api/library-upload', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: oldKey }) });
        }
        detailPanel.hidden = true;
        loadLibraryAdmin();
    });

    const rightControls = document.createElement('div');
    rightControls.style.cssText = 'display:flex;align-items:center;gap:8px';
    rightControls.append(moveSel, appendBtn);

    header.append(left, rightControls);
    detailPanel.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'lib-upload-grid';

    for (const file of files) {
        const isImg = /\.(png|jpg|jpeg|webp|gif)$/i.test(file.name);
        const wrap = document.createElement('div');
        wrap.className = 'lib-upload-thumb';

        if (isImg) {
            const img = document.createElement('img');
            img.src = '/api/library-file/' + encodeURIComponent(file.key);
            img.alt = '';
            img.loading = 'lazy';
            img.style.cssText = 'width:100%;aspect-ratio:1;object-fit:contain;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb';
            wrap.appendChild(img);
        } else {
            const placeholder = document.createElement('div');
            placeholder.style.cssText = 'height:80px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:0.7rem';
            placeholder.textContent = '文件';
            wrap.appendChild(placeholder);
        }

        const delBtn = document.createElement('button');
        delBtn.textContent = '×';
        delBtn.style.cssText = 'position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:12px;line-height:1;padding:0';
        delBtn.onclick = () => deleteLibFile(file.key, wrap);
        wrap.appendChild(delBtn);

        const nameEl = document.createElement('div');
        nameEl.className = 'lib-upload-name';
        nameEl.textContent = file.name;
        wrap.appendChild(nameEl);

        grid.appendChild(wrap);
    }
    detailPanel.appendChild(grid);
}


async function deleteLibFile(key, el) {
    if (!confirm('确认删除此文件？')) return;
    try {
        const res = await fetch('/api/library-upload', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        const json = await res.json();
        if (res.ok && json.ok) { el.remove(); }
        else alert('删除失败：' + (json.error || res.status));
    } catch (e) { alert('网络错误：' + e.message); }
}

function doLibUploadToProduct(product, category, btn) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf,.zip,.ai,.psd';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async () => {
        const files = Array.from(input.files || []);
        input.remove();
        if (!files.length) return;
        const oldText = btn.textContent;
        btn.disabled = true;
        try {
            for (let i = 0; i < files.length; i++) {
                btn.textContent = '上传中 ' + (i + 1) + '/' + files.length;
                const file = files[i];
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = ev => resolve(ev.target.result.split(',')[1]);
                    reader.onerror = () => reject(new Error('读取失败：' + file.name));
                    reader.readAsDataURL(file);
                });
                const res = await fetch('/api/library-upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product, category, files: [{ name: file.name, base64, mimeType: file.type }] })
                });
                const json = await res.json();
                if (!res.ok || !json.ok) throw new Error(json.error || ('上传失败：' + file.name));
            }
            btn.textContent = '✓ 已追加';
            setTimeout(loadLibraryAdmin, 400);
        } catch (err) {
            alert('追加失败：' + err.message);
            btn.disabled = false;
            btn.textContent = oldText;
        }
    };
    input.click();
}

checkAuth();


// ── Studio task management (admin) ───────────────────────
async function loadStudioAdmin() {
    const container = document.getElementById('studioAdminContent');
    if (!container) return;
    container.innerHTML = '<p style="color:#9ca3af;font-size:0.85rem">加载中...</p>';
    try {
        const res = await fetch('/api/studio-tasks?all=1');
        const json = await res.json();
        // 发送给 RPA 后继续显示；完成后也先保留，只有钉钉通知成功后才消失
        const tasks = (json.tasks || []).filter(t => {
            if (t.status === 'rejected') return false;
            if (t.status === 'done' && (t.dingtalkNotified || t.r2AutoNotified)) return false;
            return true;
        });
        
        // 统计分类
        const stats = { '图片': 0, '视频': 0, '设计': 0 };
        tasks.forEach(t => {
            if (t.category && stats.hasOwnProperty(t.category)) {
                stats[t.category]++;
            }
        });
        
        // 显示统计
        const statsContainer = document.getElementById('studioStats');
        if (statsContainer) {
            statsContainer.innerHTML = Object.entries(stats).map(([cat, count]) => 
                `<div style="padding:10px 16px;background:#f8fafc;border-radius:8px;font-size:0.85rem">
                    <span style="color:#6b7280">${cat}</span> 
                    <span style="font-weight:700;color:#111827;margin-left:6px">${count}</span>
                </div>`
            ).join('');
        }
        
        // 设置筛选器
        const filterSelect = document.getElementById('studioCategoryFilter');
        if (filterSelect) {
            filterSelect.onchange = () => renderStudioTasks(tasks, filterSelect.value);
        }
        
        if (!tasks.length) {
            container.innerHTML = '<p style="color:#9ca3af;font-size:0.85rem;padding:8px 0">暂无待处理任务</p>';
            return;
        }
        
        renderStudioTasks(tasks, 'all');
        
        tasks.forEach(task => {
            if (task.status === 'pending' && !task.sentToRpa) {
                const createdAt = typeof task.timestamp === 'number' ? task.timestamp : new Date(task.createdAt || task.timestamp || 0).getTime();
                startCountdownTimer(task.id, createdAt);
            }
        });
    } catch (e) {
        container.innerHTML = '<p style="color:#ef4444;font-size:0.85rem">加载失败：' + e.message + '</p>';
    }
}

function renderStudioTasks(allTasks, category) {
    const container = document.getElementById('studioAdminContent');
    if (!container) return;
    
    const filtered = category === 'all' ? allTasks : allTasks.filter(t => t.category === category);
    
    if (!filtered.length) {
        container.innerHTML = '<p style="color:#9ca3af;font-size:0.85rem;padding:8px 0">该分类暂无任务</p>';
        return;
    }
    
    container.innerHTML = '';
    filtered.forEach(task => container.appendChild(renderStudioTask(task)));
}

function renderStudioTask(task) {
    const st = task.status === 'done'
        ? ['待通知', '#16a34a', '#dcfce7']
        : task.status === 'processing'
            ? ['处理中', '#3b82f6', '#dbeafe']
            : ['待处理', '#f59e0b', '#fef3c7'];
    const modeText = task.mode === 'free' ? '自由模式' : '程序模式';
    const time = new Date(task.timestamp).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });

    const card = document.createElement('div');
    card.id = 'studio-card-' + task.id;
    card.style.cssText = 'background:#fff;border-radius:12px;padding:18px 20px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,0.07);position:relative';
    const delBtn = document.createElement('button');
    delBtn.title = '删除';
    delBtn.innerHTML = '✕';
    delBtn.style.cssText = 'position:absolute;top:14px;right:14px;background:none;border:none;cursor:pointer;color:#d1d5db;font-size:1.1rem;line-height:1';
    delBtn.onmouseover = () => delBtn.style.color = '#ef4444';
    delBtn.onmouseout = () => delBtn.style.color = '#d1d5db';
    delBtn.onclick = () => deleteStudioTask(task.id, card);
    // delBtn appended after html set

    const displayTaskTitle = task.imageName ? task.imageName.replace(/^[^-]+-/, '') : (task.submitter && task.submitter.name || '匿名');
    let html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'
        + '<div style="display:flex;align-items:center;gap:10px">'
        + '<span style="font-weight:700;color:#111827">' + esc(displayTaskTitle) + '</span>'
        + '<span style="font-size:0.8rem;color:#6b7280">' + modeText + '</span>'
        + '<span style="font-size:0.75rem;background:' + st[2] + ';color:' + st[1] + ';padding:2px 10px;border-radius:10px">' + st[0] + '</span>';
    if (task.status === 'pending' && !task.sentToRpa) {
        const createdAt = typeof task.timestamp === 'number' ? task.timestamp : new Date(task.createdAt || task.timestamp || 0).getTime();
        const elapsed = Date.now() - createdAt;
        const autoSendThreshold = 3 * 60 * 1000;
        if (elapsed < autoSendThreshold) {
            const remaining = Math.max(0, Math.floor((autoSendThreshold - elapsed) / 1000));
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            html += '<span id="countdown-' + task.id + '" style="font-size:0.72rem;background:#fef3c7;color:#f59e0b;padding:2px 10px;border-radius:10px">⏱ ' + mins + '分' + secs + '秒后自动发送</span>';
        }
    }
    html += '</div>'
        + '<span style="font-size:0.78rem;color:#9ca3af">' + time + '</span>'
        + '</div>';
    if (task.desc) html += '<div style="font-size:0.85rem;color:#374151;margin-bottom:3px">需求：' + esc(task.desc) + '</div>';
    const displayTitle = task.imageName ? task.imageName.replace(/^[^-]+-/, '') : '';
    if (displayTitle) html += '<div style="font-size:0.95rem;font-weight:600;color:#111827;margin-bottom:6px">' + esc(displayTitle) + '</div>';
    if (task.note) html += '<div style="font-size:0.85rem;color:#6b7280;margin-bottom:3px">补充：' + esc(task.note) + '</div>';
    card.innerHTML = html;
    card.appendChild(delBtn);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '✎ 编辑需求';
    editBtn.style.cssText = 'margin:4px 0 2px;font-size:0.78rem;color:#374151;background:#f3f4f6;border:none;border-radius:7px;padding:5px 14px;cursor:pointer;font-weight:600';

    const editWrap = document.createElement('div');
    editWrap.style.cssText = 'margin:8px 0';
    editWrap.hidden = true;
    editWrap.innerHTML = '<label style="font-size:0.78rem;color:#6b7280;display:block;margin-bottom:4px">编辑需求提示</label>'
        + '<textarea id="studioDesc-' + task.id + '" style="width:100%;min-height:64px;font-size:0.82rem;color:#374151;border:1px solid #e5e7eb;border-radius:8px;padding:8px;resize:vertical;line-height:1.5">' + esc(task.desc || '') + '</textarea>'
        + '<button type="button" id="studioDescSave-' + task.id + '" style="margin-top:6px;font-size:0.78rem;color:#6366f1;background:#fff;border:1px solid #6366f1;border-radius:7px;padding:5px 14px;cursor:pointer;font-weight:600">保存需求</button>';
    card.appendChild(editBtn);
    card.appendChild(editWrap);
    editBtn.onclick = () => {
        editWrap.hidden = !editWrap.hidden;
        editBtn.textContent = editWrap.hidden ? '✎ 编辑需求' : '收起编辑';
        if (!editWrap.hidden) editWrap.querySelector('textarea').focus();
    };
    editWrap.querySelector('#studioDescSave-' + task.id).onclick = (e) => saveStudioDesc(task.id, e.target);

    // source image thumbnails
    const allSrc = [...(task.refKeys||[]), ...(task.productKeys||[])];
    if (allSrc.length) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:10px 0';
        allSrc.forEach(k => {
            const a = document.createElement('a');
            a.href = '/api/library-file/' + encodeURIComponent(k.key) + '?dl=1';
            a.download = k.name;
            a.title = '下载 ' + k.name;
            a.style.cssText = 'width:70px;height:70px;display:block;flex-shrink:0';
            a.innerHTML = '<img src="/api/library-file/' + encodeURIComponent(k.key) + '" style="width:70px;height:70px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb" loading="lazy">';
            row.appendChild(a);
        });
        card.appendChild(row);
    }

    // Action bar: only 反馈 and 发送给RPA
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #f3f4f6;justify-content:flex-end';

    const feedbackBtn = document.createElement('button');
    feedbackBtn.textContent = '💬 发送反馈';
    feedbackBtn.style.cssText = 'font-size:0.82rem;color:#10b981;background:#fff;border:1px solid #10b981;border-radius:7px;padding:7px 16px;cursor:pointer;font-weight:600';
    feedbackBtn.onclick = () => sendFeedback(task, feedbackBtn);

    const rpaBtn = document.createElement('button');
    rpaBtn.textContent = task.sentToRpa ? '🔄 重新发送RPA' : '🤖 发送给RPA';
    rpaBtn.style.cssText = 'font-size:0.82rem;color:#fff;background:' + (task.sentToRpa ? '#f59e0b' : '#6366f1') + ';border:none;border-radius:7px;padding:7px 16px;cursor:pointer;font-weight:600';
    rpaBtn.onclick = () => sendToRpa(task.id, rpaBtn, card);

    const viewCodeBtn = document.createElement('button');
    viewCodeBtn.textContent = '📋 查看RPA代码';
    viewCodeBtn.style.cssText = 'font-size:0.82rem;color:#6366f1;background:#fff;border:1px solid #6366f1;border-radius:7px;padding:7px 16px;cursor:pointer;font-weight:600';
    viewCodeBtn.onclick = () => viewRpaCode(task);

    const uploadBtn = document.createElement('button');
    uploadBtn.textContent = '📤 手动上传图片';
    uploadBtn.style.cssText = 'font-size:0.82rem;color:#16a34a;background:#fff;border:1px solid #16a34a;border-radius:7px;padding:7px 16px;cursor:pointer;font-weight:600';
    uploadBtn.onclick = () => openManualUpload(task.id, card);

    actions.append(feedbackBtn, rpaBtn, viewCodeBtn, uploadBtn);
    card.appendChild(actions);
    return card;
}

function startCountdownTimer(taskId, createdAt) {
    const countdownEl = document.getElementById('countdown-' + taskId);
    if (!countdownEl) return;
    const autoSendThreshold = 3 * 60 * 1000;
    const interval = setInterval(() => {
        const elapsed = Date.now() - createdAt;
        const remaining = Math.max(0, Math.floor((autoSendThreshold - elapsed) / 1000));
        if (remaining <= 0) {
            clearInterval(interval);
            countdownEl.textContent = '⏱ 即将自动发送...';
            setTimeout(() => loadStudioAdmin(), 3000);
        } else {
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            countdownEl.textContent = '⏱ ' + mins + '分' + secs + '秒后自动发送';
        }
    }, 1000);
}

async function saveStudioDesc(taskId, btn) {
    const el = document.getElementById('studioDesc-' + taskId);
    if (!el) return;
    const desc = el.value;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '保存中...';
    try {
        const res = await fetch('/api/studio-tasks', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: taskId, desc })
        });
        const json = await res.json();
        if (res.ok && json.ok) {
            btn.textContent = '✓ 已保存';
            setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 1500);
        } else {
            alert('保存失败：' + (json.error || res.status));
            btn.disabled = false; btn.textContent = original;
        }
    } catch (e) {
        alert('网络错误：' + e.message);
        btn.disabled = false; btn.textContent = original;
    }
}

async function sendFeedback(task, btn) {
    openFeedbackModal(task.id, task.submitter && task.submitter.name || '用户');
}

function openFeedbackModal(taskId, submitterName) {
    const existing = document.getElementById('studioFeedbackModal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'studioFeedbackModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:14px;padding:24px 28px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.18)';
    box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
        + '<span style="font-size:1.05rem;font-weight:700;color:#111827">发送反馈给 ' + esc(submitterName) + '</span>'
        + '<button id="fbModalClose" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#9ca3af">&times;</button>'
        + '</div>'
        + '<textarea id="fbContent" placeholder="输入反馈内容..." style="width:100%;min-height:120px;font-size:0.9rem;color:#374151;border:1px solid #e5e7eb;border-radius:8px;padding:10px;resize:vertical;line-height:1.5;margin-bottom:12px"></textarea>'
        + '<div id="fbImagePreview" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px"></div>'
        + '<div id="fbPasteZone" tabindex="0" style="border:1.5px dashed #d1d5db;border-radius:8px;padding:14px;text-align:center;color:#9ca3af;font-size:0.85rem;cursor:pointer;margin-bottom:14px">点击选择 或 Ctrl+V 粘贴图片（可多张）</div>'
        + '<input type="file" id="fbImageInput" accept="image/*" multiple style="display:none">'
        + '<div style="display:flex;gap:8px">'
        + '<button id="fbCancelBtn" style="flex:1;padding:9px;background:#fff;color:#374151;border:1px solid #d1d5db;border-radius:8px;cursor:pointer;font-weight:600">取消</button>'
        + '<button id="fbSendBtn" style="flex:1;padding:9px;background:#10b981;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">发送</button>'
        + '</div>';
    modal.appendChild(box);
    document.body.appendChild(modal);
    
    let fbImages = [];
    const preview = box.querySelector('#fbImagePreview');
    const pasteZone = box.querySelector('#fbPasteZone');
    const imageInput = box.querySelector('#fbImageInput');
    
    function addImage(file) {
        const reader = new FileReader();
        reader.onload = ev => {
            const base64 = ev.target.result.split(',')[1];
            fbImages.push(base64);
            const wrap = document.createElement('div');
            wrap.style.cssText = 'position:relative;display:inline-block';
            const img = document.createElement('img');
            img.src = ev.target.result;
            img.style.cssText = 'width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;display:block';
            const rm = document.createElement('button');
            rm.textContent = '×';
            rm.style.cssText = 'position:absolute;top:-4px;right:-4px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:12px;line-height:1;padding:0';
            rm.onclick = e => { e.stopPropagation(); fbImages.splice(fbImages.indexOf(base64), 1); wrap.remove(); };
            wrap.appendChild(img);
            wrap.appendChild(rm);
            preview.appendChild(wrap);
        };
        reader.readAsDataURL(file);
    }
    
    pasteZone.onclick = () => imageInput.click();
    imageInput.onchange = e => {
        Array.from(e.target.files).forEach(addImage);
        e.target.value = '';
    };
    pasteZone.addEventListener('paste', e => {
        const items = Array.from(e.clipboardData.items).filter(i => i.type.startsWith('image/'));
        if (items.length) { e.preventDefault(); items.forEach(i => addImage(i.getAsFile())); }
    });
    document.addEventListener('paste', e => {
        if (!document.getElementById('studioFeedbackModal')) return;
        const items = Array.from(e.clipboardData.items).filter(i => i.type.startsWith('image/'));
        if (items.length) { e.preventDefault(); items.forEach(i => addImage(i.getAsFile())); }
    });
    
    box.querySelector('#fbModalClose').onclick = () => modal.remove();
    box.querySelector('#fbCancelBtn').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    
    box.querySelector('#fbSendBtn').onclick = async () => {
        const message = box.querySelector('#fbContent').value.trim();
        if (!message && !fbImages.length) { alert('请输入反馈内容或添加图片'); return; }
        const sendBtn = box.querySelector('#fbSendBtn');
        sendBtn.disabled = true;
        sendBtn.textContent = '发送中...';
        try {
            const res = await fetch('/api/send-feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ submissionId: taskId, message: message || '已反馈', images: fbImages })
            });
            const json = await res.json();
            if (!res.ok || !json.ok) throw new Error(json.error || res.status);
            sendBtn.textContent = '✓ 已发送';
            setTimeout(() => modal.remove(), 1200);
        } catch(e) {
            alert('发送失败: ' + e.message);
            sendBtn.disabled = false;
            sendBtn.textContent = '发送';
        }
    };
}

async function sendToRpa(taskId, btn, card) {
    const taskRaw = await fetch(`/api/studio-tasks?id=${taskId}`).then(r => r.json()).catch(() => null);
    const task = taskRaw?.task;
    const mode = task?.mode || 'free';
    
    const programWebhook = 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a3a40ac622e84b667229fde/invoke';
    const freeWebhook = 'https://api-rpa.bazhuayu.com/api/v1/bots/webhooks/6a31134a622e84b6672263ee/invoke';
    const url = mode === 'program' ? programWebhook : freeWebhook;
    
    const wasResend = task?.sentToRpa;
    if (wasResend && !confirm('该任务已经发送过RPA了，确认要重新发送吗？')) return;
    
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = wasResend ? '重发中...' : '发送中...';
    try {
        const res = await fetch('/api/studio-webhook', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, webhookUrl: url })
        });
        const json = await res.json();
        btn.disabled = false;
        if (res.ok && json.ok) {
            showRpaResult(true, json.sentBody, json.status, json.response);
            btn.textContent = wasResend ? '🔄 重新发送RPA' : '✓ 已发送RPA';
            btn.style.background = wasResend ? '#f59e0b' : '#8b5cf6';
            setTimeout(loadStudioAdmin, 300);
        } else {
            btn.textContent = originalText;
            showRpaResult(false, null, res.status, json.error || '发送失败');
        }
    } catch (e) {
        btn.disabled = false;
        btn.textContent = originalText;
        showRpaResult(false, null, null, e.message);
    }
}

async function viewRpaCode(task) {
    const origin = window.location.origin;
    const toUrls = (keys) => (keys || []).map(k => `${origin}/api/public-image/${btoa(k.key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`);
    const productUrls = toUrls(task.productKeys);
    const refUrls = toUrls(task.refKeys);
    const modelUrls = toUrls(task.modelKeys);
    const allImageUrls = [...productUrls, ...refUrls].filter(Boolean);
    const userDesc = [task.desc, task.want, task.note].filter(Boolean).join('；');
    const cleanUserDesc = userDesc.replace(/@参考图(\d+)/g, '参考图片$1').replace(/@图片(\d+)/g, '参考图片$1');
    const pickedSize = task.size ? String(task.size).match(/\d{3,5}\s*[x×]\s*\d{3,5}/)?.[0].replace(/[×\s]/g, 'x') || '1600x1600' : '1600x1600';
    const sizeInfo = '尺寸我要' + pickedSize + 'px';
    const referenceInfo = allImageUrls.length ? allImageUrls.map((url, i) => '图' + (i + 1) + '链接 ' + url).join(' ') : '';
    const modelInfo = modelUrls.length ? modelUrls.map(url => '请参考我上传的人物图片，保留人物的脸型、发型、五官特征和整体气质，不参考原图的姿势、动作、手部位置、身体角度和构图，身体动作真实、稳定、符合日常生活，身体姿势自然。人物链接： ' + url).join(' ') : '';
    const userNeed = cleanUserDesc ? '我需要：' + cleanUserDesc : '';
    const imageNameInfo = task.imageName ? '图片命名为"' + task.imageName + '"' : '';
    const descText = [referenceInfo, modelInfo, sizeInfo, '请只生成一张图片', userNeed, imageNameInfo].filter(Boolean).join(' ');

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:14px;padding:24px 28px;max-width:620px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.18)';
    box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
        + '<span style="font-size:1.05rem;font-weight:700;color:#111827">RPA 描述代码</span>'
        + '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#9ca3af">&times;</button>'
        + '</div>'
        + '<div style="font-size:0.82rem;color:#6b7280;margin-bottom:12px">以下是会发给八爪鱼 RPA 的完整描述文本：</div>'
        + '<textarea readonly style="width:100%;min-height:180px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;font-size:0.85rem;font-family:monospace;line-height:1.6;resize:vertical">' + descText + '</textarea>'
        + '<button onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(()=>{this.textContent=\'✓ 已复制\';setTimeout(()=>this.textContent=\'复制代码\',1500)})" style="margin-top:12px;padding:9px 18px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">复制代码</button>';
    modal.appendChild(box);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
}

async function openManualUpload(taskId, card) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:14px;padding:24px 28px;max-width:520px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.18)';
    box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
        + '<span style="font-size:1.05rem;font-weight:700;color:#111827">手动上传成品图</span>'
        + '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#9ca3af">&times;</button>'
        + '</div>'
        + '<input type="file" id="manualUploadInput" accept="image/*" multiple style="display:block;width:100%;padding:10px;border:1.5px dashed #d1d5db;border-radius:8px;font-size:0.85rem;margin-bottom:12px;cursor:pointer">'
        + '<div id="manualUploadPreview" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px"></div>'
        + '<div id="manualUploadStatus" style="font-size:0.85rem;color:#6b7280;margin-bottom:12px"></div>'
        + '<button id="manualUploadSubmit" style="width:100%;padding:10px;background:#16a34a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">上传并完成任务</button>';
    modal.appendChild(box);
    document.body.appendChild(modal);

    const input = box.querySelector('#manualUploadInput');
    const preview = box.querySelector('#manualUploadPreview');
    const status = box.querySelector('#manualUploadStatus');
    const submit = box.querySelector('#manualUploadSubmit');
    let files = [];

    input.onchange = () => {
        files = Array.from(input.files);
        preview.innerHTML = '';
        files.forEach((f, i) => {
            const reader = new FileReader();
            reader.onload = ev => {
                const img = document.createElement('img');
                img.src = ev.target.result;
                img.style.cssText = 'width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb';
                preview.appendChild(img);
            };
            reader.readAsDataURL(f);
        });
        status.textContent = `已选择 ${files.length} 张图片`;
    };

    submit.onclick = async () => {
        if (!files.length) { status.textContent = '请先选择图片'; status.style.color = '#ef4444'; return; }
        submit.disabled = true;
        submit.textContent = '上传中...';
        status.textContent = '正在上传...';
        status.style.color = '#6b7280';
        try {
            const fd = new FormData();
            fd.append('taskId', taskId);
            fd.append('password', localStorage.getItem('admin_password') || 'ylkj');
            files.forEach(f => fd.append('files', f));
            const res = await fetch('/api/studio-result-upload', { method: 'POST', body: fd });
            const json = await res.json();
            if (!res.ok || !json.ok) throw new Error(json.error || res.status);
            status.textContent = '✓ 上传成功，任务已完成';
            status.style.color = '#16a34a';
            setTimeout(() => { modal.remove(); if (card) card.remove(); loadStudioAdmin(); }, 1500);
        } catch (err) {
            status.textContent = '上传失败：' + err.message;
            status.style.color = '#ef4444';
            submit.disabled = false;
            submit.textContent = '上传并完成任务';
        }
    };
}

async function deleteStudioTask(id, card) {
    
    try {
        const res = await fetch('/api/studio-complete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: id, action: 'reject', message: '管理员删除' })
        });
        if (res.ok) {
            if (card) card.remove();
            const cont = document.getElementById('studioAdminContent');
            if (cont && !cont.querySelector('[id^=\"studio-card-\"]')) {
                cont.innerHTML = '<p style=\"color:#9ca3af;font-size:0.85rem;padding:8px 0\">暂无待处理任务</p>';
            }
        }
    } catch(e) { alert('删除失败：' + e.message); }
}

function showRpaResult(ok, sentBody, httpStatus, response) {
    const existing = document.getElementById('rpaResultModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'rpaResultModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:14px;padding:24px 28px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.18)';
    const title = ok ? '✓ 发送成功' : '✗ 发送失败';
    const titleColor = ok ? '#16a34a' : '#ef4444';
    const bodyStr = sentBody ? JSON.stringify(sentBody, null, 2) : '';
    const closeSnippet = 'document.getElementById(\"rpaResultModal\").remove()';
    let html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
        + '<span style="font-size:1.05rem;font-weight:700;color:' + titleColor + '">' + title + '</span>'
        + '<button onclick="' + closeSnippet + '" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#9ca3af">&times;</button>'
        + '</div>';
    if (httpStatus) html += '<div style="font-size:0.82rem;color:#6b7280;margin-bottom:12px">HTTP 状态码：' + httpStatus + '</div>';
    if (bodyStr) html += '<div style="font-size:0.82rem;color:#374151;font-weight:600;margin-bottom:6px">发送的 Body：</div>'
        + '<pre style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:0.8rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all">' + bodyStr + '</pre>';
    if (response) html += '<div style="font-size:0.82rem;color:#374151;font-weight:600;margin-top:12px;margin-bottom:6px">八爪鱼响应：</div>'
        + '<pre style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:0.8rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all">' + String(response) + '</pre>';
    html += '<button onclick="' + closeSnippet + '" style="margin-top:16px;width:100%;padding:9px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">关闭</button>';
    box.innerHTML = html;
    modal.appendChild(box);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
}


let studioHistoryLoaded = false;

async function toggleStudioHistory() {
    const content = document.getElementById('studioHistoryContent');
    const arrow = document.getElementById('studioHistoryArrow');
    if (!content) return;
    const willShow = content.hidden;
    content.hidden = !willShow;
    if (arrow) arrow.style.transform = willShow ? 'rotate(90deg)' : 'rotate(0deg)';
    if (willShow && !studioHistoryLoaded) {
        await loadStudioHistory();
        studioHistoryLoaded = true;
    }
}

async function loadStudioHistory() {
    const content = document.getElementById('studioHistoryContent');
    content.innerHTML = '<div style="color:#9ca3af;font-size:0.9rem;padding:8px 0">加载中...</div>';
    try {
        const res = await fetch('/api/studio-tasks?all=1');
        const json = await res.json();
        const tasks = (json.tasks || []).filter(t => t.status === 'done' && (t.dingtalkNotified || t.r2AutoNotified));
        if (!tasks.length) {
            content.innerHTML = '<div style="color:#9ca3af;font-size:0.9rem;padding:8px 0">暂无历史记录</div>';
            return;
        }
        content.innerHTML = '';
        tasks.forEach(task => content.appendChild(renderStudioHistoryCard(task)));
    } catch (e) {
        content.innerHTML = '<div style="color:#ef4444;font-size:0.9rem;padding:8px 0">加载失败：' + e.message + '</div>';
    }
}

function renderStudioHistoryCard(task) {
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:10px';
    
    const modeText = task.mode === 'free' ? '自由模式' : '程序模式';
    const time = new Date(task.timestamp).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    
    let html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
        + '<div style="display:flex;align-items:center;gap:10px">'
        + '<span style="font-weight:700;color:#111827">' + esc(task.submitter && task.submitter.name || '匿名') + '</span>'
        + '<span style="font-size:0.8rem;color:#6b7280">' + modeText + '</span>'
        + '<span style="font-size:0.72rem;background:#dcfce7;color:#16a34a;padding:2px 9px;border-radius:10px">已完成</span>'
        + '</div>'
        + '<span style="font-size:0.76rem;color:#9ca3af">' + time + '</span>'
        + '</div>';
    
    if (task.desc) html += '<div style="font-size:0.82rem;color:#374151;margin-bottom:6px">需求：' + esc(task.desc) + '</div>';
    const displayNameShort = task.imageName ? task.imageName.replace(/^[^-]+-/, '') : '';
    if (displayNameShort) html += '<div style="font-size:0.82rem;color:#6b7280;margin-bottom:6px">图片命名：' + esc(displayNameShort) + '</div>';
    
    card.innerHTML = html;
    
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin:10px 0';
    const viewCodeBtn = document.createElement('button');
    viewCodeBtn.textContent = '📋 查看RPA代码';
    viewCodeBtn.style.cssText = 'font-size:0.78rem;color:#6366f1;background:#fff;border:1px solid #6366f1;border-radius:7px;padding:5px 12px;cursor:pointer;font-weight:600';
    viewCodeBtn.onclick = () => viewRpaCode(task);
    btnRow.appendChild(viewCodeBtn);
    if (task.submitter) {
        const feedbackBtn = document.createElement('button');
        feedbackBtn.textContent = '发送反馈';
        feedbackBtn.style.cssText = 'font-size:0.78rem;color:#10b981;background:#fff;border:1px solid #10b981;border-radius:7px;padding:5px 12px;cursor:pointer;font-weight:600';
        feedbackBtn.onclick = () => openFeedbackModal(task.id, task.submitter.name || '');
        btnRow.appendChild(feedbackBtn);
    }
    card.appendChild(btnRow);
    
    if (task.desc) {
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.textContent = '查看关键词 ▼';
        toggleBtn.style.cssText = 'font-size:0.78rem;color:#6366f1;background:none;border:none;cursor:pointer;padding:4px 0;margin:6px 0';
        const keywordBox = document.createElement('div');
        keywordBox.hidden = true;
        keywordBox.style.cssText = 'background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin:6px 0;font-size:0.82rem;color:#374151;line-height:1.6;white-space:pre-wrap;word-break:break-word';
        keywordBox.textContent = task.desc;
        toggleBtn.onclick = () => {
            keywordBox.hidden = !keywordBox.hidden;
            toggleBtn.textContent = keywordBox.hidden ? '查看关键词 ▼' : '收起关键词 ▲';
        };
        card.appendChild(toggleBtn);
        card.appendChild(keywordBox);
    }
    
    const allSrc = [...(task.refKeys||[]), ...(task.productKeys||[])];
    if (allSrc.length) {
        const label = document.createElement('div');
        label.style.cssText = 'font-size:0.78rem;color:#9ca3af;margin:10px 0 6px';
        label.textContent = '提交素材';
        card.appendChild(label);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
        allSrc.slice(0, 4).forEach(k => {
            const a = document.createElement('a');
            a.href = '/api/library-file/' + encodeURIComponent(k.key) + '?dl=1';
            a.download = k.name;
            a.style.cssText = 'width:56px;height:56px;display:block';
            a.innerHTML = '<img src="/api/library-file/' + encodeURIComponent(k.key) + '" style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb" loading="lazy">';
            row.appendChild(a);
        });
        if (allSrc.length > 4) {
            const more = document.createElement('div');
            more.style.cssText = 'width:56px;height:56px;background:#f3f4f6;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:#6b7280';
            more.textContent = '+' + (allSrc.length - 4);
            row.appendChild(more);
        }
        card.appendChild(row);
    }
    
    if (task.resultKeys && task.resultKeys.length) {
        const label = document.createElement('div');
        label.style.cssText = 'font-size:0.82rem;color:#16a34a;font-weight:600;margin:14px 0 6px';
        label.textContent = '✓ 成品图（点击下载）';
        card.appendChild(label);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
        task.resultKeys.forEach(k => {
            const a = document.createElement('a');
            a.href = '/api/library-file/' + encodeURIComponent(k.key) + '?dl=1';
            a.download = k.name;
            a.title = '下载 ' + k.name;
            a.style.cssText = 'width:80px;height:80px;display:block';
            a.innerHTML = '<img src="/api/library-file/' + encodeURIComponent(k.key) + '" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb" loading="lazy">';
            row.appendChild(a);
        });
        card.appendChild(row);
    }
    
    return card;
}

function initExamplesToggle() {
    const btn = document.getElementById('examplesToggleBtn');
    const content = document.getElementById('examplesAdminContent');
    const arrow = document.getElementById('examplesToggleArrow');
    if (!btn || !content || btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
        const willOpen = content.hidden;
        content.hidden = !willOpen;
        if (arrow) arrow.style.transform = willOpen ? 'rotate(90deg)' : 'rotate(0deg)';
    });
}

async function loadExamplesAdmin() {
    const box = document.getElementById('examplesAdminContent');
    if (!box) return;
    box.innerHTML = '<div style="color:#9ca3af;font-size:0.9rem">加载中...</div>';
    try {
        const res = await fetch('/api/studio-examples?all=1');
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || res.status);
        const list = (json.examples || []).filter(x => x.source === 'custom');
        if (!list.length) {
            box.innerHTML = '<div style="color:#9ca3af;font-size:0.9rem">暂无用户上传案例</div>';
            return;
        }
        const pending = list.filter(x => x.status !== 'approved');
        const approved = list.filter(x => x.status === 'approved');
        box.innerHTML = section('待审核 (' + pending.length + ')', pending)
            + section('已通过 (' + approved.length + ')', approved);
    } catch (err) {
        box.innerHTML = '<div style="color:#ef4444;font-size:0.9rem">加载失败：' + escapeHtml(err.message) + '</div>';
    }
}

function section(title, list) {
    if (!list.length) return '<div style="margin-bottom:18px"><div style="font-weight:700;font-size:0.95rem;color:#111827;margin-bottom:10px">' + title + '</div><div style="color:#9ca3af;font-size:0.85rem">无</div></div>';
    return '<div style="margin-bottom:24px"><div style="font-weight:700;font-size:0.95rem;color:#111827;margin-bottom:10px">' + title + '</div>'
        + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">'
        + list.map(item => exampleCard(item)).join('')
        + '</div></div>';
}

function exampleCard(item) {
    const approved = item.status === 'approved';
    return '<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;background:#fff;display:flex;flex-direction:column">'
        + '<img src="' + item.image + '" style="width:100%;height:160px;object-fit:cover;display:block">'
        + '<div style="padding:12px;display:flex;flex-direction:column;gap:8px;flex:1">'
        + '<div style="font-weight:700;font-size:0.86rem;color:#111827">' + escapeHtml(item.title || '未命名案例') + '</div>'
        + '<textarea id="exPrompt-' + item.id + '" style="width:100%;min-height:70px;font-size:0.78rem;color:#374151;border:1px solid #e5e7eb;border-radius:8px;padding:8px;resize:vertical;line-height:1.45">' + escapeHtml(item.prompt || '') + '</textarea>'
        + '<div style="display:flex;gap:8px;margin-top:auto">'
        + '<button onclick="saveExamplePrompt(\'' + item.id + '\')" style="flex:1;padding:7px;border:1px solid #6366f1;background:#fff;color:#6366f1;border-radius:8px;cursor:pointer;font-size:0.78rem">保存提示词</button>'
        + (approved
            ? '<button onclick="setExampleStatus(\'' + item.id + '\',\'reject\')" style="flex:1;padding:7px;border:1px solid #f59e0b;background:#fff;color:#f59e0b;border-radius:8px;cursor:pointer;font-size:0.78rem">下架</button>'
            : '<button onclick="setExampleStatus(\'' + item.id + '\',\'approve\')" style="flex:1;padding:7px;border:1px solid #10b981;background:#10b981;color:#fff;border-radius:8px;cursor:pointer;font-size:0.78rem">审核通过</button>')
        + '<button onclick="deleteStudioExample(\'' + item.id + '\')" style="padding:7px 10px;border:1px solid #ef4444;background:#fff;color:#ef4444;border-radius:8px;cursor:pointer;font-size:0.78rem">删除</button>'
        + '</div></div></div>';
}

async function setExampleStatus(id, action) {
    const res = await fetch('/api/studio-examples', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) { alert('操作失败：' + (json.error || res.status)); return; }
    loadExamplesAdmin();
}

async function saveExamplePrompt(id) {
    const el = document.getElementById('exPrompt-' + id);
    if (!el) return;
    const prompt = el.value.trim();
    if (!prompt) { alert('提示词不能为空'); return; }
    const res = await fetch('/api/studio-examples', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, prompt })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) { alert('保存失败：' + (json.error || res.status)); return; }
    loadExamplesAdmin();
}

async function deleteStudioExample(id) {
    if (!confirm('确定删除这个案例？')) return;
    const res = await fetch('/api/studio-examples', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) { alert('删除失败：' + (json.error || res.status)); return; }
    loadExamplesAdmin();
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[ch]));
}

async function reorderTask(id, direction) {
    try {
        const res = await fetch('/api/reorder-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submissionId: id, direction })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || res.status);
        await loadSubmissions();
    } catch (e) {
        alert('排序失败：' + e.message);
    }
}

// ── Sort Modal & Urgent ──────────────────────────
let _sortModalEl, _sortListEl, _sortSaveBtn, _sortCloseBtn;
let _sortOrder = [];

function initSortModal() {
    _sortModalEl = document.getElementById('sortModal');
    _sortListEl = document.getElementById('sortList');
    _sortSaveBtn = document.getElementById('sortSaveBtn');
    _sortCloseBtn = document.getElementById('sortCloseBtn');
    const closeX = document.getElementById('sortModalClose');
    if (closeX) closeX.onclick = closeSortModal;
    if (_sortCloseBtn) _sortCloseBtn.onclick = closeSortModal;
    if (_sortSaveBtn) _sortSaveBtn.onclick = saveSortOrder;
}

function openSortModal() {
    if (!_sortModalEl) initSortModal();
    _loadSortList();
    _sortModalEl.hidden = false;
    setTimeout(() => _sortModalEl.classList.add('modal--visible'), 10);
}

function closeSortModal() {
    if (!_sortModalEl) return;
    _sortModalEl.classList.remove('modal--visible');
    setTimeout(() => { _sortModalEl.hidden = true; }, 200);
}

async function _loadSortList() {
    if (!_sortListEl) return;
    _sortListEl.innerHTML = '<div style="color:#9ca3af;padding:12px">加载中...</div>';
    try {
        const res = await fetch('/api/submissions');
        const json = await res.json();
        if (!json.ok || !json.submissions) {
            _sortListEl.innerHTML = '<div style="color:#9ca3af;padding:12px">暂无数据</div>';
            return;
        }
        _sortOrder = json.submissions
            .filter(function(s) { return !s.archived; })
            .map(function(s) {
                return {
                    id: s.id,
                    name: (s.data && s.data.basicInfo && s.data.basicInfo['型号']) || s.taskType || '未命名'
                };
            });
        _renderSortItems();
    } catch(e) {
        _sortListEl.innerHTML = '<div style="color:#ef4444;padding:12px">加载失败: ' + e.message + '</div>';
    }
}

function _renderSortItems() {
    if (!_sortListEl) return;
    _sortListEl.innerHTML = '';
    _sortOrder.forEach(function(item, idx) {
        var div = document.createElement('div');
        div.className = 'sort-item';
        var nameSpan = document.createElement('span');
        nameSpan.className = 'sort-item-name';
        nameSpan.textContent = item.name;
        nameSpan.style.cursor = 'pointer';
        nameSpan.title = '点击在管理台高亮显示';
        nameSpan.onclick = (function(id) { return function() { _highlightCard(id); }; })(item.id);
        div.appendChild(nameSpan);
        var actions = document.createElement('div');
        actions.className = 'sort-item-actions';
        var topBtn = document.createElement('button');
        topBtn.className = 'btn-sort-arrow';
        topBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 11 12 5 6 11"/><polyline points="18 18 12 12 6 18"/></svg>';
        topBtn.title = '置顶';
        topBtn.disabled = idx === 0;
        topBtn.onclick = (function(i) { return function() { _moveToTop(i); }; })(idx);
        actions.appendChild(topBtn);
        var upBtn = document.createElement('button');
        upBtn.className = 'btn-sort-arrow';
        upBtn.innerHTML = '↑';
        upBtn.disabled = idx === 0;
        upBtn.onclick = (function(i) { return function() { _moveItem(i, -1); }; })(idx);
        actions.appendChild(upBtn);
        var downBtn = document.createElement('button');
        downBtn.className = 'btn-sort-arrow';
        downBtn.innerHTML = '↓';
        downBtn.disabled = idx === _sortOrder.length - 1;
        downBtn.onclick = (function(i) { return function() { _moveItem(i, 1); }; })(idx);
        actions.appendChild(downBtn);
        div.appendChild(actions);
        _sortListEl.appendChild(div);
    });
}

function _moveItem(idx, dir) {
    var newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= _sortOrder.length) return;
    var tmp = _sortOrder[idx];
    _sortOrder[idx] = _sortOrder[newIdx];
    _sortOrder[newIdx] = tmp;
    _renderSortItems();
}

function _moveToTop(idx) {
    if (idx <= 0 || idx >= _sortOrder.length) return;
    var item = _sortOrder.splice(idx, 1)[0];
    _sortOrder.unshift(item);
    _renderSortItems();
}

function _highlightCard(id) {
    var card = document.getElementById('card-' + id);
    if (!card) return;
    // 临时关闭弹窗以便看到卡片
    if (_sortModalEl) {
        _sortModalEl.style.opacity = '0.15';
        _sortModalEl.style.pointerEvents = 'none';
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var original = card.style.boxShadow;
    var originalBorder = card.style.outline;
    card.style.transition = 'all 0.3s';
    card.style.outline = '3px solid #f59e0b';
    card.style.boxShadow = '0 0 24px rgba(245,158,11,0.6)';
    setTimeout(function() {
        card.style.outline = originalBorder || '';
        card.style.boxShadow = original || '';
        if (_sortModalEl) {
            _sortModalEl.style.opacity = '';
            _sortModalEl.style.pointerEvents = '';
        }
    }, 1800);
}

async function saveSortOrder() {
    if (!_sortSaveBtn) return;
    _sortSaveBtn.disabled = true;
    _sortSaveBtn.textContent = '保存中...';
    try {
        var newOrder = _sortOrder.map(function(s) { return s.id; });
        var res = await fetch('/api/save-order', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ order: newOrder })
        });
        var json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || res.status);
        // 立即本地重排（避免 KV 最终一致性延迟）
        if (typeof allData !== 'undefined' && Array.isArray(allData)) {
            var idxMap = {};
            newOrder.forEach(function(id, i) { idxMap[id] = i; });
            allData.sort(function(a, b) {
                var ai = idxMap[a.id], bi = idxMap[b.id];
                if (ai === undefined) ai = 999999;
                if (bi === undefined) bi = 999999;
                return ai - bi;
            });
            if (typeof filterSelect !== 'undefined' && filterSelect) {
                filterAndRender(filterSelect.value);
            }
        }
        closeSortModal();
    } catch(e) {
        alert('保存失败: ' + e.message);
    } finally {
        _sortSaveBtn.disabled = false;
        _sortSaveBtn.textContent = '保存';
    }
}

async function markUrgent(id) {
    try {
        var res = await fetch('/api/update-status', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({submissionId: id, action: 'urgent'})
        });
        var json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || res.status);
        await loadSubmissions();
    } catch(e) {
        alert('置顶失败: ' + e.message);
    }
}

document.addEventListener('DOMContentLoaded', initSortModal);
