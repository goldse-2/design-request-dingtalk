
function initStudioTypewriter() {
    const el = document.getElementById('studioTypewriter');
    if (!el) return;
    const lines = [
        '把图片放进去生成你的亚马逊图片吧。',
        '上传产品图，一键生成高转化主图。',
        '参考图加提示词，快速做出电商大片。',
        '不用设计基础，也能做出专业亚马逊视觉。',
        '选尺寸、放素材，剩下交给 AI 生成。'
    ];
    let line = 0, pos = 0, deleting = false;
    function tick() {
        const text = lines[line];
        el.textContent = deleting ? text.slice(0, pos--) : text.slice(0, pos++);
        let delay = deleting ? 35 : 70;
        if (!deleting && pos > text.length) { deleting = true; delay = 1500; }
        if (deleting && pos < 0) { deleting = false; line = (line + 1) % lines.length; pos = 0; delay = 350; }
        setTimeout(tick, delay);
    }
    tick();
}

let currentUser = null;
const requestedMode = new URLSearchParams(window.location.search).get('mode');
let currentMode = ['free', 'program', 'retouch', 'variant', 'resize'].includes(requestedMode) ? requestedMode : 'free';

const ANALYZE_PROMPT = `# 角色设定
你是一位拥有十年经验的亚马逊资深视觉拆解专家。你的任务是对用户上传的电商图片进行"逆向工程"，将其拆解为 1:1 像素级复刻的"图层蓝图"，并生成精准包含"人物互动"的素材生图提示词。

# 核心原则（必须无条件遵守）
1. 绝对忠于原图：严格基于当前上传的图片，严禁套用默认模板。
2. 图层化思维：区分"背景层"、"场景道具层"、"人货互动层"、"UI/排版层"。
3. 忽略品牌与具体文案：仅记录排版占位、字号权重和对齐方式。
4. 诚实反馈：遇到模糊或遮挡部分，明确标注「图片中未显示，需留白」。
5. 人货互动绑定法则（最重要）：如果画面中人物（或局部手模）与产品有物理接触或视线交互，必须精准描述接触点和动作姿态。在生成提示词时，绝不能将人物的动作与产品剥离。默认人物具备欧美面部特征。

# 任务流程与输出模板
请严格按照以下四个阶段依次输出，填补方括号 [ ] 中的内容：

## 【阶段一：看图校验（细节与互动捕获）】
- 画面事实：[列出3-5个微小事实]
- 人货互动确认：[明确指出是否有模特/手模，精确描述动作]
- 人物空间坐标：[精确定位人物在画面中的构图位置与景深层级]
- 物体视觉比例：[描述产品/物品与人物或画幅的尺度关系]
- 形体姿态拆解：[详细描述模特的肢体语言、重心分布与拍摄风格]

## 【阶段二：1:1 构图与比例蓝图】
- 画幅与网格：[推测长宽比，描述主体占据的网格位置]
- 视觉重心与景深：[描述Z轴空间]
- 构图拆解：[如：左图右文 / 对角线构图 / 居中特写]
- 相机角度：[如：45度侧俯 / 特写]

## 【阶段三：UI与排版层拆解】
- 主标题区：[位置坐标及排版特征，文案：]
- 副标题：[位置坐标及排版特征，文案：]
- 卖点/标签区：[位置坐标，图标样式及连接线走向]
- 色彩分布：[提取前 3 种主色调的直观描述]

## 【阶段四：重构提示词（Prompt）】
为了在设计软件中 1:1 还原此图，请提供重构清单，并生成英文生图提示词：
2. 场景与互动生成提示词（英文）：
要求：剔除文字和UI。如果原图包含人物互动，必须在提示词中生动描述该动作和手持的物品。明确光影、材质、空间和构图留白。
Prompt: [输出英文提示词]

注意：不要生成图片，不要生图，只要文字描述。`;

// ── Auth ─────────────────────────────────────────────────
function initAuth() {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    if (session) {
        try {
            const user = JSON.parse(decodeURIComponent(escape(atob(session))));
            setUser(user);
            sessionStorage.setItem('dt_user', JSON.stringify(user));
            localStorage.setItem('dt_user', JSON.stringify(user));
        } catch {}
        window.history.replaceState({}, '', window.location.pathname);
        return;
    }
    const stored = sessionStorage.getItem('dt_user') || localStorage.getItem('dt_user');
    if (stored) {
        try {
            const user = JSON.parse(stored);
            if (!user.unionId) { sessionStorage.removeItem('dt_user'); showLoginModal(); }
            else setUser(user);
            return;
        } catch {}
    }
    showLoginModal();
}

function setUser(user) {
    currentUser = user;
    document.body.classList.remove('auth-pending');
    const avatar = document.getElementById('userAvatar');
    if (avatar && user.avatar) { avatar.src = user.avatar; avatar.style.display = 'block'; }
    const btn = document.getElementById('userBtn');
    if (btn) { btn.title = user.name + '（点击退出）'; document.getElementById('loginIcon').style.display = 'none'; }
    hideLoginModal();
    revealHelpAndTip();
}

function clearUser() {
    currentUser = null;
    document.body.classList.add('auth-pending');
    sessionStorage.removeItem('dt_user');
    localStorage.removeItem('dt_user');
    const help = document.getElementById('helpBtn');
    if (help) help.classList.remove('help-btn--visible');
    const tip = document.getElementById('submitTip');
    if (tip) tip.classList.remove('submit-tip--visible');
    const avatar = document.getElementById('userAvatar');
    if (avatar) { avatar.src = ''; avatar.style.display = 'none'; }
    const btn = document.getElementById('userBtn');
    if (btn) { btn.title = '点击登录'; document.getElementById('loginIcon').style.display = 'block'; }
}

function handleUserBtnClick() { currentUser ? clearUser() : showLoginModal(); }
const loginModal = document.getElementById('loginModal');
function showLoginModal() { loginModal.removeAttribute('hidden'); loginModal.classList.add('login-page--visible'); showLoginStep('start'); }
function hideLoginModal() { loginModal.classList.remove('login-page--visible'); loginModal.hidden = true; }

const GUIDE_SEEN_KEY = 'studio_guide_seen';
const AGREE_KEY = 'studio_agreed';
function hasAgreed() { try { return localStorage.getItem(AGREE_KEY) === '1'; } catch { return false; } }
function onAgreeChange(checked) {
    const start = document.getElementById('guideStart');
    if (start) start.disabled = !checked;
}
function applyAgreementGate() {
    const agreed = hasAgreed();
    document.querySelectorAll('.studio-submit-btn, #freeSubmit, #progSubmit, #retouchSubmit, #variantSubmit').forEach(btn => {
        if (!btn) return;
        if (agreed) {
            btn.classList.remove('is-gated');
            btn.removeAttribute('title');
        } else {
            btn.classList.add('is-gated');
            btn.title = '请先阅读并同意《使用须知与隐私政策》';
        }
    });
}
function guideShowPage(n) {
    const p1 = document.getElementById('guidePage1');
    const p2 = document.getElementById('guidePage2');
    if (p1) p1.hidden = n !== 1;
    if (p2) p2.hidden = n !== 2;
}
function guideNext() { guideShowPage(2); }
function guideBack() { guideShowPage(1); }
function openGuide() {
    const m = document.getElementById('guideModal');
    if (m) m.classList.add('guide-modal--visible');
    guideShowPage(1);
    const chk = document.getElementById('guideAgree');
    const start = document.getElementById('guideStart');
    if (chk) chk.checked = hasAgreed();
    if (start) {
        start.disabled = !hasAgreed();
        start.textContent = currentUser ? '开始使用' : '同意并登录';
    }
}
function closeGuide() {
    const chk = document.getElementById('guideAgree');
    if (chk && !chk.checked) return;
    const m = document.getElementById('guideModal');
    if (m) m.classList.remove('guide-modal--visible');
    try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); localStorage.setItem(AGREE_KEY, '1'); } catch {}
    applyAgreementGate();
}

function startLoginFlow() {
    showLoginStep('guide');
}
function showLoginStep(step) {
    const map = { start: 'loginStepStart', guide: 'loginStepGuide', agree: 'loginStepAgree' };
    Object.values(map).forEach(id => document.getElementById(id)?.classList.remove('login-step--active'));
    document.getElementById(map[step])?.classList.add('login-step--active');
    loginModal.classList.toggle('login-page--flow', step !== 'start');
}
function loginFlowNext() { showLoginStep('agree'); }
function loginFlowBack() { showLoginStep('guide'); }
function confirmAgreeAndLogin() {
    const guideChk = document.getElementById('guideAgree');
    const loginChk = document.getElementById('loginAgree');
    if ((loginChk && !loginChk.checked) || (guideChk && !guideChk.checked && !loginChk)) return;
    try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); localStorage.setItem(AGREE_KEY, '1'); } catch {}
    window.location.href = '/api/dingtalk-auth';
}
function finishGuide() {
    if (currentUser) closeGuide();
    else confirmAgreeAndLogin();
}

const SUBMIT_TIP_KEY = 'submit_tip_seen';
function positionSubmitTip() {
    const tip = document.getElementById('submitTip');
    const anchor = document.getElementById('submitReqLink');
    if (!tip || !anchor) return;
    const r = anchor.getBoundingClientRect();
    tip.style.top = (r.top + r.height / 2) + 'px';
    tip.style.left = (r.right + 14) + 'px';
}
function showSubmitTip() {
    try { if (localStorage.getItem(SUBMIT_TIP_KEY) === '1') return; } catch {}
    const tip = document.getElementById('submitTip');
    if (!tip) return;
    positionSubmitTip();
    tip.classList.add('submit-tip--visible');
    try { localStorage.setItem(SUBMIT_TIP_KEY, '1'); } catch {}
}
function closeSubmitTip() {
    const tip = document.getElementById('submitTip');
    if (tip) tip.classList.remove('submit-tip--visible');
    try { localStorage.setItem(SUBMIT_TIP_KEY, '1'); } catch {}
}

function revealHelpAndTip() {
    const help = document.getElementById('helpBtn');
    if (help && !help.classList.contains('help-btn--visible')) {
        setTimeout(() => help.classList.add('help-btn--visible'), 300);
    }
    setTimeout(showSubmitTip, 1100);
    try {
        if (!localStorage.getItem(GUIDE_SEEN_KEY)) setTimeout(openGuide, 400);
    } catch {}
}
window.addEventListener('resize', positionSubmitTip);

initAuth();
applyAgreementGate();

// ── Form rendering ───────────────────────────────────────
function renderSizePicker(inputId) {
    return `
                <div class="size-visual-picker" id="${inputId}Picker">
                    <input type="hidden" id="${inputId}" value="2K 自动识别">
                    <div class="size-picker-title">分辨率</div>
                    <div class="size-resolution-row">
                        <button type="button" class="active" data-size-value="2K 自动识别">2K 默认</button>
                        <button type="button" data-size-value="亚马逊主图 1600x1600">1600</button>
                        <button type="button" data-size-value="A+尺寸 1464x600">A+</button>
                        <button type="button" data-size-custom="1">自定义</button>
                    </div>
                    <div class="size-picker-title">Size</div>
                    <div class="size-card-grid">
                        <button type="button" class="size-card" data-size-value="亚马逊主图 1600x1600"><span class="size-card-icon square"></span><strong>1:1</strong><small>1600 × 1600</small></button>
                        <button type="button" class="size-card" data-size-value="A+尺寸 1464x600"><span class="size-card-icon"></span><strong>A+</strong><small>1464 × 600</small></button>
                        <button type="button" class="size-card" data-size-value="相片比例 2048x1536"><span class="size-card-icon"></span><strong>4:3</strong><small>2048 × 1536</small></button>
                        <button type="button" class="size-card" data-size-value="常用图 800x600"><span class="size-card-icon"></span><strong>4:3</strong><small>800 × 600</small></button>
                        <button type="button" class="size-card" data-size-value="横版图 970x600"><span class="size-card-icon"></span><strong>97:60</strong><small>970 × 600</small></button>
                        <button type="button" class="size-card" data-size-custom="1"><span class="size-card-icon portrait"></span><strong>自定义</strong><small>自己输入</small></button>
                    </div>
                    <div class="size-custom-row" hidden>
                        <input type="number" min="100" max="9999" step="1" data-size-width placeholder="宽度 px">
                        <span>×</span>
                        <input type="number" min="100" max="9999" step="1" data-size-height placeholder="高度 px">
                    </div>
                </div>`;
}

const FREE_FORM = `
    <div class="studio-layout">
        <div class="studio-panel">
            <div class="sf-section">
                <div class="sf-label">模型</div>
                <div class="sf-model-select" id="modelSelect">
                    <div class="sf-model-card" id="modelTrigger" onclick="toggleModelDropdown()">
                        <div class="sf-model-icon">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6 6 0 0 0 4.98 4.18a5.98 5.98 0 0 0-3.99 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.05 6.05 0 0 0 5.77-4.19 5.98 5.98 0 0 0 3.99-2.9 6.05 6.05 0 0 0-.74-7.09zM13.26 22.43a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.5 4.5 0 0 1-4.49 4.49zM3.61 18.3a4.47 4.47 0 0 1-.54-3.02l.14.09 4.78 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.07L9.74 22a4.5 4.5 0 0 1-6.13-1.64zM2.34 7.9a4.48 4.48 0 0 1 2.34-1.97V11.6a.78.78 0 0 0 .39.68l5.81 3.36-2.02 1.16a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.9zm16.6 3.86l-5.84-3.4L15.12 7.2a.07.07 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.67a.78.78 0 0 0-.4-.66zm2.01-3.03l-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.42 9.23V6.9a.07.07 0 0 1 .03-.07l4.83-2.79a4.49 4.49 0 0 1 6.67 4.65zM8.32 12.86L6.3 11.7a.08.08 0 0 1-.04-.06V6.07a4.49 4.49 0 0 1 7.37-3.45l-.14.08-4.78 2.76a.78.78 0 0 0-.39.68zl.01 6.71zm1.1-2.36L12 9.01l2.6 1.5v3l-2.6 1.5-2.6-1.5z"/></svg>
                        </div>
                        <div class="sf-model-info">
                            <div class="sf-model-name" id="modelCurrentName">GPT Image 2.0</div>
                            <div class="sf-model-desc">图生图：在下方选择尺寸与质量</div>
                        </div>
                        <svg class="sf-model-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="6 9 12 15 18 9"/></svg>
                    </div>
                    <div class="sf-model-dropdown" id="modelDropdown" hidden>
                        <div class="sf-model-option active" data-model="gpt" onclick="selectModel('gpt', 'GPT Image 2.0')">
                            <div class="sf-model-icon">
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6 6 0 0 0 4.98 4.18a5.98 5.98 0 0 0-3.99 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.05 6.05 0 0 0 5.77-4.19 5.98 5.98 0 0 0 3.99-2.9 6.05 6.05 0 0 0-.74-7.09zM13.26 22.43a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.5 4.5 0 0 1-4.49 4.49zM3.61 18.3a4.47 4.47 0 0 1-.54-3.02l.14.09 4.78 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.07L9.74 22a4.5 4.5 0 0 1-6.13-1.64zM2.34 7.9a4.48 4.48 0 0 1 2.34-1.97V11.6a.78.78 0 0 0 .39.68l5.81 3.36-2.02 1.16a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.9zm16.6 3.86l-5.84-3.4L15.12 7.2a.07.07 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.67a.78.78 0 0 0-.4-.66zm2.01-3.03l-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.42 9.23V6.9a.07.07 0 0 1 .03-.07l4.83-2.79a4.49 4.49 0 0 1 6.67 4.65zM8.32 12.86L6.3 11.7a.08.08 0 0 1-.04-.06V6.07a4.49 4.49 0 0 1 7.37-3.45l-.14.08-4.78 2.76a.78.78 0 0 0-.39.68zl.01 6.71zm1.1-2.36L12 9.01l2.6 1.5v3l-2.6 1.5-2.6-1.5z"/></svg>
                            </div>
                            <div class="sf-model-info">
                                <div class="sf-model-name">GPT Image 2.0 <span class="sf-model-badge">New</span></div>
                            </div>
                            <svg class="sf-model-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
                        </div>
                        <div class="sf-model-option disabled" title="暂未开放">
                            <div class="sf-model-icon">
                                <svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.2l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.2z"/><path fill="#4CAF50" d="M24 43.5c5.4 0 10.3-2 14-5.4l-6.4-5.4c-2 1.5-4.6 2.4-7.6 2.4-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.6 39 16.2 43.5 24 43.5z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.4l6.4 5.4C41.4 36.2 43.5 30.6 43.5 24c0-1.2-.1-2.3-.4-3.5z"/></svg>
                            </div>
                            <div class="sf-model-info">
                                <div class="sf-model-name">Nano Banana 2 <span class="sf-model-badge gray">敬请期待</span></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="sf-section">
                <div class="sf-label">提示词 <span class="sf-req">*</span></div>
                <textarea class="sf-textarea" id="freeDesc" rows="5" maxlength="8000" placeholder="你想创作什么？描述风格、场景、文案排版等" oninput="updateCharCount(this,'freeDescCount',8000)"></textarea>
                <div style="text-align:right;font-size:0.78rem;color:#9ca3af;margin-top:4px"><span id="freeDescCount">0</span> / 8000</div>
                <div class="prompt-optimize-row">
                    <button type="button" class="prompt-optimize-btn" id="optimizePromptBtn">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.5 3.5L7 8l3.5 1.5L12 13l1.5-3.5L17 8l-3.5-1.5L12 3Z"/><path d="m5 14-.8 1.8L2.5 16.5l1.7.7L5 19l.8-1.8 1.7-.7-1.7-.7L5 14Z"/><path d="m18 14-1.2 2.8L14 18l2.8 1.2L18 22l1.2-2.8L22 18l-2.8-1.2L18 14Z"/></svg>
                        <span>AI 美化提示词</span>
                    </button>
                    <span class="prompt-optimize-status" id="optimizePromptStatus"></span>
                    <span class="prompt-quota" id="optimizeQuota">美化 --/30</span>
                </div>
                <div class="prompt-mention-hint">提示：上传图片后，可在提示词中输入 <strong>@</strong> 引用图片，例如 <strong>@参考图1</strong></div>
                <div class="sf-preset-row">
                    <button type="button" class="sf-preset-btn" data-preset="white" onclick="fillPreset('white')">白底图</button>
                    <button type="button" class="sf-preset-btn" data-preset="retouch" onclick="fillPreset('retouch')">精修图</button>
                    <button type="button" class="sf-preset-btn" data-preset="amazon" onclick="fillPreset('amazon')">亚马逊设计图</button>
                    <button type="button" class="sf-preset-btn" data-preset="detail" onclick="fillPreset('detail')">细节描述</button>
                </div>
            </div>
            <div class="sf-section">
                <div class="sf-label">图片 <span class="sf-sub">（可选）</span> <span class="sf-sub" id="freeImgCount">(0/4)</span></div>
                <div class="sf-upload-row">
                    <div class="sf-upload-box" id="freeProductDrop">
                        <input type="file" id="freeProductInput" accept="image/*" multiple hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span>上传</span>
                        <small>单张最大 8 MB</small>
                    </div>
                    <div class="sf-preview-list" id="freePreviewList"></div>
                </div>
                <button type="button" class="sf-lib-btn" style="margin-top:10px" onclick="openLibPicker()">📦 从白底素材库选</button>
                <button type="button" class="sf-lib-btn" style="margin-top:10px" onclick="openModelPicker()">🧍 选择模特</button>
                <button type="button" class="sf-lib-btn" style="margin-top:10px" onclick="openScenePicker()">🏞 选择场景</button>
                <div id="freeModelPreview" style="margin-top:10px"></div>
                <div id="freeScenePreview" style="margin-top:10px"></div>
            </div>
            <div class="sf-section">
                <div class="sf-label">图片文件命名 <span class="sf-sub">（可选）</span></div>
                <input class="sf-input" id="freeFileName" type="text" maxlength="80" placeholder="例如：03-dog01">
            </div>
            <div class="sf-section">
                <div class="sf-label">尺寸 <span class="sf-req">*</span></div>
${renderSizePicker('freeSizeSelect')}
                <div class="size-resize-hint" id="freeSizeHint" hidden>生成后可进入 <a href="studio.html?mode=resize&width=1464&height=600">尺寸修改</a> 修改成 1464 × 600</div>
            </div>
            <button class="sf-submit" id="freeSubmit">生成图片</button>
            <div id="freeStatus" class="studio-status" style="margin-top:10px"></div>
        </div>
        <div class="studio-preview studio-gallery-preview">
            <div class="studio-preview-tab">预览</div>
            <div class="studio-preview-body">
                <div class="studio-gallery-head">
                    <div>
                        <div class="studio-gallery-title"><span class="dot"></span> 示例画廊</div>
                        <div class="studio-gallery-sub">点击案例查看图片与提示词，可一键使用提示词</div>
                    </div>
                    <button type="button" class="studio-example-upload-btn" onclick="openExampleUploadModal()">上传案例</button>
                </div>
                <div class="studio-gallery-stage" id="studioGalleryStage"></div>
            </div>
        </div>
    </div>`

const PROGRAM_FORM = `
    <div class="studio-layout">
        <div class="studio-panel">
            <div class="sf-section">
                <div class="sf-label">产品名称 <span class="sf-req">*</span></div>
                <input class="sf-input" id="progProductName" type="text" maxlength="100" placeholder="例如：蓝牙耳机">
            </div>
            <div class="sf-section">
                <div class="sf-label">标题 <span class="sf-sub">（可选）</span></div>
                <input class="sf-input" id="progTitle" type="text" maxlength="100" placeholder="例如：高品质蓝牙耳机">
            </div>
            <div class="sf-section">
                <div class="sf-label">副标题 <span class="sf-sub">（可选）</span></div>
                <input class="sf-input" id="progSubtitle" type="text" maxlength="100" placeholder="例如：震撼音质，舒适佩戴">
            </div>
            <div class="sf-section">
                <div class="sf-label">其他文案 <span class="sf-sub">（可选，分号间隔）</span></div>
                <textarea class="sf-textarea" id="progOtherText" rows="3" maxlength="300" placeholder="例如：降噪技术；续航持久；蓝牙5.0"></textarea>
            </div>
            <div class="sf-section">
                <div class="sf-label">要模仿的图 <span class="sf-req">*</span> <span class="sf-sub">(1张)</span></div>
                <div class="sf-upload-row">
                    <div class="sf-upload-box" id="progRefDrop" tabindex="-1">
                        <input type="file" id="progRefInput" accept="image/*" hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span>上传</span>
                        <small>要模仿的图 · 最大 8 MB</small>
                    </div>
                    <div class="sf-preview-list" id="progRefThumbs"></div>
                </div>
            </div>
            <div class="sf-section">
                <div class="sf-label">白底产品图 <span class="sf-req">*</span> <span class="sf-sub">(2张)</span></div>
                <div class="sf-upload-row">
                    <div class="sf-upload-box" id="progProductDrop" tabindex="-1">
                        <input type="file" id="progProductInput" accept="image/*" multiple hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span>上传</span>
                        <small>你的白底图 · 单张最大 8 MB</small>
                    </div>
                    <div class="sf-preview-list" id="progProductThumbs"></div>
                </div>
            </div>
            <div class="sf-section">
                <div class="sf-label">尺寸 <span class="sf-req">*</span></div>
${renderSizePicker('progSizeSelect')}
                <div class="size-resize-hint" id="progSizeHint" hidden>生成后可进入 <a href="studio.html?mode=resize&width=1464&height=600">尺寸修改</a> 修改成 1464 × 600</div>
            </div>
            <button class="sf-submit" id="progSubmit">生成图片</button>
            <div id="progStatus" class="studio-status" style="margin-top:10px"></div>
        </div>
        <div class="studio-preview studio-gallery-preview">
            <div class="studio-preview-tab">预览</div>
            <div class="studio-preview-body">
                <div class="studio-gallery-head">
                    <div>
                        <div class="studio-gallery-title"><span class="dot"></span> 示例画廊</div>
                        <div class="studio-gallery-sub">点击案例查看图片与提示词，可一键使用提示词</div>
                    </div>
                    <button type="button" class="studio-example-upload-btn" onclick="openExampleUploadModal()">上传案例</button>
                </div>
                <div class="studio-gallery-stage" id="studioGalleryStage"></div>
            </div>
        </div>
    </div>`;

const RESIZE_FORM = `
    <div class="studio-layout resize-layout">
        <div class="studio-panel">
            <div class="sf-section">
                <div class="sf-label">转换规格</div>
                <select class="sf-select" id="resizePreset">
                    <option value="aplus1464">A+：1464 × 600</option>
                    <option value="wide2560">宽图：2560 × 1024 → 1464 × 600</option>
                    <option value="square2k">2K：2048 × 2048 → 1600 × 1600</option>
                </select>
            </div>
            <div class="sf-section">
                <div class="sf-label">原始图片 <span class="sf-req">*</span></div>
                <label class="sf-upload-box resize-upload-box" id="resizeDropZone" for="resizeImageInput">
                    <input id="resizeImageInput" type="file" accept="image/jpeg,image/png,image/webp" hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="26" height="26"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span id="resizeDropText">上传 1464 × 600 图片</span>
                    <small>JPG、PNG、WebP，最大 20 MB</small>
                </label>
            </div>
            <div class="resize-status" id="resizeStatus">等待上传图片</div>
            <button class="sf-submit resize-download" id="resizeDownloadBtn" disabled>下载 1464 × 600 图片</button>
        </div>
        <div class="studio-preview resize-preview">
            <div class="studio-preview-tab">预览</div>
            <div class="studio-preview-body resize-preview-body">
                <div class="resize-preview-head">
                    <div class="resize-preview-title">输出预览</div>
                    <span class="resize-size-badge" id="resizeOutputBadge">1464 × 600</span>
                </div>
                <div class="resize-canvas-wrap">
                    <div class="resize-empty" id="resizeEmptyPreview">上传图片后显示转换结果</div>
                    <canvas id="resizeCanvas"></canvas>
                </div>
            </div>
        </div>
    </div>`;

const RETOUCH_FORM = `
    <div class="studio-layout retouch-layout">
        <div class="studio-panel">
            <div class="sf-section">
                <div class="sf-label">待精修图片 <span class="sf-req">*</span></div>
                <label class="sf-upload-box retouch-upload-box" id="retouchDropZone" for="retouchImageInput">
                    <input id="retouchImageInput" type="file" accept="image/jpeg,image/png,image/webp" hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="26" height="26"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span>上传图片</span>
                    <small>JPG、PNG、WebP，最大 15 MB</small>
                </label>
                <div class="retouch-selected" id="retouchSelected">
                    <img id="retouchSelectedImage" alt="待精修图片">
                    <span class="retouch-selected-name" id="retouchSelectedName"></span>
                    <button type="button" class="retouch-selected-remove" id="retouchRemoveBtn" title="移除图片">&times;</button>
                </div>
            </div>
            <button class="sf-submit" id="retouchSubmit">开始精修</button>
            <div class="retouch-shoot-hint">需要拍摄可以在这里提交<a href="library.html?shoot=1">拍摄需求</a></div>
            <div id="retouchStatus" class="studio-status" style="margin-top:10px"></div>
        </div>
        <div class="studio-preview retouch-preview">
            <div class="studio-preview-tab">精修图片对比</div>
            <div class="studio-preview-body">
                <div class="retouch-compare">
                    <div class="retouch-compare-item">
                        <div class="retouch-compare-label">精修前</div>
                        <div class="retouch-compare-frame" id="retouchBeforeFrame"><span>上传图片后显示</span></div>
                    </div>
                    <div class="retouch-compare-item">
                        <div class="retouch-compare-label">精修后</div>
                        <div class="retouch-compare-frame" id="retouchAfterFrame"><span>示例图片待补充</span></div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

const VARIANT_FORM = `
    <div class="studio-layout variant-layout">
        <div class="studio-panel">
            <div class="sf-section">
                <div class="sf-label">改色类型 <span class="sf-req">*</span></div>
                <div class="variant-scope" id="variantScope">
                    <button type="button" class="active" data-scope="product">修改产品</button>
                    <button type="button" data-scope="background">修改背景（不改产品）</button>
                </div>
            </div>
            <div class="sf-section">
                <div class="sf-label">选择颜色 <span class="sf-req">*</span></div>
                <div class="variant-palette" id="variantPalette">
                    <button type="button" class="variant-swatch active" data-color-name="暖白色" data-color="#f8f5ef" style="background:#f8f5ef"></button>
                    <button type="button" class="variant-swatch" data-color-name="奶油黄" data-color="#f4d35e" style="background:#f4d35e"></button>
                    <button type="button" class="variant-swatch" data-color-name="雾霾蓝" data-color="#7aa7c7" style="background:#7aa7c7"></button>
                    <button type="button" class="variant-swatch" data-color-name="鼠尾草绿" data-color="#8aa399" style="background:#8aa399"></button>
                    <button type="button" class="variant-swatch" data-color-name="玫瑰粉" data-color="#e7a4b1" style="background:#e7a4b1"></button>
                    <button type="button" class="variant-swatch" data-color-name="哑光黑" data-color="#1f2933" style="background:#1f2933"></button>
                </div>
                <div class="variant-color-picker" id="variantColorPicker">
                    <div class="variant-color-area" id="variantColorArea">
                        <span class="variant-color-cursor" id="variantColorCursor"></span>
                    </div>
                    <div class="variant-hue-bar" id="variantHueBar">
                        <span class="variant-hue-cursor" id="variantHueCursor"></span>
                    </div>
                </div>
                <div class="variant-custom-row">
                    <div class="variant-color-chip" id="variantColorChip"></div>
                    <input class="sf-input" id="variantColorName" type="text" maxlength="30" value="暖白色" placeholder="颜色名称，例如：香槟金">
                    <input class="sf-input variant-hex-input" id="variantCustomColor" type="text" maxlength="7" value="#f8f5ef" aria-label="自定义颜色 HEX">
                </div>
            </div>
            <div class="sf-section">
                <div class="sf-label">图片 <span class="sf-req">*</span> <span class="sf-sub" id="variantImgCount">(0/5)</span></div>
                <div class="sf-upload-row">
                    <div class="sf-upload-box variant-upload-box" id="variantDrop">
                        <input type="file" id="variantInput" accept="image/*" multiple hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span>上传图片</span>
                        <small>默认最多 5 张，单张最大 15 MB</small>
                    </div>
                    <div class="sf-preview-list" id="variantPreviewList"></div>
                </div>
            </div>
            <div class="sf-section">
                <div class="sf-label">固定输出</div>
                <div class="size-resize-hint" style="display:block">使用 GPT Image 2，默认 2K 输出。提交后无需停留在页面，完成后会通过钉钉通知。</div>
            </div>
            <button class="sf-submit" id="variantSubmit">开始改色</button>
            <div id="variantStatus" class="studio-status" style="margin-top:10px"></div>
        </div>
        <div class="studio-preview variant-preview">
            <div class="studio-preview-tab">改色结果</div>
            <div class="studio-preview-body">
                <div class="variant-results" id="variantResults">
                    <div class="resize-empty">提交后进入后台处理，完成后可在「我的任务」查看下载</div>
                </div>
            </div>
        </div>
    </div>`;

const uploads = { freeImages: [], freeModel: null, freeScene: null, freeProduct: [], freeProduct1: null, freeProduct2: null, progRef: [], progProduct: [], retouchImage: null, variantImages: [] };
const MAX_STUDIO_FILE_SIZE = 8 * 1024 * 1024;
const MAX_RETOUCH_FILE_SIZE = 15 * 1024 * 1024;
const MAX_VARIANT_FILE_SIZE = 15 * 1024 * 1024;

function validateStudioImage(file) {
    if (!file?.type?.startsWith('image/')) return '请选择图片文件';
    const isLargeImageMode = currentMode === 'retouch' || currentMode === 'variant';
    const maxSize = currentMode === 'variant' ? MAX_VARIANT_FILE_SIZE : currentMode === 'retouch' ? MAX_RETOUCH_FILE_SIZE : MAX_STUDIO_FILE_SIZE;
    const maxSizeLabel = isLargeImageMode ? '15MB' : '8MB';
    if (file.size > maxSize) return '图片单张不能超过 ' + maxSizeLabel + '：' + file.name;
    return '';
}

function showStudioUploadError(message) {
    const statusId = currentMode === 'program' ? 'progStatus' : currentMode === 'retouch' ? 'retouchStatus' : currentMode === 'variant' ? 'variantStatus' : 'freeStatus';
    const status = document.getElementById(statusId);
    if (status) {
        status.textContent = message;
        status.className = 'studio-status err';
        status.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
        alert(message);
    }
}

function showStudioFieldError(status, message, target) {
    status.textContent = message;
    status.className = 'studio-status err';
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof target.focus === 'function') target.focus({ preventScroll: true });
    }
}

const PRESET_PROMPTS = {
    white: '将背景替换为纯白色背景，保持主体对象完全不变',
    retouch: '把参考图按照要求修改图片。要求1600x1600像素，纯白背景，中心对焦，高分辨率 Octane渲染器渲染，柔和的影棚布光，极高清晰度，逼真的材质细节，8k分辨率，电商白底图风格',
    amazon: '以上传的产品图片为参考。创作亚马逊设计图片，以适应亚马逊设计。逼真，高清晰度，高对比度，专业照明，具有真实的阴影和高光效果,根据图片来给我写标题和文案、无模糊、无失真、无低质量、无卡通风格',
    detail: '58mm定焦镜头，1.4F大光圈，索尼A7M4拍摄'
};

let activePreset = null;

function toggleModelDropdown() {
    const dd = document.getElementById('modelDropdown');
    if (dd) dd.hidden = !dd.hidden;
}

function selectModel(key, name) {
    const nameEl = document.getElementById('modelCurrentName');
    if (nameEl) nameEl.textContent = name;
    document.querySelectorAll('.sf-model-option').forEach(o => o.classList.toggle('active', o.dataset.model === key));
    const dd = document.getElementById('modelDropdown');
    if (dd) dd.hidden = true;
}

document.addEventListener('click', e => {
    const sel = document.getElementById('modelSelect');
    const dd = document.getElementById('modelDropdown');
    if (sel && dd && !dd.hidden && !sel.contains(e.target)) dd.hidden = true;
});

function fillPreset(key) {
    const el = document.getElementById('freeDesc');
    if (!el) return;
    const text = PRESET_PROMPTS[key];
    if (!text) return;

    let val = el.value;
    if (activePreset && PRESET_PROMPTS[activePreset]) {
        const prev = PRESET_PROMPTS[activePreset];
        val = val.replace(prev, '').replace(/\n{2,}/g, '\n').trim();
    }

    if (activePreset === key) {
        activePreset = null;
        el.value = val;
        document.querySelectorAll('.sf-preset-btn').forEach(b => b.classList.remove('active', 'dim'));
    } else {
        activePreset = key;
        el.value = val.trim() ? (val.trim() + '\n' + text) : text;
        document.querySelectorAll('.sf-preset-btn').forEach(b => {
            if (b.dataset.preset === key) { b.classList.add('active'); b.classList.remove('dim'); }
            else { b.classList.add('dim'); b.classList.remove('active'); }
        });
    }
    updateCharCount(el, 'freeDescCount', 8000);
    el.focus();
}

let cachedStudioGalleryPreview = null;

function renderForm() {
    const area = document.getElementById('studioFormArea');
    const attachedGallery = area.querySelector('.studio-gallery-preview');
    if (attachedGallery) cachedStudioGalleryPreview = attachedGallery;
    uploads.freeImages = []; uploads.freeModel = null; uploads.freeScene = null; uploads.freeProduct = []; uploads.freeProduct1 = null; uploads.freeProduct2 = null; uploads.progRef = []; uploads.progProduct = []; uploads.retouchImage = null; uploads.variantImages = [];
    let galleryWasReady = false;
    if (currentMode === 'free') {
        galleryWasReady = renderGenerationMode(area, FREE_FORM);
        wireFreeUpload('freeProductDrop', 'freeProductInput');
        wirePromptMentions();
        wirePromptOptimizer();
        loadPromptQuota();
        initSizePicker('freeSizeSelect', 'freeSizeHint');
        document.getElementById('freeSubmit').addEventListener('click', submitFree);
    } else if (currentMode === 'program') {
        galleryWasReady = renderGenerationMode(area, PROGRAM_FORM);
        wireDrop('progRefDrop', 'progRefInput', 'progRefThumbs', 'progRef');
        wireDrop('progProductDrop', 'progProductInput', 'progProductThumbs', 'progProduct');
        initSizePicker('progSizeSelect', 'progSizeHint');
        document.getElementById('progSubmit').addEventListener('click', submitProgram);
    } else if (currentMode === 'retouch') {
        if (attachedGallery) attachedGallery.remove();
        area.innerHTML = RETOUCH_FORM;
        initRetouchMode();
    } else if (currentMode === 'variant') {
        if (attachedGallery) attachedGallery.remove();
        area.innerHTML = VARIANT_FORM;
        initVariantMode();
    } else {
        if (attachedGallery) attachedGallery.remove();
        area.innerHTML = RESIZE_FORM;
        initResizeTool();
    }
    if (currentMode !== 'resize' && currentMode !== 'retouch' && currentMode !== 'variant' && !galleryWasReady) renderStudioGallery();
    applyAgreementGate();
}

function renderGenerationMode(area, formHtml) {
    const currentLayout = area.querySelector('.studio-layout');
    const attachedGallery = currentLayout?.querySelector('.studio-gallery-preview');
    const template = document.createElement('template');
    template.innerHTML = formHtml.trim();
    const nextLayout = template.content.firstElementChild;

    if (attachedGallery && currentLayout) {
        const currentPanel = currentLayout.querySelector('.studio-panel');
        const nextPanel = nextLayout.querySelector('.studio-panel');
        if (currentPanel && nextPanel) currentPanel.replaceWith(nextPanel);
        return true;
    }

    const hadCachedGallery = Boolean(cachedStudioGalleryPreview);
    area.replaceChildren(nextLayout);
    const replacement = area.querySelector('.studio-gallery-preview');
    if (cachedStudioGalleryPreview && replacement) {
        replacement.replaceWith(cachedStudioGalleryPreview);
    } else {
        cachedStudioGalleryPreview = replacement;
    }
    return hadCachedGallery;
}

function initRetouchMode() {
    const input = document.getElementById('retouchImageInput');
    const dropZone = document.getElementById('retouchDropZone');
    const removeButton = document.getElementById('retouchRemoveBtn');

    const selectFile = file => {
        const validationError = validateStudioImage(file);
        if (validationError) { showStudioUploadError(validationError); return; }
        const reader = new FileReader();
        reader.onload = event => {
            uploads.retouchImage = {
                name: file.name,
                base64: event.target.result.split(',')[1],
                mimeType: file.type,
                dataUrl: event.target.result
            };
            renderRetouchSelection();
        };
        reader.readAsDataURL(file);
    };

    input.addEventListener('change', () => {
        if (input.files[0]) selectFile(input.files[0]);
        input.value = '';
    });
    ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => {
        event.preventDefault();
        dropZone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => {
        event.preventDefault();
        dropZone.classList.remove('dragover');
    }));
    dropZone.addEventListener('drop', event => {
        if (event.dataTransfer.files[0]) selectFile(event.dataTransfer.files[0]);
    });
    removeButton.addEventListener('click', clearRetouchSelection);
    document.getElementById('retouchSubmit').addEventListener('click', submitRetouch);
}

function renderRetouchSelection() {
    const selected = document.getElementById('retouchSelected');
    const image = document.getElementById('retouchSelectedImage');
    const name = document.getElementById('retouchSelectedName');
    const beforeFrame = document.getElementById('retouchBeforeFrame');
    const picked = uploads.retouchImage;
    if (!selected || !image || !name || !beforeFrame) return;

    selected.classList.toggle('visible', Boolean(picked));
    if (!picked) {
        image.removeAttribute('src');
        name.textContent = '';
        beforeFrame.innerHTML = '<span>上传图片后显示</span>';
        return;
    }
    image.src = picked.dataUrl;
    name.textContent = picked.name || '上次图片';
    beforeFrame.innerHTML = '<img src="' + picked.dataUrl + '" alt="精修前">';
}

function clearRetouchSelection() {
    uploads.retouchImage = null;
    renderRetouchSelection();
}

function initVariantMode() {
    const input = document.getElementById('variantInput');
    const drop = document.getElementById('variantDrop');
    const scope = document.getElementById('variantScope');
    const palette = document.getElementById('variantPalette');
    const colorName = document.getElementById('variantColorName');
    const colorPicker = initVariantColorPicker();

    const addFiles = files => {
        const remaining = 5 - uploads.variantImages.length;
        if (remaining <= 0) {
            showStudioUploadError('变体改色最多上传 5 张图片');
            return;
        }
        Array.from(files).slice(0, remaining).forEach(file => {
            const validationError = validateStudioImage(file);
            if (validationError) { showStudioUploadError(validationError); return; }
            const reader = new FileReader();
            reader.onload = event => {
                uploads.variantImages.push({
                    name: file.name,
                    base64: event.target.result.split(',')[1],
                    mimeType: file.type,
                    dataUrl: event.target.result
                });
                renderVariantPreview();
            };
            reader.readAsDataURL(file);
        });
        if (files.length > remaining) showStudioUploadError('最多上传 5 张，已自动限制');
    };

    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
        e.preventDefault();
        drop.classList.remove('dragover');
        addFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', e => {
        addFiles(e.target.files);
        e.target.value = '';
    });
    scope.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            scope.querySelectorAll('button').forEach(item => item.classList.remove('active'));
            btn.classList.add('active');
        });
    });
    palette.querySelectorAll('.variant-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            palette.querySelectorAll('.variant-swatch').forEach(item => item.classList.remove('active'));
            btn.classList.add('active');
            colorPicker.setHex(btn.dataset.color || '#ffffff');
            colorName.value = btn.dataset.colorName || btn.dataset.color || '';
        });
    });
    document.getElementById('variantSubmit').addEventListener('click', submitVariant);
    renderVariantPreview();
}

function initVariantColorPicker() {
    const area = document.getElementById('variantColorArea');
    const hueBar = document.getElementById('variantHueBar');
    const colorCursor = document.getElementById('variantColorCursor');
    const hueCursor = document.getElementById('variantHueCursor');
    const hexInput = document.getElementById('variantCustomColor');
    const chip = document.getElementById('variantColorChip');
    const palette = document.getElementById('variantPalette');
    const colorName = document.getElementById('variantColorName');
    let hsv = hexToHsv(hexInput?.value || '#f8f5ef');

    const apply = (syncName = false) => {
        const base = hsvToHex(hsv.h, 100, 100);
        const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
        if (area) area.style.background = `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent),${base}`;
        if (colorCursor) {
            colorCursor.style.left = hsv.s + '%';
            colorCursor.style.top = (100 - hsv.v) + '%';
        }
        if (hueCursor) hueCursor.style.top = (hsv.h / 360 * 100) + '%';
        if (hexInput) hexInput.value = hex;
        if (chip) chip.style.background = hex;
        if (syncName && colorName) colorName.value = hex;
    };

    const setFromArea = event => {
        const rect = area.getBoundingClientRect();
        hsv.s = clamp((event.clientX - rect.left) / rect.width * 100, 0, 100);
        hsv.v = clamp(100 - (event.clientY - rect.top) / rect.height * 100, 0, 100);
        palette?.querySelectorAll('.variant-swatch').forEach(item => item.classList.remove('active'));
        apply(true);
    };
    const setFromHue = event => {
        const rect = hueBar.getBoundingClientRect();
        hsv.h = clamp((event.clientY - rect.top) / rect.height * 360, 0, 360);
        palette?.querySelectorAll('.variant-swatch').forEach(item => item.classList.remove('active'));
        apply(true);
    };
    const drag = (event, handler) => {
        event.preventDefault();
        handler(event);
        const move = e => handler(e);
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    area?.addEventListener('pointerdown', event => drag(event, setFromArea));
    hueBar?.addEventListener('pointerdown', event => drag(event, setFromHue));
    hexInput?.addEventListener('input', () => {
        const normalized = normalizeHex(hexInput.value);
        if (!normalized) return;
        hsv = hexToHsv(normalized);
        palette?.querySelectorAll('.variant-swatch').forEach(item => item.classList.remove('active'));
        apply(true);
    });

    apply(false);
    return {
        setHex(hex) {
            const normalized = normalizeHex(hex) || '#ffffff';
            hsv = hexToHsv(normalized);
            apply(false);
        }
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeHex(value) {
    const raw = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
    if (/^[0-9a-f]{6}$/i.test(raw)) return ('#' + raw).toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
        return '#' + raw.slice(1).split('').map(ch => ch + ch).join('').toLowerCase();
    }
    return '';
}

function hexToHsv(hex) {
    const normalized = normalizeHex(hex) || '#ffffff';
    const r = parseInt(normalized.slice(1, 3), 16) / 255;
    const g = parseInt(normalized.slice(3, 5), 16) / 255;
    const b = parseInt(normalized.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max * 100, v: max * 100 };
}

function hsvToHex(h, s, v) {
    const sat = clamp(s, 0, 100) / 100;
    const val = clamp(v, 0, 100) / 100;
    const c = val * sat;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = val - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const toHex = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
}

function renderVariantPreview() {
    const list = document.getElementById('variantPreviewList');
    const count = document.getElementById('variantImgCount');
    const drop = document.getElementById('variantDrop');
    if (!list) return;
    const n = uploads.variantImages.length;
    if (count) count.textContent = '(' + n + '/5)';
    if (drop) drop.style.display = n >= 5 ? 'none' : '';
    list.innerHTML = '';
    uploads.variantImages.forEach((f, i) => {
        const item = document.createElement('div');
        item.className = 'sf-preview-item';
        item.innerHTML = '<img src="' + f.dataUrl + '" style="width:100%;height:100%;object-fit:cover;display:block">'
            + '<button type="button" data-index="' + i + '">\u00d7</button>';
        item.querySelector('button').addEventListener('click', () => {
            uploads.variantImages.splice(i, 1);
            renderVariantPreview();
        });
        list.appendChild(item);
    });
}

function initResizeTool() {
    const presets = {
        aplus1464: { sourceWidth: 1464, sourceHeight: 600, width: 1464, height: 600 },
        wide2560: { sourceWidth: 2560, sourceHeight: 1024, width: 1464, height: 600 },
        square2k: { sourceWidth: 2048, sourceHeight: 2048, width: 1600, height: 1600 }
    };
    const input = document.getElementById('resizeImageInput');
    const presetSelect = document.getElementById('resizePreset');
    const dropZone = document.getElementById('resizeDropZone');
    const dropText = document.getElementById('resizeDropText');
    const status = document.getElementById('resizeStatus');
    const downloadBtn = document.getElementById('resizeDownloadBtn');
    const outputBadge = document.getElementById('resizeOutputBadge');
    const emptyPreview = document.getElementById('resizeEmptyPreview');
    const canvas = document.getElementById('resizeCanvas');
    const context = canvas.getContext('2d');
    let sourceName = 'aplus-image';
    let outputType = 'image/png';

    const getPreset = () => presets[presetSelect.value] || presets.aplus1464;
    const reset = (message = '等待上传图片') => {
        downloadBtn.disabled = true;
        canvas.style.display = 'none';
        emptyPreview.hidden = false;
        status.className = 'resize-status';
        status.textContent = message;
    };
    const showError = message => {
        reset(message);
        status.className = 'resize-status error';
    };
    const updatePreset = () => {
        const preset = getPreset();
        dropText.textContent = `上传 ${preset.sourceWidth} × ${preset.sourceHeight} 图片`;
        downloadBtn.textContent = `下载 ${preset.width} × ${preset.height} 图片`;
        if (outputBadge) outputBadge.textContent = `${preset.width} × ${preset.height}`;
        reset();
    };
    const loadFile = file => {
        reset('正在读取图片...');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            showError('请选择 JPG、PNG 或 WebP 图片。');
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            showError('图片不能超过 20 MB。');
            return;
        }
        const imageUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(imageUrl);
            const preset = getPreset();
            if (image.naturalWidth !== preset.sourceWidth || image.naturalHeight !== preset.sourceHeight) {
                showError(`当前图片是 ${image.naturalWidth} × ${image.naturalHeight}，请上传 ${preset.sourceWidth} × ${preset.sourceHeight} 图片。`);
                return;
            }
            sourceName = file.name.replace(/\.[^.]+$/, '') || 'aplus-image';
            outputType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
            canvas.width = preset.width;
            canvas.height = preset.height;
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, preset.width, preset.height);
            const scaledWidth = image.naturalWidth * (preset.height / image.naturalHeight);
            context.drawImage(image, (preset.width - scaledWidth) / 2, 0, scaledWidth, preset.height);
            canvas.style.display = 'block';
            emptyPreview.hidden = true;
            downloadBtn.disabled = false;
            status.className = 'resize-status ready';
            status.textContent = `转换完成：${preset.sourceWidth} × ${preset.sourceHeight} → ${preset.width} × ${preset.height}`;
        };
        image.onerror = () => {
            URL.revokeObjectURL(imageUrl);
            showError('图片读取失败，请重新选择。');
        };
        image.src = imageUrl;
    };

    presetSelect.addEventListener('change', updatePreset);
    input.addEventListener('change', () => {
        if (input.files[0]) loadFile(input.files[0]);
        input.value = '';
    });
    ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => {
        event.preventDefault();
        dropZone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => {
        event.preventDefault();
        dropZone.classList.remove('dragging');
    }));
    dropZone.addEventListener('drop', event => {
        const file = event.dataTransfer.files[0];
        if (file) loadFile(file);
    });
    downloadBtn.addEventListener('click', () => {
        canvas.toBlob(blob => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const preset = getPreset();
            link.download = `${sourceName}-${preset.width}x${preset.height}.${outputType === 'image/jpeg' ? 'jpg' : 'png'}`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, outputType, 0.95);
    });
    updatePreset();
}

function initSizePicker(inputId, hintId) {
    const input = document.getElementById(inputId);
    const picker = document.getElementById(inputId + 'Picker');
    if (!input || !picker) return;

    const buttons = Array.from(picker.querySelectorAll('[data-size-value], [data-size-custom]'));
    const customRow = picker.querySelector('.size-custom-row');
    const widthInput = picker.querySelector('[data-size-width]');
    const heightInput = picker.querySelector('[data-size-height]');

    const emitChange = () => input.dispatchEvent(new Event('change', { bubbles: true }));
    const setActive = (button) => {
        buttons.forEach(item => item.classList.toggle('active', item === button));
    };
    const updateCustomValue = () => {
        const w = String(widthInput?.value || '').trim();
        const h = String(heightInput?.value || '').trim();
        input.value = w && h ? `自定义尺寸 ${w}x${h}` : '';
        emitChange();
    };

    buttons.forEach(button => {
        button.addEventListener('click', () => {
            setActive(button);
            const isCustom = button.dataset.sizeCustom === '1';
            if (customRow) customRow.hidden = !isCustom;
            if (isCustom) {
                updateCustomValue();
                setTimeout(() => widthInput?.focus(), 0);
            } else {
                input.value = button.dataset.sizeValue || '';
                emitChange();
            }
        });
    });
    [widthInput, heightInput].forEach(el => el?.addEventListener('input', updateCustomValue));
    wireSizeResizeHint(inputId, hintId);
}

function wireSizeResizeHint(selectId, hintId) {
    const select = document.getElementById(selectId);
    const hint = document.getElementById(hintId);
    if (!select || !hint) return;
    const update = (showModal = false) => {
        const show = false;
        hint.hidden = !show;
        hint.style.display = show ? 'block' : 'none';
        if (show && showModal) showResizeReminderModal();
    };
    select.addEventListener('change', () => update(true));
    update();
}

function showResizeReminderModal() {
    if (document.getElementById('resizeReminderModal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'resizeReminderModal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '尺寸修改提示');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `<div style="width:min(420px,100%);background:#fff;border-radius:14px;padding:28px;box-shadow:0 16px 48px rgba(0,0,0,.2)">
        <div style="width:48px;height:48px;border-radius:50%;background:#eef2ff;color:#4338ca;display:flex;align-items:center;justify-content:center;margin-bottom:16px">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 3v4M16 3v4M8 17h8"/></svg>
        </div>
        <div style="font-size:1.08rem;font-weight:700;color:#111827">A+ 尺寸已改为 1464 × 600</div>
        <div style="margin-top:10px;color:#6b7280;font-size:.88rem;line-height:1.7">当前 A+ 生成尺寸已经是 1464 × 600，不需要再额外转换。</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:22px">
            <button type="button" id="resizeReminderClose" style="padding:11px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;font-weight:600;cursor:pointer">继续制作</button>
            <a href="studio.html?mode=resize&width=1464&height=600" style="display:flex;align-items:center;justify-content:center;padding:11px;border-radius:8px;background:#111827;color:#fff;text-decoration:none;font-weight:600">进入尺寸修改</a>
        </div>
    </div>`;
    const close = () => overlay.remove();
    overlay.querySelector('#resizeReminderClose').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.body.appendChild(overlay);
}

const promptQuotaRemaining = { optimize: null };

function wirePromptOptimizer() {
    const optimizeButton = document.getElementById('optimizePromptBtn');
    const textarea = document.getElementById('freeDesc');
    const status = document.getElementById('optimizePromptStatus');
    if (!optimizeButton || !textarea || !status) return;

    const run = async () => {
        const prompt = textarea.value.trim();
        if (!prompt) {
            status.textContent = '请先输入提示词';
            status.className = 'prompt-optimize-status error';
            textarea.focus();
            return;
        }

        const originalLabel = optimizeButton.querySelector('span').textContent;
        optimizeButton.disabled = true;
        optimizeButton.classList.add('loading');
        optimizeButton.querySelector('span').textContent = '正在美化...';
        status.textContent = '';
        status.className = 'prompt-optimize-status';
        try {
            const response = await fetch('/api/optimize-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    size: document.getElementById('freeSizeSelect')?.value || '',
                    userId: currentUser?.unionId || '',
                    action: 'optimize'
                })
            });
            const data = await response.json().catch(() => ({}));
            updatePromptQuota(data.remaining);
            if (!response.ok || !data.ok || !data.optimized) {
                throw new Error(data.error || 'AI 美化失败，请稍后重试');
            }
            textarea.value = data.optimized;
            updateCharCount(textarea, 'freeDescCount', 8000);
            textarea.focus();
            status.textContent = '已完成，可继续修改';
            status.className = 'prompt-optimize-status success';
        } catch (error) {
            status.textContent = error.message || 'AI 美化失败，请稍后重试';
            status.className = 'prompt-optimize-status error';
        } finally {
            optimizeButton.disabled = promptQuotaRemaining.optimize === 0;
            optimizeButton.classList.remove('loading');
            optimizeButton.querySelector('span').textContent = originalLabel;
        }
    };

    optimizeButton.addEventListener('click', run);
}

async function loadPromptQuota() {
    if (!currentUser?.unionId) {
        updatePromptQuota(null);
        return;
    }
    try {
        const response = await fetch('/api/optimize-prompt?userId=' + encodeURIComponent(currentUser.unionId));
        const data = await response.json();
        if (response.ok && data.ok) {
            updatePromptQuota(data.quotas?.optimize?.remaining);
        }
    } catch {}
}

function updatePromptQuota(remaining) {
    const limit = 30;
    const quota = document.getElementById('optimizeQuota');
    if (!quota) return;
    const hasRemaining = remaining !== null && remaining !== undefined && remaining !== '' && Number.isFinite(Number(remaining));
    promptQuotaRemaining.optimize = hasRemaining ? Number(remaining) : null;
    quota.textContent = hasRemaining
        ? `美化 ${remaining}/${limit}`
        : `美化 --/${limit}`;
    const button = document.getElementById('optimizePromptBtn');
    if (hasRemaining && Number(remaining) <= 0) {
        button.disabled = true;
        button.title = '今日美化次数已用完，请明天再试';
    }
}


let studioExamplesCache = null;
let studioGalleryShown = 0;
const STUDIO_GALLERY_PAGE = 13;
let studioGalleryObserver = null;
let studioGalleryLoading = false;

async function renderStudioGallery() {
    const stage = document.getElementById('studioGalleryStage');
    if (!stage) return;
    try {
        if (!studioExamplesCache) {
            stage.innerHTML = '<div class="studio-examples-loading">案例加载中...</div>';
            const res = await fetch('/api/studio-examples');
            const json = await res.json();
            studioExamplesCache = shuffleExamples(json.examples || []);
        }
        if (!studioExamplesCache || !studioExamplesCache.length) {
            stage.innerHTML = '<div class="studio-examples-loading">暂无案例</div>';
            return;
        }
        stage.innerHTML = '';
        studioGalleryShown = 0;
        appendStudioGalleryPage();
    } catch (err) {
        stage.innerHTML = '<div class="studio-examples-loading">案例加载失败：' + err.message + '</div>';
    }
}

function appendStudioGalleryPage() {
    const stage = document.getElementById('studioGalleryStage');
    if (!stage || studioGalleryLoading) return;
    if (studioGalleryShown >= studioExamplesCache.length) return;
    studioGalleryLoading = true;
    let loading = document.getElementById('studioGalleryLoadingMore');
    if (!loading) {
        loading = document.createElement('div');
        loading.id = 'studioGalleryLoadingMore';
        loading.className = 'studio-gallery-loading-more';
        loading.textContent = '加载中...';
        stage.appendChild(loading);
    }
    loading.style.display = 'inline-flex';

    setTimeout(() => {
        const currentLoading = document.getElementById('studioGalleryLoadingMore');
        if (currentLoading) currentLoading.remove();
        const next = studioExamplesCache.slice(studioGalleryShown, studioGalleryShown + STUDIO_GALLERY_PAGE);
        next.forEach((item, idx) => {
            const i = studioGalleryShown + idx;
            const safeTitle = (item.title || ('案例 ' + (i + 1))).replace(/"/g, '&quot;');
            const btn = document.createElement('button');
            btn.className = 'studio-example-card sf-fade-in';
            btn.onclick = () => openStudioExample(i);
            btn.innerHTML = '<img src="' + item.image + '" alt="' + safeTitle + '" loading="lazy">'
                + '<div class="studio-example-mask"><span>' + safeTitle + '</span></div>';
            stage.appendChild(btn);
        });
        studioGalleryShown += next.length;
        studioGalleryLoading = false;
        setupGallerySentinel();
    }, studioGalleryShown === 0 ? 0 : 450);
}

function setupGallerySentinel() {
    if (studioGalleryObserver) { studioGalleryObserver.disconnect(); studioGalleryObserver = null; }
    const stage = document.getElementById('studioGalleryStage');
    if (!stage) return;
    let sentinel = document.getElementById('studioGallerySentinel');
    if (sentinel) sentinel.remove();
    sentinel = document.createElement('div');
    sentinel.id = 'studioGallerySentinel';
    sentinel.style.cssText = 'width:100%;height:1px';
    stage.parentNode.appendChild(sentinel);
    studioGalleryObserver = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && studioGalleryShown < studioExamplesCache.length) {
            appendStudioGalleryPage();
        }
    }, { rootMargin: '200px' });
    studioGalleryObserver.observe(sentinel);
}

let exampleUploadImage = null;

function openExampleUploadModal() {
    exampleUploadImage = null;
    const overlay = document.createElement('div');
    overlay.className = 'studio-example-modal';
    overlay.innerHTML = '<div class="studio-upload-dialog">'
        + '<button class="studio-example-close" type="button">×</button>'
        + '<div class="studio-example-detail-title">上传案例</div>'
        + '<div id="examplePasteZone" class="studio-example-paste" tabindex="0">粘贴图片到这里，或点击选择图片<input id="exampleUploadInput" type="file" accept="image/*" hidden></div>'
        + '<div id="exampleUploadPreview" class="studio-example-upload-preview"></div>'
        + '<textarea id="exampleUploadPrompt" class="studio-example-prompt" placeholder="粘贴或输入描述/提示词，标题会默认取前面内容"></textarea>'
        + '<div id="exampleUploadStatus" style="font-size:.82rem;color:#6b7280;margin-top:8px"></div>'
        + '<button id="exampleUploadSubmit" class="studio-example-use" type="button">保存案例</button>'
        + '</div>';
    overlay.querySelector('.studio-example-close').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    const zone = overlay.querySelector('#examplePasteZone');
    const input = overlay.querySelector('#exampleUploadInput');
    zone.onclick = () => input.click();
    zone.focus();
    zone.addEventListener('paste', e => {
        const item = Array.from(e.clipboardData.items).find(x => x.type.startsWith('image/'));
        if (item) { e.preventDefault(); setExampleUploadImage(item.getAsFile()); }
    });
    input.addEventListener('change', e => { if (e.target.files[0]) setExampleUploadImage(e.target.files[0]); });
    overlay.querySelector('#exampleUploadSubmit').onclick = async () => {
        const prompt = overlay.querySelector('#exampleUploadPrompt').value.trim();
        const status = overlay.querySelector('#exampleUploadStatus');
        if (!exampleUploadImage) { status.textContent = '请先粘贴或选择图片'; status.style.color = '#ef4444'; return; }
        if (!prompt) { status.textContent = '请填写描述'; status.style.color = '#ef4444'; return; }
        status.textContent = '保存中...'; status.style.color = '#6b7280';
        try {
            const res = await fetch('/api/studio-examples', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, file: exampleUploadImage })
            });
            const json = await res.json();
            if (!res.ok || !json.ok) throw new Error(json.error || res.status);
            studioExamplesCache = null;
            status.textContent = '已提交，待管理员审核通过后会显示在画廊';
            status.style.color = '#10b981';
            setTimeout(() => overlay.remove(), 1500);
        } catch (err) {
            status.textContent = '保存失败：' + err.message;
            status.style.color = '#ef4444';
        }
    };
}

function setExampleUploadImage(file) {
    const reader = new FileReader();
    reader.onload = ev => {
        exampleUploadImage = { name: file.name || 'pasted-image.png', mimeType: file.type || 'image/png', base64: ev.target.result.split(',')[1], dataUrl: ev.target.result };
        const preview = document.getElementById('exampleUploadPreview');
        if (preview) preview.innerHTML = '<img src="' + ev.target.result + '">';
    };
    reader.readAsDataURL(file);
}

function shuffleExamples(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function openStudioExample(index) {
    const item = studioExamplesCache && studioExamplesCache[index];
    if (!item) return;
    const overlay = document.createElement('div');
    overlay.className = 'studio-example-modal';
    const prompt = item.prompt || '';
    overlay.innerHTML = '<div class="studio-example-dialog">'
        + '<button class="studio-example-close" type="button">×</button>'
        + '<div class="studio-example-detail-img"><img src="' + item.image + '" alt=""></div>'
        + '<div class="studio-example-detail-info">'
        + '<div class="studio-example-detail-title">' + (item.title || '案例') + '</div>'
        + '<textarea class="studio-example-prompt" readonly>' + prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>'
        + '<button class="studio-example-use" type="button">使用这个提示词</button>'
        + '</div></div>';
    overlay.querySelector('.studio-example-close').onclick = () => overlay.remove();
    overlay.querySelector('.studio-example-use').onclick = () => {
        const input = document.getElementById('freeDesc');
        if (input) {
            input.value = prompt;
            updateCharCount(input, 'freeDescCount', 8000);
            input.focus();
        }
        overlay.remove();
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}


function wireDrop(dropId, inputId, thumbsId, bucket) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
        e.preventDefault(); drop.classList.remove('dragover');
        handleFiles(e.dataTransfer.files, thumbsId, bucket);
    });
    input.addEventListener('change', e => { handleFiles(e.target.files, thumbsId, bucket); e.target.value = ''; });
}

function wireSingleDrop(dropId, inputId, thumbId, hintId, slot) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
        e.preventDefault(); drop.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleSingleFile(e.dataTransfer.files[0], thumbId, hintId, slot);
    });
    input.addEventListener('change', e => {
        if (e.target.files[0]) handleSingleFile(e.target.files[0], thumbId, hintId, slot);
        e.target.value = '';
    });
}

function handleSingleFile(file, thumbId, hintId, slot) {
    const validationError = validateStudioImage(file);
    if (validationError) { showStudioUploadError(validationError); return; }
    const reader = new FileReader();
    reader.onload = ev => {
        const base64 = ev.target.result.split(',')[1];
        uploads[slot] = { name: file.name, base64, mimeType: file.type, dataUrl: ev.target.result };
        const thumb = document.getElementById(thumbId);
        const hint = document.getElementById(hintId);
        thumb.innerHTML = '<div style="position:relative;display:inline-block"><img src="' + ev.target.result + '" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb"><button onclick="clearSlot(\'' + slot + '\',\'' + thumbId + '\',\'' + hintId + '\')" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;border:none;cursor:pointer;font-size:11px;line-height:18px;text-align:center;padding:0">\u00d7</button></div>';
        if (hint) hint.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function clearSlot(slot, thumbId, hintId) {
    uploads[slot] = null;
    const thumb = document.getElementById(thumbId);
    const hint = document.getElementById(hintId);
    if (thumb) thumb.innerHTML = '';
    if (hint) hint.style.display = '';
}


function wireSingleDrop(dropId, inputId, thumbId, hintId, slot) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
        e.preventDefault(); drop.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleSingleFile(e.dataTransfer.files[0], thumbId, hintId, slot);
    });
    input.addEventListener('change', e => {
        if (e.target.files[0]) handleSingleFile(e.target.files[0], thumbId, hintId, slot);
        e.target.value = '';
    });
}

function handleSingleFile(file, thumbId, hintId, slot) {
    const validationError = validateStudioImage(file);
    if (validationError) { showStudioUploadError(validationError); return; }
    const reader = new FileReader();
    reader.onload = ev => {
        const base64 = ev.target.result.split(',')[1];
        uploads[slot] = { name: file.name, base64, mimeType: file.type, dataUrl: ev.target.result };
        const thumb = document.getElementById(thumbId);
        const hint = document.getElementById(hintId);
        thumb.innerHTML = '<div style="position:relative;display:inline-block"><img src="' + ev.target.result + '" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb"><button onclick="clearSlot(\'' + slot + '\',\'' + thumbId + '\',\'' + hintId + '\')" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.6);color:#fff;border:none;cursor:pointer;font-size:11px;line-height:18px;text-align:center;padding:0">\u00d7</button></div>';
        if (hint) hint.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function clearSlot(slot, thumbId, hintId) {
    uploads[slot] = null;
    const thumb = document.getElementById(thumbId);
    const hint = document.getElementById(hintId);
    if (thumb) thumb.innerHTML = '';
    if (hint) hint.style.display = '';
}


function handleFiles(files, thumbsId, bucket) {
    const maxFiles = bucket === 'progRef' ? 1 : 2;
    const remaining = maxFiles - uploads[bucket].length;
    if (remaining <= 0) {
        alert(`最多上传 ${maxFiles} 张`);
        return;
    }
    Array.from(files).slice(0, remaining).forEach(file => {
        const validationError = validateStudioImage(file);
        if (validationError) { showStudioUploadError(validationError); return; }
        const reader = new FileReader();
        reader.onload = ev => {
            const base64 = ev.target.result.split(',')[1];
            uploads[bucket].push({ name: file.name, base64, mimeType: file.type, dataUrl: ev.target.result });
            renderThumbs(thumbsId, bucket);
        };
        reader.readAsDataURL(file);
    });
    if (files.length > remaining) {
        alert(`最多上传 ${maxFiles} 张，已自动限制`);
    }
}

function renderThumbs(thumbsId, bucket) {
    const wrap = document.getElementById(thumbsId);
    wrap.innerHTML = '';
    uploads[bucket].forEach((f, i) => {
        const div = document.createElement('div');
        div.className = 'sf-preview-item';
        div.innerHTML = `<img src="${f.dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"><button data-i="${i}">×</button>`;
        div.querySelector('button').addEventListener('click', () => {
            uploads[bucket].splice(i, 1); renderThumbs(thumbsId, bucket);
        });
        wrap.appendChild(div);
    });
}

function updateCharCount(el, countId, max) {
    const n = el.value.length;
    const el2 = document.getElementById(countId);
    if (el2) el2.textContent = n;
    el.style.borderColor = n > max * 0.9 ? (n >= max ? '#ef4444' : '#f59e0b') : '';
}

async function uploadImages(files, prefix) {
    const keys = [];
    for (const f of files) {
        const fd = new FormData();
        const blob = await fetch('data:' + f.mimeType + ';base64,' + f.base64).then(r => r.blob());
        fd.append('file', blob, f.name);
        fd.append('prefix', prefix);
        const res = await fetch('/api/studio-upload', { method: 'POST', body: fd });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error('上传图片失败: ' + (json.error || res.status));
        keys.push({ key: json.key, name: json.name });
    }
    return keys;
}

async function submitTask(mode, payload, statusEl, btn, onSuccess) {
    if (!currentUser) { showLoginModal(); return; }
    if (!hasAgreed()) { openGuide(); guideShowPage(2); return; }
    if (btn.dataset.loading === '1') return;
    btn.dataset.loading = '1';
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = '提交中...';
    statusEl.className = 'studio-status';
    try {
        statusEl.textContent = '上传图片中...';
        const productKeys = payload.productImages && payload.productImages.length ? await uploadImages(payload.productImages, 'studio/product') : [];
        const refPrefix = mode === 'retouch' ? 'studio/retouch' : mode === 'variant' ? 'studio/variant' : 'studio/ref';
        const uploadedRefKeys = payload.refImages && payload.refImages.length ? await uploadImages(payload.refImages, refPrefix) : [];
        const refKeys = uploadedRefKeys;
        const modelKeys = payload.modelImages && payload.modelImages.length ? await uploadImages(payload.modelImages, 'studio/model') : [];

        statusEl.textContent = '提交中...';
        const submitPayload = { mode, submitter: currentUser, productKeys, refKeys, modelKeys };
        if (payload.desc !== undefined) submitPayload.desc = payload.desc;
        if (payload.want !== undefined) submitPayload.want = payload.want;
        if (payload.note !== undefined) submitPayload.note = payload.note;
        if (payload.productName !== undefined) submitPayload.productName = payload.productName;
        if (payload.title !== undefined) submitPayload.title = payload.title;
        if (payload.subtitle !== undefined) submitPayload.subtitle = payload.subtitle;
        if (payload.otherText !== undefined) submitPayload.otherText = payload.otherText;
        if (payload.size) submitPayload.size = payload.size;
        if (payload.imageName) submitPayload.imageName = payload.imageName;
        if (payload.analyzePrompt) submitPayload.analyzePrompt = payload.analyzePrompt;
        if (payload.variantScope) submitPayload.variantScope = payload.variantScope;
        if (payload.colorName) submitPayload.colorName = payload.colorName;
        if (payload.colorHex) submitPayload.colorHex = payload.colorHex;

        const res = await fetch('/api/studio-submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(submitPayload)
        });
        const json = await res.json();
        if (res.ok && json.ok) {
            statusEl.textContent = '';
            renderForm();
            if (onSuccess) onSuccess(json);
        } else {
            statusEl.textContent = '提交失败：' + (json.error || res.status);
            statusEl.classList.add('err');
        }
    } catch (e) {
        statusEl.textContent = '错误：' + e.message;
        statusEl.classList.add('err');
    } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.dataset.loading = '';
        btn.textContent = originalText;
    }
}

function wireFreeUpload(dropId, inputId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    if (!drop || !input) return;
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
        e.preventDefault(); drop.classList.remove('dragover');
        addFreeImages(Array.from(e.dataTransfer.files));
    });
    input.addEventListener('change', e => { addFreeImages(Array.from(e.target.files)); e.target.value = ''; });
}

function wirePromptMentions() {
    const input = document.getElementById('freeDesc');
    if (!input || input.dataset.mentionWired === '1') return;
    input.dataset.mentionWired = '1';
    let menu = document.getElementById('promptMentionMenu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'promptMentionMenu';
        menu.className = 'prompt-mention-menu';
        menu.hidden = true;
        document.body.appendChild(menu);
    }

    function hide() { menu.hidden = true; }
    function show() {
        const rect = input.getBoundingClientRect();
        menu.style.left = (rect.left + 12) + 'px';
        menu.style.top = (rect.top + 42) + 'px';
        const count = uploads.freeImages.length;
        if (!count) {
            menu.innerHTML = '<div class="prompt-mention-empty">先上传图片后可 @ 引用</div>';
        } else {
            menu.innerHTML = uploads.freeImages.map((f, i) =>
                '<button type="button" data-token="@参考图' + (i + 1) + '"><img src="' + f.dataUrl + '" alt=""><span>@参考图' + (i + 1) + '</span></button>'
            ).join('');
            menu.querySelectorAll('button').forEach(btn => {
                btn.onclick = () => insertMention(btn.dataset.token);
            });
        }
        menu.hidden = false;
    }
    function insertMention(token) {
        const pos = input.selectionStart || input.value.length;
        const before = input.value.slice(0, pos).replace(/@$/, '');
        const after = input.value.slice(pos);
        input.value = before + token + ' ' + after;
        input.focus();
        input.selectionStart = input.selectionEnd = (before + token + ' ').length;
        updateCharCount(input, 'freeDescCount', 8000);
        hide();
    }

    input.addEventListener('input', () => {
        const pos = input.selectionStart || 0;
        const prev = input.value.slice(Math.max(0, pos - 1), pos);
        if (prev === '@') show();
        else hide();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    document.addEventListener('click', e => {
        if (e.target === input || menu.contains(e.target)) return;
        hide();
    });
}

function addFreeImages(files) {
    files.forEach(file => {
        if (uploads.freeImages.length >= 4) return;
        const validationError = validateStudioImage(file);
        if (validationError) { showStudioUploadError(validationError); return; }
        const reader = new FileReader();
        reader.onload = ev => {
            uploads.freeImages.push({ name: file.name, base64: ev.target.result.split(',')[1], mimeType: file.type, dataUrl: ev.target.result });
            renderFreePreview();
        };
        reader.readAsDataURL(file);
    });
}

function renderFreePreview() {
    const list = document.getElementById('freePreviewList');
    const count = document.getElementById('freeImgCount');
    const box = document.getElementById('freeProductDrop');
    if (!list) return;
    const n = uploads.freeImages.length;
    if (count) count.textContent = '(' + n + '/4)';
    if (box) box.style.display = n >= 4 ? 'none' : '';
    list.innerHTML = '';
    uploads.freeImages.forEach((f, i) => {
        const item = document.createElement('div');
        item.className = 'sf-preview-item';
        item.innerHTML = '<img src="' + f.dataUrl + '" style="width:100%;height:100%;object-fit:cover;display:block">'
            + '<button onclick="removeFreeImage(' + i + ')">\u00d7</button>';
        list.appendChild(item);
    });
}

function removeFreeImage(i) {
    uploads.freeImages.splice(i, 1);
    renderFreePreview();
}

function renderFreeModelPreview() {
    const wrap = document.getElementById('freeModelPreview');
    if (!wrap) return;
    if (!uploads.freeModel) {
        wrap.innerHTML = '';
        return;
    }
    wrap.innerHTML = '<div style="display:flex;align-items:center;gap:10px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px">'
        + '<img src="' + uploads.freeModel.dataUrl + '" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb">'
        + '<div style="flex:1;min-width:0"><div style="font-size:0.82rem;font-weight:700;color:#111827">已选择模特</div><div style="font-size:0.74rem;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + uploads.freeModel.name + '</div></div>'
        + '<button type="button" onclick="uploads.freeModel=null;renderFreeModelPreview()" style="border:none;background:#fee2e2;color:#dc2626;border-radius:7px;padding:5px 9px;cursor:pointer;font-weight:700">删除</button>'
        + '</div>';
}

function renderFreeScenePreview() {
    const wrap = document.getElementById('freeScenePreview');
    if (!wrap) return;
    if (!uploads.freeScene) {
        wrap.innerHTML = '';
        return;
    }
    wrap.innerHTML = '<div style="display:flex;align-items:center;gap:10px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px">'
        + '<img src="' + uploads.freeScene.dataUrl + '" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb">'
        + '<div style="flex:1;min-width:0"><div style="font-size:0.82rem;font-weight:700;color:#111827">已选择场景</div><div style="font-size:0.74rem;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + uploads.freeScene.name + '</div></div>'
        + '<button type="button" onclick="uploads.freeScene=null;renderFreeScenePreview()" style="border:none;background:#fee2e2;color:#dc2626;border-radius:7px;padding:5px 9px;cursor:pointer;font-weight:700">删除</button>'
        + '</div>';
}

async function openLibPicker(purpose = 'reference') {
    const existing = document.getElementById('libPickerModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'libPickerModal';
    modal.dataset.purpose = purpose;
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;padding:24px;width:min(680px,95vw);max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.18)';
    box.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
        + '<span style="font-size:1rem;font-weight:700;color:#111827">' + (purpose === 'model' ? '选择模特' : purpose === 'scene' ? '选择场景' : '白底素材库') + '</span>'
        + '<button id="libPickerClose" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#9ca3af">×</button>'
        + '</div><div style="font-size:0.8rem;color:#6366f1;margin-bottom:12px">' + (purpose === 'model' ? '点击图片选择为模特参考图' : purpose === 'scene' ? '点击图片选择为场景参考图' : '点击图片加入，最多4张') + '</div>'
        + '<div id="libPickerBody"><p style="color:#9ca3af;font-size:0.85rem">加载中...</p></div>';
    modal.appendChild(box);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    document.getElementById('libPickerClose').onclick = () => modal.remove();

    try {
        const res = await fetch('/api/library');
        const json = await res.json();
        const body = document.getElementById('libPickerBody');
        if (!json.ok || !Object.keys(json.categories || {}).length) {
            body.innerHTML = '<p style="color:#9ca3af;font-size:0.85rem">素材库为空</p>'; return;
        }
        renderLibPickerCategories(json.categories, body, modal);
    } catch(err) {
        const body = document.getElementById('libPickerBody');
        if (body) body.innerHTML = '<p style="color:#ef4444;font-size:0.85rem">加载失败：' + err.message + '</p>';
    }
}

async function openModelPicker() {
    return openLibPicker('model');
}

async function openScenePicker() {
    return openLibPicker('scene');
}

function libPickerBreadcrumb(parts, onBack) {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:0.82rem;color:#6b7280';
    if (onBack) {
        const back = document.createElement('button');
        back.textContent = '‹ 返回';
        back.style.cssText = 'background:#f3f4f6;border:none;border-radius:7px;padding:5px 12px;cursor:pointer;font-size:0.8rem;color:#374151;font-weight:600';
        back.onclick = onBack;
        bar.appendChild(back);
    }
    const crumb = document.createElement('span');
    crumb.textContent = parts.join(' / ');
    bar.appendChild(crumb);
    return bar;
}

function renderLibPickerCategories(categories, body, modal) {
    body.innerHTML = '';
    const isModelPicker = modal.dataset.purpose === 'model';
    const visibleCategories = Object.fromEntries(Object.entries(categories).filter(([cat]) => isModelPicker ? cat === '模特' : modal.dataset.purpose === 'scene' ? cat !== '模特' : cat !== '模特'));
    if (!Object.keys(visibleCategories).length) {
        body.innerHTML = '<p style="color:#9ca3af;font-size:0.85rem">' + (isModelPicker ? '暂无模特素材，请先在资料库管理里上传到“模特”分类' : modal.dataset.purpose === 'scene' ? '暂无场景素材，请先在资料库里上传场景图' : '素材库为空') + '</p>';
        return;
    }
    if (isModelPicker && visibleCategories['模特']) {
        renderLibPickerProducts(categories, '模特', body, modal);
        return;
    }
    body.appendChild(libPickerBreadcrumb(['全部分类'], null));
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px';
    for (const [cat, products] of Object.entries(visibleCategories)) {
        const prodCount = Object.keys(products).length;
        const cover = (() => {
            for (const files of Object.values(products)) {
                const img = files.find(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f.name));
                if (img) return img;
            }
            return null;
        })();
        const card = document.createElement('div');
        card.style.cssText = 'cursor:pointer;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;transition:border-color 0.15s';
        card.innerHTML = (cover ? '<img src="/api/library-file/' + encodeURIComponent(cover.key) + '" style="width:100%;aspect-ratio:1.3;object-fit:cover;display:block" loading="lazy">' : '<div style="aspect-ratio:1.3;background:#f3f4f6"></div>')
            + '<div style="padding:8px 10px"><div style="font-size:0.86rem;font-weight:700;color:#111827">' + cat + '</div><div style="font-size:0.74rem;color:#9ca3af;margin-top:2px">' + prodCount + (modal.dataset.purpose === 'model' ? ' 组模特' : ' 个产品') + '</div></div>';
        card.onmouseover = () => card.style.borderColor = '#111827';
        card.onmouseout = () => card.style.borderColor = '#e5e7eb';
        card.onclick = () => renderLibPickerProducts(categories, cat, body, modal);
        grid.appendChild(card);
    }
    body.appendChild(grid);
}

function renderLibPickerProducts(categories, cat, body, modal) {
    const products = categories[cat] || {};
    body.innerHTML = '';
    body.appendChild(libPickerBreadcrumb([cat], () => renderLibPickerCategories(categories, body, modal)));
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px';
    for (const [prod, files] of Object.entries(products)) {
        const cover = files.find(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f.name)) || files[0];
        const card = document.createElement('div');
        card.style.cssText = 'cursor:pointer;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;transition:border-color 0.15s';
        card.innerHTML = (cover ? '<img src="/api/library-file/' + encodeURIComponent(cover.key) + '" style="width:100%;aspect-ratio:1.3;object-fit:cover;display:block" loading="lazy">' : '<div style="aspect-ratio:1.3;background:#f3f4f6"></div>')
            + '<div style="padding:8px 10px"><div style="font-size:0.86rem;font-weight:700;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + prod + '</div><div style="font-size:0.74rem;color:#9ca3af;margin-top:2px">' + files.length + ' 张</div></div>';
        card.onmouseover = () => card.style.borderColor = '#111827';
        card.onmouseout = () => card.style.borderColor = '#e5e7eb';
        card.onclick = () => renderLibPickerImages(categories, cat, prod, body, modal);
        grid.appendChild(card);
    }
    body.appendChild(grid);
}

function renderLibPickerImages(categories, cat, prod, body, modal) {
    const files = (categories[cat] && categories[cat][prod]) || [];
    body.innerHTML = '';
    body.appendChild(libPickerBreadcrumb([cat, prod], () => renderLibPickerProducts(categories, cat, body, modal)));
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px';
    files.forEach(f => {
        const tile = document.createElement('div');
        tile.style.cssText = 'cursor:pointer;border-radius:8px;overflow:hidden;border:2px solid transparent;transition:border-color 0.15s';
        tile.innerHTML = '<img src="/api/library-file/' + encodeURIComponent(f.key) + '" style="width:100%;aspect-ratio:1;object-fit:cover;display:block" loading="lazy">'
            + '<div style="font-size:0.7rem;color:#6b7280;padding:3px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + f.name + '</div>';
        tile.onmouseover = () => tile.style.borderColor = '#111827';
        tile.onmouseout = () => tile.style.borderColor = 'transparent';
        tile.onclick = async () => {
            const isModelPick = modal.dataset.purpose === 'model';
            const isScenePick = modal.dataset.purpose === 'scene';
            if (!isModelPick && !isScenePick && uploads.freeImages.length >= 4) { alert('最多加入 4 张'); return; }
            try {
                const r = await fetch('/api/library-file/' + encodeURIComponent(f.key));
                const blob = await r.blob();
                const reader = new FileReader();
                reader.onload = ev => {
                    const picked = { name: f.name, base64: ev.target.result.split(',')[1], mimeType: blob.type || 'image/png', dataUrl: ev.target.result };
                    if (isModelPick) {
                        uploads.freeModel = picked;
                        renderFreeModelPreview();
                        modal.remove();
                    } else if (isScenePick) {
                        uploads.freeScene = picked;
                        renderFreeScenePreview();
                        modal.remove();
                    } else {
                        uploads.freeImages.push(picked);
                        renderFreePreview();
                        if (uploads.freeImages.length >= 4) modal.remove();
                    }
                };
                reader.readAsDataURL(blob);
            } catch(err) { alert('选取失败：' + err.message); }
        };
        grid.appendChild(tile);
    });
    body.appendChild(grid);
}

function showSuccessModal(task, estimateText = '') {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '任务提交成功');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;padding:32px;width:min(420px,90vw);text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.15)';
    box.innerHTML = '<div style="width:56px;height:56px;border-radius:50%;background:#ecfdf5;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" width="28" height="28"><polyline points="20 6 9 17 4 12"/></svg></div>'
        + '<div style="font-size:1.15rem;font-weight:700;color:#111827;margin-bottom:10px">任务提交成功</div>'
        + '<div style="font-size:0.88rem;color:#6b7280;line-height:1.7">网站已收到你的任务并进入处理队列。<br>可在「我的任务」查看进度，完成后会通过钉钉通知。</div>'
        + (estimateText ? '<div style="margin-top:12px;padding:9px 12px;border-radius:7px;background:#eff6ff;color:#1d4ed8;font-size:.84rem;font-weight:700">' + estimateText + '</div>' : '')
        + (task && task.id ? '<div style="margin-top:12px;color:#9ca3af;font-size:.72rem">任务编号：' + String(task.id).replace(/[<>&]/g, '') + '</div>' : '')
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:24px">'
        + '<button type="button" id="successContinueBtn" style="padding:11px;background:#fff;color:#374151;border:1px solid #d1d5db;border-radius:8px;font-size:.92rem;font-weight:600;cursor:pointer">继续制作</button>'
        + '<a href="studio-tasks.html" style="display:flex;align-items:center;justify-content:center;padding:11px;background:#111827;color:#fff;border-radius:8px;font-size:.92rem;font-weight:600;text-decoration:none">查看我的任务</a>'
        + '</div>';
    box.querySelector('#successContinueBtn').onclick = () => overlay.remove();
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}


function sanitizePrompt(text) {
    if (!text) return text;
    let t = text;
    // 去除分辨率描述：2k/4k/8k、1080p 等
    t = t.replace(/\b\d+\s*[kK]\b/g, '');
    t = t.replace(/\b\d{3,4}\s*[pP]\b/g, '');
    t = t.replace(/[（(]?\s*(2k|4k|8k|超清|高清|4K超清)\s*[)）]?/gi, '');
    // 去除尺寸/比例描述：1600x1600、1024×768、16:9、4:3、9:16 等
    t = t.replace(/\b\d{2,5}\s*[x×*]\s*\d{2,5}\b/g, '');
    t = t.replace(/\b\d{1,2}\s*[:：]\s*\d{1,2}\b/g, '');
    t = t.replace(/(分辨率|尺寸|比例|aspect ratio|resolution)[：:][^\n，。;；]*/gi, '');
    // 收尾清理：多余空格、空括号、行首尾标点
    t = t.replace(/[（(]\s*[)）]/g, '');
    t = t.replace(/[ \t]{2,}/g, ' ');
    t = t.replace(/\n{3,}/g, '\n\n');
    return t.trim();
}

function submitFree() {
    const desc = sanitizePrompt(document.getElementById('freeDesc').value.trim());
    const want = '';
    const scene = uploads.freeScene ? uploads.freeScene.name : '';
    const sizeEl = document.getElementById('freeSizeSelect');
    const size = sizeEl ? sizeEl.value : '';
    const imageNameEl = document.getElementById('freeFileName');
    const imageName = imageNameEl ? imageNameEl.value.trim() : '';
    const status = document.getElementById('freeStatus');
    if (!desc) { showStudioFieldError(status, '请填写提示词', document.getElementById('freeDesc')); return; }
    if (!size) { showStudioFieldError(status, '请选择或填写尺寸', document.getElementById('freeSizeSelectPicker')); return; }
    submitTask('free', { desc, want, note: scene ? ('场景：' + scene) : '', scene, size, imageName, refImages: [...(uploads.freeScene ? [uploads.freeScene] : []), ...(uploads.freeImages || [])], modelImages: uploads.freeModel ? [uploads.freeModel] : [], productImages: uploads.freeProduct || [] }, status, document.getElementById('freeSubmit'), showSuccessModal);
}

function submitProgram() {
    const productName = document.getElementById('progProductName').value.trim();
    const title = document.getElementById('progTitle')?.value.trim() || '';
    const subtitle = document.getElementById('progSubtitle')?.value.trim() || '';
    const otherText = document.getElementById('progOtherText')?.value.trim() || '';
    const sizeEl = document.getElementById('progSizeSelect');
    const size = sizeEl ? sizeEl.value : '';
    const status = document.getElementById('progStatus');
    if (!productName) { showStudioFieldError(status, '请填写产品名称', document.getElementById('progProductName')); return; }
    if (!size) { showStudioFieldError(status, '请选择或填写尺寸', document.getElementById('progSizeSelectPicker')); return; }
    if (uploads.progRef.length !== 1) { showStudioFieldError(status, '请上传1张要模仿的图', document.getElementById('progRefDrop')); return; }
    if (uploads.progProduct.length !== 2) { showStudioFieldError(status, '请上传2张白底产品图（当前' + uploads.progProduct.length + '张）', document.getElementById('progProductDrop')); return; }
    submitTask('program', { productName, title, subtitle, otherText, size, analyzePrompt: ANALYZE_PROMPT, refImages: uploads.progRef, productImages: uploads.progProduct }, status, document.getElementById('progSubmit'), showSuccessModal);
}

function submitRetouch() {
    const status = document.getElementById('retouchStatus');
    if (!uploads.retouchImage) {
        showStudioFieldError(status, '请上传待精修图片', document.getElementById('retouchDropZone'));
        return;
    }
    submitTask('retouch', {
        refImages: [uploads.retouchImage]
    }, status, document.getElementById('retouchSubmit'), task => showSuccessModal(task, '精修图片预计约 30 分钟完成'));
}

async function submitVariant() {
    const status = document.getElementById('variantStatus');
    const btn = document.getElementById('variantSubmit');
    if (!uploads.variantImages.length) {
        showStudioFieldError(status, '请先上传需要改色的图片', document.getElementById('variantDrop'));
        return;
    }

    const scope = document.querySelector('#variantScope button.active')?.dataset.scope || 'product';
    const colorHex = document.getElementById('variantCustomColor')?.value || '#f8f5ef';
    const colorName = (document.getElementById('variantColorName')?.value || colorHex).trim();
    const desc = `${scope === 'background' ? '修改背景' : '修改产品'}为 ${colorName || colorHex}`;
    submitTask('variant', {
        desc,
        size: '2K 自动识别',
        variantScope: scope,
        colorName,
        colorHex,
        refImages: uploads.variantImages
    }, status, btn, task => showSuccessModal(task, '改色任务已提交，完成后会通过钉钉通知'));
}

function appendVariantResult(result, sourceName, index) {
    const results = document.getElementById('variantResults');
    if (!results) return;
    const url = result?.dataUrl || result?.url;
    if (!url) return;
    const ext = (result.mimeType || 'image/png').includes('jpeg') ? 'jpg' : 'png';
    const baseName = String(sourceName || 'variant').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '_');
    const card = document.createElement('div');
    card.className = 'variant-result-card';
    card.innerHTML = '<img src="' + url + '" alt="改色结果">'
        + '<a href="' + url + '" download="' + baseName + '-变体改色-' + (index + 1) + '.' + ext + '">下载结果</a>';
    results.appendChild(card);
}

document.querySelectorAll('.studio-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === currentMode);
    tab.addEventListener('click', () => {
        document.querySelectorAll('.studio-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentMode = tab.dataset.mode;
        const url = new URL(window.location.href);
        if (currentMode === 'free') url.searchParams.delete('mode');
        else url.searchParams.set('mode', currentMode);
        window.history.replaceState({}, '', url);
        renderForm();
        if (currentMode === 'program' && !localStorage.getItem('programGuideShown')) {
            showProgramGuide();
        }
    });
});

renderForm();
initStudioTypewriter();

function showProgramGuide() {
    const modal = document.createElement('div');
    modal.className = 'guide-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    modal.innerHTML = `<div class="guide-box" style="background:#fff;border-radius:20px;padding:48px 40px;max-width:680px;width:90%;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
        <button onclick="this.closest('.guide-modal').remove()" style="position:absolute;top:20px;right:20px;background:none;border:none;font-size:1.8rem;cursor:pointer;color:#9ca3af;line-height:1">&times;</button>
        <div style="text-align:center;margin-bottom:40px">
            <h2 style="font-size:1.8rem;font-weight:700;color:#111827;margin-bottom:12px">欢迎使用图生图模式</h2>
            <p style="color:#6b7280;font-size:1rem">4个简单步骤，快速生成亚马逊风格产品图</p>
        </div>
        <div id="programGuideStep1">
            <div style="text-align:center;margin-bottom:32px">
                <img src="/参考图.png" style="width:200px;height:200px;object-fit:cover;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,0.12);margin:0 auto">
            </div>
            <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:32px">
                <div style="flex-shrink:0;width:48px;height:48px;background:#111827;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.3rem">1</div>
                <div style="flex:1;padding-top:8px">
                    <h3 style="font-size:1.2rem;font-weight:600;color:#111827;margin-bottom:8px">上传要模仿的竞品图</h3>
                    <p style="color:#6b7280;font-size:0.95rem;line-height:1.6;margin:0">上传1张你想模仿的亚马逊产品图，AI会分析其风格、构图、光影效果</p>
                </div>
            </div>
            <div style="text-align:center;color:#d1d5db;font-size:0.85rem;margin-bottom:24px">第 1 步 / 共 3 步</div>
            <button onclick="showProgramGuideStep(2)" style="width:100%;padding:14px;background:#111827;color:#fff;border:none;border-radius:12px;font-size:1.05rem;font-weight:600;cursor:pointer">下一步</button>
        </div>
        <div id="programGuideStep2" hidden>
            <div style="text-align:center;margin-bottom:32px">
                <img src="/白底图.jpg" style="width:200px;height:200px;object-fit:cover;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,0.12);margin:0 auto">
            </div>
            <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:32px">
                <div style="flex-shrink:0;width:48px;height:48px;background:#111827;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.3rem">2</div>
                <div style="flex:1;padding-top:8px">
                    <h3 style="font-size:1.2rem;font-weight:600;color:#111827;margin-bottom:8px">上传你的白底产品图</h3>
                    <p style="color:#6b7280;font-size:0.95rem;line-height:1.6;margin:0">上传2张白底产品图，AI会将你的产品按竞品图的风格重新生成</p>
                </div>
            </div>
            <div style="text-align:center;color:#d1d5db;font-size:0.85rem;margin-bottom:24px">第 2 步 / 共 3 步</div>
            <div style="display:flex;gap:12px">
                <button onclick="showProgramGuideStep(1)" style="flex:1;padding:14px;background:#f3f4f6;color:#374151;border:none;border-radius:12px;font-size:1.05rem;font-weight:600;cursor:pointer">上一步</button>
                <button onclick="showProgramGuideStep(3)" style="flex:2;padding:14px;background:#111827;color:#fff;border:none;border-radius:12px;font-size:1.05rem;font-weight:600;cursor:pointer">下一步</button>
            </div>
        </div>
        <div id="programGuideStep3" hidden>
            <div style="text-align:center;margin-bottom:32px">
                <img src="/生成图.png" style="width:200px;height:200px;object-fit:cover;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,0.12);margin:0 auto">
            </div>
            <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:32px">
                <div style="flex-shrink:0;width:48px;height:48px;background:#111827;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.3rem">3</div>
                <div style="flex:1;padding-top:8px">
                    <h3 style="font-size:1.2rem;font-weight:600;color:#111827;margin-bottom:8px">等待AI生成成品图</h3>
                    <p style="color:#6b7280;font-size:0.95rem;line-height:1.6;margin:0">提交后约4-8分钟完成，生成的图片会保留竞品风格，替换成你的产品</p>
                </div>
            </div>
            <div style="text-align:center;color:#d1d5db;font-size:0.85rem;margin-bottom:24px">第 3 步 / 共 4 步</div>
            <div style="display:flex;gap:12px">
                <button onclick="showProgramGuideStep(2)" style="flex:1;padding:14px;background:#f3f4f6;color:#374151;border:none;border-radius:12px;font-size:1.05rem;font-weight:600;cursor:pointer">上一步</button>
                <button onclick="showProgramGuideStep(4)" style="flex:2;padding:14px;background:#111827;color:#fff;border:none;border-radius:12px;font-size:1.05rem;font-weight:600;cursor:pointer">下一步</button>
            </div>
        </div>
        <div id="programGuideStep4" hidden>
            <div style="text-align:center;margin-bottom:32px">
                <div style="display:inline-block;padding:24px;background:#fff3cd;border-radius:16px">
                    <div style="width:80px;height:80px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:3rem;font-weight:700;line-height:1">!</div>
                </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:32px">
                <div style="flex-shrink:0;width:48px;height:48px;background:#111827;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.3rem">4</div>
                <div style="flex:1;padding-top:8px">
                    <h3 style="font-size:1.2rem;font-weight:600;color:#111827;margin-bottom:8px">选择尺寸</h3>
                    <p style="color:#6b7280;font-size:0.95rem;line-height:1.6;margin:0 0 12px">提交前选择输出图片尺寸</p>
                    <div style="background:#fff3cd;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:8px">
                        <p style="color:#92400e;font-size:0.9rem;line-height:1.6;margin:0"><strong>⚠️ 重要提示：</strong>建议你参考图和你要的尺寸是一致的，不然可能会出错</p>
                    </div>
                </div>
            </div>
            <div style="text-align:center;color:#d1d5db;font-size:0.85rem;margin-bottom:24px">第 4 步 / 共 4 步</div>
            <label style="display:flex;align-items:center;gap:10px;margin-bottom:24px;cursor:pointer;padding:12px;background:#f9fafb;border-radius:10px">
                <input type="checkbox" id="programGuideDontShow" style="width:18px;height:18px;cursor:pointer">
                <span style="color:#374151;font-size:0.95rem">我已经知道了，不再显示</span>
            </label>
            <div style="display:flex;gap:12px">
                <button onclick="showProgramGuideStep(3)" style="flex:1;padding:14px;background:#f3f4f6;color:#374151;border:none;border-radius:12px;font-size:1.05rem;font-weight:600;cursor:pointer">上一步</button>
                <button onclick="closeProgramGuide()" style="flex:2;padding:14px;background:#111827;color:#fff;border:none;border-radius:12px;font-size:1.05rem;font-weight:600;cursor:pointer">开始使用</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(modal);
}

function showProgramGuideStep(step) {
    document.getElementById('programGuideStep1').hidden = step !== 1;
    document.getElementById('programGuideStep2').hidden = step !== 2;
    document.getElementById('programGuideStep3').hidden = step !== 3;
    document.getElementById('programGuideStep4').hidden = step !== 4;
}

function closeProgramGuide() {
    const checkbox = document.getElementById('programGuideDontShow');
    if (checkbox && checkbox.checked) {
        localStorage.setItem('programGuideShown', '1');
    }
    document.querySelector('.guide-modal')?.remove();
}


