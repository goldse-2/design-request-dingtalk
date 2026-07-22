
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
let currentMode = ['free', 'program', 'sheet', 'photography', 'retouch', 'variant', 'resize'].includes(requestedMode) ? requestedMode : 'free';

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
    document.querySelectorAll('.studio-submit-btn, #freeSubmit, #progSubmit, #sheetSelfSubmit, #photographySubmit, #retouchSubmit, #cutoutSubmit, #variantSubmit').forEach(btn => {
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

const A_PLUS_DOUBLE_HELP = '放入上下两个1464x600图片会自动合并上传为参考图，并且输出时会导出为两张1464x600自动分割给你';
const RESIZE_A_PLUS_DOUBLE_HELP = '分别上传上下两张 1464x600 图片，系统会先合并为一张 1464x1200 图片处理，固定输出 600x900，并自动拆成两张 600x450 发回给你。';

function renderAPlusDoubleLauncher(mode) {
    return `
                <div class="a-plus-double-launcher" id="${mode}APlusDoubleLauncher">
                    <div class="a-plus-double-action-row">
                        <button type="button" class="a-plus-double-btn" id="${mode}APlusDoubleBtn" onclick="openAPlusDoubleModal('${mode}')" aria-pressed="false">
                            <svg class="a-plus-amazon-logo" viewBox="0 0 42 22" aria-hidden="true">
                                <text x="1" y="12.5" fill="#111827" font-family="Arial, sans-serif" font-size="10.5" font-weight="700">amazon</text>
                                <path d="M7 15.2c7.7 4.1 18.7 4.4 27.2.2" fill="none" stroke="#ff9900" stroke-width="2" stroke-linecap="round"/>
                                <path d="m31.2 14.2 4 .5-1.7 3.5" fill="none" stroke="#ff9900" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            <span>A+ 连续双图（亚马逊A+首图）</span>
                        </button>
                        <button type="button" class="a-plus-double-info" onclick="toggleAPlusDoubleHelp(event, '${mode}')" aria-label="查看 A+ 连续双图说明" aria-describedby="${mode}APlusDoubleHelp">
                            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>
                        </button>
                        <div class="a-plus-double-help" id="${mode}APlusDoubleHelp" role="tooltip">${A_PLUS_DOUBLE_HELP}</div>
                    </div>
                    <div class="a-plus-double-ready" id="${mode}APlusDoubleReady" hidden>已合并为 1464 × 1200，输出后自动拆成上下两张</div>
                </div>`;
}

function renderResizeAPlusDoubleLauncher() {
    return `
                <div class="a-plus-double-launcher resize-a-plus-double-launcher" id="resizeAPlusDoubleLauncher">
                    <div class="a-plus-double-action-row">
                        <button type="button" class="a-plus-double-btn" id="resizeAPlusDoubleBtn" onclick="openAPlusDoubleModal('resize')" aria-pressed="false">
                            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M8 7h8M8 17h8"/></svg>
                            <span>A+ 连续双图</span>
                        </button>
                        <button type="button" class="a-plus-double-info" onclick="toggleAPlusDoubleHelp(event, 'resize')" aria-label="查看 A+ 连续双图说明" aria-describedby="resizeAPlusDoubleHelp">
                            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>
                        </button>
                        <div class="a-plus-double-help" id="resizeAPlusDoubleHelp" role="tooltip">${RESIZE_A_PLUS_DOUBLE_HELP}</div>
                    </div>
                    <div class="a-plus-double-ready" id="resizeAPlusDoubleReady" hidden>已合并为 1464 × 1200，固定处理为 600 × 900，完成后自动拆成上下两张 600 × 450。</div>
                </div>`;
}

function renderShootRequestLauncher(mode) {
    return `
                <div class="studio-photographer-decision" data-studio-photographer="${mode}">
                    <div class="studio-photographer-decision-row">
                        <div class="studio-photographer-decision-main">
                            ${mode === 'program' ? '<img class="studio-photographer-program-mascot" src="/assets/studio-help/program-waiting-processing.png" alt="">' : ''}
                            <div class="studio-photographer-decision-copy"><strong>由摄影师决定</strong><small>没有白底图或者是需要拍摄就可以打开，无需图片也可以打开</small></div>
                        </div>
                        <div class="sheet-self-switch-control">
                            <span class="sheet-self-switch-state is-off" id="${mode}PhotographerState">已关闭</span>
                            <label class="sheet-self-switch" title="开启摄影需求补充"><input type="checkbox" id="${mode}PhotographerToggle" data-studio-photographer-toggle="${mode}" aria-controls="${mode}PhotographerPanel" aria-expanded="false"><span></span></label>
                        </div>
                    </div>
                    <div class="studio-photographer-panel" id="${mode}PhotographerPanel" hidden>
                        <div class="studio-photographer-grid">
                            <div class="studio-photographer-upload-wrap">
                                <label class="studio-photographer-upload" id="${mode}PhotographerUpload" for="${mode}PhotographerInput">
                                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></svg>
                                    <strong>上传拍摄案例图</strong>
                                    <small>可选，留空则按参考图拍摄</small>
                                </label>
                                <button type="button" class="studio-photographer-remove" id="${mode}PhotographerRemove" aria-label="移除拍摄案例图" title="移除拍摄案例图" hidden>×</button>
                                <input type="file" id="${mode}PhotographerInput" accept="image/*" hidden>
                            </div>
                            <div class="studio-photographer-note">
                                <label for="${mode}PhotographerNote">拍摄备注 <span>可选</span></label>
                                <textarea id="${mode}PhotographerNote" maxlength="300" placeholder="例如：参考这个角度、光线或摆放方式"></textarea>
                            </div>
                        </div>
                    </div>
                </div>`;
}

const FREE_FORM = `
    <div class="studio-layout">
        <div class="studio-panel studio-generation-panel">
            <div class="studio-generation-scroll">
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
${renderShootRequestLauncher('free')}
                <button type="button" class="sf-lib-btn" style="margin-top:10px" onclick="openLibPicker()">📦 从白底素材库选</button>
                <button type="button" class="sf-lib-btn" style="margin-top:10px" onclick="openModelPicker()">🧍 选择模特</button>
                <button type="button" class="sf-lib-btn" style="margin-top:10px" onclick="openScenePicker()">🏞 选择场景</button>
                <div id="freeModelPreview" style="margin-top:10px"></div>
                <div id="freeScenePreview" style="margin-top:10px"></div>
            </div>
            <div class="sf-section">
                <div class="free-prompt-label-row">
                    <div class="sf-label">提示词 <span class="sf-req">*</span></div>
                    <button type="button" class="prompt-optimize-btn" id="optimizePromptBtn">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.5 3.5L7 8l3.5 1.5L12 13l1.5-3.5L17 8l-3.5-1.5L12 3Z"/><path d="m5 14-.8 1.8L2.5 16.5l1.7.7L5 19l.8-1.8 1.7-.7-1.7-.7L5 14Z"/><path d="m18 14-1.2 2.8L14 18l2.8 1.2L18 22l1.2-2.8L22 18l-2.8-1.2L18 14Z"/></svg>
                        <span>AI 优化</span>
                    </button>
                </div>
                <span class="prompt-optimize-status" id="optimizePromptStatus"></span>
                <textarea class="sf-textarea" id="freeDesc" rows="5" maxlength="8000" placeholder="你想创作什么？描述风格、场景、文案排版等" oninput="updateCharCount(this,'freeDescCount',8000)"></textarea>
                <div style="text-align:right;font-size:0.78rem;color:#9ca3af;margin-top:4px"><span id="freeDescCount">0</span> / 8000</div>
                <div class="prompt-mention-hint">提示：上传图片后，可在提示词中输入 <strong>@</strong> 引用图片，例如 <strong>@参考图1</strong></div>
${renderAPlusDoubleLauncher('free')}
            </div>
            <div class="sf-section" id="freeFileNameSection">
                <div class="sf-label">图片文件命名 <span class="sf-sub">（可选）</span></div>
                <input class="sf-input" id="freeFileName" type="text" maxlength="80" placeholder="例如：03-dog01">
            </div>
            <div class="sf-section" id="freeSizeSection">
                <div class="sf-label">尺寸 <span class="sf-req">*</span></div>
${renderSizePicker('freeSizeSelect')}
                <div class="size-resize-hint" id="freeSizeHint" hidden>生成后可进入 <a href="studio.html?mode=resize&width=1464&height=600">尺寸修改</a> 修改成 1464 × 600</div>
            </div>
            </div>
            <div class="studio-submit-dock">
                <button class="sf-submit" id="freeSubmit">生成图片</button>
                <div id="freeStatus" class="studio-status"></div>
            </div>
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
        <div class="studio-panel studio-generation-panel">
            <div class="studio-generation-scroll">
            <div class="sf-section" id="progRefSection">
                <div class="sf-label">竞品图片 <span class="sf-req">*</span> <span class="sf-sub">(1张)</span></div>
                <div class="sf-upload-row">
                    <div class="sf-upload-box" id="progRefDrop" tabindex="-1">
                        <input type="file" id="progRefInput" accept="image/*" hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span>上传</span>
                        <small>竞品图片 · 最大 8 MB</small>
                    </div>
                    <div class="sf-preview-list" id="progRefThumbs"></div>
                </div>
            </div>
            <div class="sf-section" id="progProductSection">
                <div class="sf-label">白底产品图 <span class="sf-req">*</span> <span class="sf-sub">(2张)</span></div>
                <div class="program-product-hint">有不同角度时，请上传两个不同角度；没有其他角度时，请将同一张图片上传两次。</div>
                <div class="sf-upload-row">
                    <div class="sf-upload-box" id="progProductDrop" tabindex="-1">
                        <input type="file" id="progProductInput" accept="image/*" multiple hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span>上传</span>
                        <small>你的白底图 · 单张最大 8 MB</small>
                    </div>
                    <div class="sf-preview-list" id="progProductThumbs"></div>
                </div>
${renderAPlusDoubleLauncher('program')}
            </div>
            <div class="sf-section" id="programPhotographerDecisionSection">
${renderShootRequestLauncher('program')}
            </div>
            <div class="sf-section">
                <div class="program-ai-label-row">
                    <div class="sf-label">产品名称 <span class="sf-req">*</span></div>
                    <button type="button" class="program-ai-btn" id="progIdentifyProductBtn" disabled>
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z"/><path d="M18.5 14l.8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7Z"/></svg>
                        <span>AI 识别产品</span>
                    </button>
                </div>
                <input class="sf-input" id="progProductName" type="text" maxlength="100" placeholder="例如：蓝牙耳机">
                <div class="program-ai-status" id="progProductAiStatus">上传白底产品图后自动识别</div>
            </div>
            <div class="sf-section">
                <div class="program-ai-label-row program-title-ai-row">
                    <div class="sf-label">标题 <span class="sf-sub">（可选，输入中文会自动翻译成英语，英语默认）</span></div>
                    <div class="program-copy-ai-action">
                        <button type="button" class="program-ai-btn program-copy-ai-btn" id="progGenerateCopyBtn" aria-describedby="progCopyAiStatus">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z"/><path d="M5 15l.8 2.7 2.7.8-2.7.8L5 22l-.8-2.7-2.7-.8 2.7-.8L5 15Z"/></svg>
                            <span>AI 优化</span>
                        </button>
                        <span class="program-ai-status program-ai-popover" id="progCopyAiStatus" role="status" aria-live="polite" hidden></span>
                    </div>
                </div>
                <input class="sf-input" id="progTitle" type="text" maxlength="100" placeholder="例如：高品质蓝牙耳机">
            </div>
            <div class="sf-section">
                <div class="sf-label">副标题 <span class="sf-sub">（可选，输入中文会自动翻译成英语，英语默认）</span></div>
                <input class="sf-input" id="progSubtitle" type="text" maxlength="100" placeholder="例如：震撼音质，舒适佩戴">
            </div>
            <div class="sf-section">
                <div class="sf-label">其他文案 <span class="sf-sub">（可选，输入中文会自动翻译成英语，英语默认）</span></div>
                <textarea class="sf-textarea" id="progOtherText" rows="3" maxlength="300" placeholder="例如：降噪技术；续航持久；蓝牙5.0"></textarea>
            </div>
            <div class="sf-section" id="progSizeSection">
                <div class="sf-label">尺寸 <span class="sf-req">*</span></div>
${renderSizePicker('progSizeSelect')}
                <div class="size-resize-hint" id="progSizeHint" hidden>生成后可进入 <a href="studio.html?mode=resize&width=1464&height=600">尺寸修改</a> 修改成 1464 × 600</div>
            </div>
            </div>
            <div class="studio-submit-dock">
                <button class="sf-submit" id="progSubmit">生成图片</button>
                <div id="progStatus" class="studio-status"></div>
            </div>
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

const SHEET_SELF_WORKFLOW = `
    <section class="sheet-self-workflow" aria-labelledby="sheetSelfWorkflowTitle">
        <div class="sheet-self-workflow-intro">
            <div>
                <div class="sheet-self-workflow-kicker">使用流程</div>
                <h3 id="sheetSelfWorkflowTitle">四步完成表格自助</h3>
            </div>
            <p>按顺序完善每个图片位，系统会自动保存当前内容。</p>
        </div>
        <ol class="sheet-self-workflow-list">
            <li class="sheet-self-workflow-step">
                <div class="sheet-self-workflow-icon" aria-hidden="true">
                    <img src="assets/studio-workflow/step-reference.png" alt="">
                </div>
                <div class="sheet-self-workflow-copy">
                    <span>步骤 01</span>
                    <h4>选择尺寸与竞品图片</h4>
                    <p>设置输出尺寸，上传竞品图片。</p>
                </div>
            </li>
            <li class="sheet-self-workflow-step">
                <div class="sheet-self-workflow-icon" aria-hidden="true">
                    <img src="assets/studio-workflow/step-copy.png" alt="">
                </div>
                <div class="sheet-self-workflow-copy">
                    <span>步骤 02</span>
                    <h4>修改标题与文案</h4>
                    <p>手动填写，或使用 AI 生成标题和卖点。</p>
                </div>
            </li>
            <li class="sheet-self-workflow-step">
                <div class="sheet-self-workflow-icon" aria-hidden="true">
                    <img src="assets/studio-workflow/step-photo.png" alt="">
                </div>
                <div class="sheet-self-workflow-copy">
                    <span>步骤 03</span>
                    <h4>确认素材与拍摄</h4>
                    <p>检查白底素材，缺少图片时开启摄影师协助。</p>
                </div>
            </li>
            <li class="sheet-self-workflow-step">
                <div class="sheet-self-workflow-icon" aria-hidden="true">
                    <img src="assets/studio-workflow/step-submit.png" alt="">
                </div>
                <div class="sheet-self-workflow-copy">
                    <span>步骤 04</span>
                    <h4>发布并提交</h4>
                    <p>确认已填写的图片位，提交后等待完成通知。</p>
                </div>
            </li>
        </ol>
    </section>`;

const SHEET_SELF_FORM = `
    <div class="sheet-self-layout">
${SHEET_SELF_WORKFLOW}
        <div class="studio-panel sheet-self-panel">
            <div class="sheet-self-head">
                <div>
                    <h2>表格自助 · 最多八个图片位</h2>
                    <p>默认显示 3 个图片位，可按需添加到 8 个；每个图片位可独立选择输出尺寸。内容和已上传图片会自动保存。</p>
                </div>
                <div class="sheet-self-save" id="sheetSelfSaveStatus">等待编辑</div>
            </div>
            <div class="sheet-self-global-product">
                <label for="sheetSelfProductName">统一产品名称 <span>*</span></label>
                <div class="sheet-self-global-input">
                    <input id="sheetSelfProductName" maxlength="100" placeholder="例如：S10 电池款">
                    <button type="button" class="program-ai-btn" id="sheetSelfIdentifyProductBtn" disabled>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z"/><path d="M18.5 14l.8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7Z"/></svg>
                        <span>AI 识别产品</span>
                    </button>
                    <div class="program-ai-status" id="sheetSelfProductAiStatus">上传白底产品图后自动识别</div>
                </div>
                <small>只需填写一次，提交时会自动用于下面所有已填写的图片位。</small>
            </div>
            <div class="sheet-self-table-head" aria-hidden="true"><span>图片 / 尺寸</span><span class="sheet-self-table-title">标题与副标题 <small>可选，输入中文会自动翻译成英语，英语默认</small></span><span class="sheet-self-table-title">其他文案 <small>可选，输入中文会自动翻译成英语，英语默认</small></span><span>素材图片</span><span>设置</span></div>
            <div class="sheet-self-grid" id="sheetSelfGrid"></div>
            <div class="sheet-self-add-row">
                <button type="button" class="sheet-self-add" id="sheetSelfAddSlot"><span aria-hidden="true">+</span> 添加图片位 <small id="sheetSelfSlotCount">3/8</small></button>
            </div>
            <div class="sheet-self-actions">
                <p>整个流程时间需要1-3小时才能完成，请耐心等待</p>
                <button class="sf-submit sheet-self-submit" id="sheetSelfSubmit">提交已填写图片</button>
            </div>
            <div id="sheetSelfStatus" class="studio-status" style="margin-top:10px"></div>
        </div>
    </div>`;

const PHOTOGRAPHY_FORM = `
    <div class="photography-layout">
        <div class="studio-panel photography-panel">
            <div class="photography-head">
                <div>
                    <h2>图片拍摄</h2>
                    <p>填写拍摄案例和备注，摄影师补图后会按每个图片位的设置处理并发给你。</p>
                </div>
                <span class="photography-badge">摄影师协助</span>
            </div>
            <div class="photography-slot-list" id="photographySlotList"></div>
            <div class="sheet-self-add-row photography-add-row">
                <button type="button" class="sheet-self-add" id="photographyAddSlot"><span aria-hidden="true">+</span> 添加图片位 <small id="photographySlotCount">1/8</small></button>
            </div>
            <div class="photography-actions">
                <p>提交后会通知摄影师；完成后通过钉钉通知，无需停留在此页面。</p>
                <button class="sf-submit" id="photographySubmit">提交拍摄需求</button>
            </div>
            <div id="photographyStatus" class="studio-status" style="margin:0 24px 18px"></div>
        </div>
    </div>`;

const RESIZE_FORM = `
    <div class="studio-layout resize-layout">
        <div class="studio-panel">
            <div class="sf-section" id="resizeTargetSection">
                <div class="sf-label">目标尺寸 <span class="sf-req">*</span></div>
                <div class="resize-target-grid" id="resizeTargetGrid">
                    <button type="button" class="resize-target-btn" data-width="800" data-height="600">修改成 800 × 600<small>AI 2K 后台处理</small></button>
                    <button type="button" class="resize-target-btn active" data-width="1464" data-height="600">修改成 1464 × 600<small>命中规格可本地处理</small></button>
                    <button type="button" class="resize-target-btn" data-width="1600" data-height="1600">修改成 1600 × 1600<small>1:1 图片本地处理</small></button>
                    <button type="button" class="resize-target-btn" data-width="970" data-height="600">修改成 970 × 600<small>AI 2K 后台处理</small></button>
                    <button type="button" class="resize-target-btn" data-width="600" data-height="450">修改成 600 × 450<small>AI 2K 后台处理</small></button>
                    <button type="button" class="resize-target-btn" data-custom="true">自定义尺寸<small>输入目标宽度和高度</small></button>
                </div>
                <div class="resize-custom-size" id="resizeCustomSize" hidden>
                    <label>宽度（px）<input id="resizeCustomWidth" type="number" min="100" max="5000" step="1" inputmode="numeric" placeholder="例如 1200"></label>
                    <span class="resize-custom-separator">×</span>
                    <label>高度（px）<input id="resizeCustomHeight" type="number" min="100" max="5000" step="1" inputmode="numeric" placeholder="例如 900"></label>
                    <div class="resize-custom-hint">宽度和高度可填写 100–5000 px</div>
                </div>
                <label class="resize-reflow-option" for="resizeReflow">
                    <input id="resizeReflow" type="checkbox">
                    <span class="resize-reflow-copy">接受图片重新排版<small>AI 自适应调整主体位置、大小和画面布局</small></span>
                </label>
            </div>
            <div class="sf-section">
                <div class="sf-label">原始图片 <span class="sf-req">*</span></div>
${renderResizeAPlusDoubleLauncher()}
                <label class="sf-upload-box resize-upload-box" id="resizeDropZone" for="resizeImageInput">
                    <input id="resizeImageInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="26" height="26"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span id="resizeDropText">批量上传需要修改尺寸的图片</span>
                    <small>JPG、PNG、WebP，单张最大 20 MB，最多 10 张</small>
                </label>
                <div class="resize-file-list" id="resizeFileList"></div>
            </div>
            <div class="resize-status" id="resizeStatus">等待上传图片</div>
            <button class="sf-submit resize-download" id="resizeDownloadBtn" disabled>上传图片后继续</button>
            <canvas id="resizeCanvas" style="display:none"></canvas>
        </div>
        <div class="studio-preview resize-preview">
            <div class="studio-preview-tab retouch-queue-head"><span>尺寸修改队列</span></div>
            <div class="studio-preview-body">
                <div class="retouch-queue-summary" id="resizeQueueSummary"></div>
                <div class="retouch-queue-list" id="resizeQueueList"><div class="retouch-queue-empty">正在加载尺寸修改队列...</div></div>
            </div>
        </div>
    </div>`;

const RETOUCH_FORM = `
    <div class="studio-layout retouch-layout">
        <div class="retouch-left-stack">
            <div class="studio-panel">
                <div class="sf-section">
                    <div class="sf-label">待精修图片 <span class="sf-req">*</span></div>
                    <label class="sf-upload-box retouch-upload-box" id="retouchDropZone" for="retouchImageInput">
                        <input id="retouchImageInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="26" height="26"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span>上传图片</span>
                        <small id="retouchUploadHint">JPG、PNG、WebP，单张最大 15 MB，最多 20 张</small>
                    </label>
                    <div class="retouch-selected-grid" id="retouchSelected"></div>
                </div>
                <button class="sf-submit" id="retouchSubmit">开始精修</button>
                <div class="retouch-shoot-hint">需要拍摄可以在这里提交<a href="library.html?shoot=1">拍摄需求</a></div>
                <div id="retouchStatus" class="studio-status" style="margin-top:10px" aria-live="polite"></div>
            </div>
            <div class="studio-panel cutout-panel">
                <div class="cutout-panel-title">白底抠图</div>
                <div class="cutout-panel-copy">批量上传图片，自动逐张抠出产品并处理为白底图。</div>
                <div class="sf-section">
                    <div class="sf-label">待处理图片 <span class="sf-req">*</span></div>
                    <label class="sf-upload-box retouch-upload-box" id="cutoutDropZone" for="cutoutImageInput">
                        <input id="cutoutImageInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="26" height="26"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span>上传图片</span>
                        <small id="cutoutUploadHint">JPG、PNG、WebP，单张最大 15 MB，最多 20 张</small>
                    </label>
                    <div class="retouch-selected-grid" id="cutoutSelected"></div>
                </div>
                <div class="sf-section">
                    <label class="sf-label" for="cutoutMode">白底类型</label>
                    <select id="cutoutMode" style="width:100%;height:42px;padding:0 12px;border:1px solid #d1d5db;border-radius:7px;background:#fff;color:#111827;font:inherit;cursor:pointer">
                        <option value="normal" selected>普通白底</option>
                        <option value="vector">矢量图白底</option>
                    </select>
                </div>
                <div class="sf-section" id="cutoutOutputFormatSection">
                    <label class="sf-label" for="cutoutOutputFormat">导出格式</label>
                    <select id="cutoutOutputFormat" style="width:100%;height:42px;padding:0 12px;border:1px solid #d1d5db;border-radius:7px;background:#fff;color:#111827;font:inherit;cursor:pointer">
                        <option value="png" selected>PNG</option>
                        <option value="jpg">JPG</option>
                    </select>
                </div>
                <button class="sf-submit" id="cutoutSubmit">开始白底抠图</button>
                <div class="cutout-auto-hint">无需审核，提交后立即发送处理；完成后会通过钉钉通知。</div>
                <div id="cutoutStatus" class="studio-status" style="margin-top:10px" aria-live="polite"></div>
            </div>
        </div>
        <div class="studio-preview retouch-preview">
            <div class="studio-preview-tab retouch-queue-head"><span>精修队列</span></div>
            <div class="studio-preview-body">
                <div class="retouch-queue-summary" id="retouchQueueSummary"></div>
                <div class="retouch-queue-list" id="retouchQueueList"><div class="retouch-queue-empty">正在加载精修队列...</div></div>
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
                    <button type="button" data-scope="style">修改风格（不改产品）</button>
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
                <div class="sf-label">图片 <span class="sf-req">*</span> <span class="sf-sub" id="variantImgCount">(0/20)</span></div>
                <div class="sf-upload-row">
                    <div class="sf-upload-box variant-upload-box" id="variantDrop">
                        <input type="file" id="variantInput" accept="image/*" multiple hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span>上传图片</span>
                        <small>默认最多 20 张，单张最大 15 MB</small>
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

const uploads = { freeImages: [], freeModel: null, freeScene: null, freeProduct: [], freeProduct1: null, freeProduct2: null, helpImages: [], progRef: [], progProduct: [], retouchImages: [], cutoutImages: [], variantImages: [] };
const studioHelpState = { type: '' };
const inlineShootRequestState = {
    free: { enabled: false, image: null },
    program: { enabled: false, image: null }
};
const SHEET_SELF_DEFAULT_SLOT_COUNT = 3;
const SHEET_SELF_SLOT_COUNT = 8;
const SHEET_SELF_LOCAL_PREFIX = 'sheet_self_draft_v1:';
let sheetSelfState = createEmptySheetSelfState();
let sheetSelfLoadedUnionId = '';
let sheetSelfSaveTimer = null;
let sheetSelfSaving = false;
let sheetSelfDirty = false;
let sheetSelfServerLoadedUnionId = '';
let sheetSelfPagehideWired = false;
let sheetLibraryTarget = null;
let sheetSelfProductAiBusy = false;
let sheetSelfProductAiRequestId = 0;
let programProductAiTimer = null;
let programProductAiBusy = false;
let programCopyAiBusy = false;
let programCopyAiStatusTimer = null;
let programProductAiRequestId = 0;
let resizeToolCleanup = null;
let resizeAPlusApplyHandler = null;
const MAX_STUDIO_FILE_SIZE = 8 * 1024 * 1024;
const MAX_RETOUCH_FILE_SIZE = 15 * 1024 * 1024;
const MAX_VARIANT_FILE_SIZE = 15 * 1024 * 1024;
const MAX_VARIANT_IMAGES = 20;
const MAX_RETOUCH_IMAGES = 20;
const PHOTOGRAPHY_SLOT_COUNT = 8;
const A_PLUS_DOUBLE_WIDTH = 1464;
const A_PLUS_DOUBLE_HALF_HEIGHT = 600;
const A_PLUS_DOUBLE_SIZE = '1464x1200';
const aPlusDoubleState = {
    enabled: false,
    mode: '',
    top: null,
    bottom: null,
    merged: null,
    previousSize: '',
    previousRefs: []
};
const photographyModeState = {
    slots: [createPhotographyModeSlot(0)]
};

function createPhotographyModeSlot(index) {
    return {
        index,
        photographyExampleKey: null,
        photographyNote: '',
        skipRetouch: true,
        cutoutEnabled: true,
        uploading: false
    };
}

function createEmptySheetSelfState() {
    return {
        version: 4,
        productName: '',
        savedAt: '',
        slots: Array.from({ length: SHEET_SELF_DEFAULT_SLOT_COUNT }, (_, index) => createSheetSelfSlot(index))
    };
}

function createSheetSelfSlot(index) {
    return {
        index,
        noProductImage: false,
        photographer: false,
        photographyExampleKey: null,
        photographyNote: '',
        size: '1600x1600',
        aPlusDouble: false,
        title: '',
        subtitle: '',
        otherText: '',
        referenceKey: null,
        productKeys: [],
        uploading: false,
        status: '',
        copyAiBusy: false,
        copyAiStatus: '',
        copyAiState: '',
        copyAiRequestId: 0
    };
}

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

function resetAPlusDoubleState() {
    Object.assign(aPlusDoubleState, {
        enabled: false,
        mode: '',
        top: null,
        bottom: null,
        merged: null,
        previousSize: '',
        previousRefs: []
    });
}

function isAPlusDoubleActive(mode = currentMode) {
    return aPlusDoubleState.enabled && aPlusDoubleState.mode === mode;
}

function toggleAPlusDoubleHelp(event, mode) {
    event.preventDefault();
    event.stopPropagation();
    const help = document.getElementById(mode + 'APlusDoubleHelp');
    if (!help) return;
    const shouldOpen = !help.classList.contains('is-open');
    document.querySelectorAll('.a-plus-double-help.is-open').forEach(item => item.classList.remove('is-open'));
    help.classList.toggle('is-open', shouldOpen);
}

document.addEventListener('click', event => {
    if (event.target.closest('.a-plus-double-info')) return;
    document.querySelectorAll('.a-plus-double-help.is-open').forEach(item => item.classList.remove('is-open'));
});

function loadAPlusImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('图片解析失败，请重新选择。'));
        image.src = src;
    });
}

async function readAPlusHalf(file, label, maxBytes = MAX_STUDIO_FILE_SIZE) {
    const validationError = validateAPlusHalfFile(file, maxBytes);
    if (validationError) throw new Error(validationError);
    const upload = await fileToStudioUpload(file);
    const image = await loadAPlusImage(upload.dataUrl);
    if (image.naturalWidth !== A_PLUS_DOUBLE_WIDTH || image.naturalHeight !== A_PLUS_DOUBLE_HALF_HEIGHT) {
        throw new Error(`${label}必须是 1464 × 600，当前是 ${image.naturalWidth} × ${image.naturalHeight}`);
    }
    return { ...upload, width: image.naturalWidth, height: image.naturalHeight };
}

function validateAPlusHalfFile(file, maxBytes) {
    if (!file?.type?.startsWith('image/')) return '请选择图片文件';
    if (file.size > maxBytes) return `图片不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`;
    return '';
}

async function mergeAPlusHalves(top, bottom) {
    const [topImage, bottomImage] = await Promise.all([
        loadAPlusImage(top.dataUrl),
        loadAPlusImage(bottom.dataUrl)
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = A_PLUS_DOUBLE_WIDTH;
    canvas.height = A_PLUS_DOUBLE_HALF_HEIGHT * 2;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(topImage, 0, 0, A_PLUS_DOUBLE_WIDTH, A_PLUS_DOUBLE_HALF_HEIGHT);
    context.drawImage(bottomImage, 0, A_PLUS_DOUBLE_HALF_HEIGHT, A_PLUS_DOUBLE_WIDTH, A_PLUS_DOUBLE_HALF_HEIGHT);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.96));
    if (!blob) throw new Error('双图合并失败，请重新选择图片。');
    const file = new File([blob], 'A+连续双图-参考图.jpg', { type: 'image/jpeg', lastModified: Date.now() });
    const upload = await fileToStudioUpload(file);
    return { ...upload, file, width: canvas.width, height: canvas.height, isAPlusDouble: true };
}

function syncSizePickerValue(inputId, value) {
    const input = document.getElementById(inputId);
    const picker = document.getElementById(inputId + 'Picker');
    if (!input || !picker) return;
    input.value = value || '';
    const exactButton = Array.from(picker.querySelectorAll('[data-size-value]')).find(button => button.dataset.sizeValue === value);
    picker.querySelectorAll('[data-size-value], [data-size-custom]').forEach(button => {
        button.classList.toggle('active', button === exactButton);
    });
    const customRow = picker.querySelector('.size-custom-row');
    const customMatch = String(value || '').match(/自定义尺寸\s*(\d+)x(\d+)/);
    if (customRow) customRow.hidden = !customMatch;
    if (customMatch) {
        const width = picker.querySelector('[data-size-width]');
        const height = picker.querySelector('[data-size-height]');
        if (width) width.value = customMatch[1];
        if (height) height.value = customMatch[2];
        picker.querySelectorAll('[data-size-custom]').forEach(button => button.classList.add('active'));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function setAPlusSizeLocked(inputId, locked) {
    const input = document.getElementById(inputId);
    const picker = document.getElementById(inputId + 'Picker');
    if (!input || !picker) return;
    picker.classList.toggle('is-a-plus-locked', locked);
    picker.querySelectorAll('button, input:not([type="hidden"])').forEach(control => { control.disabled = locked; });
    let lockLabel = picker.querySelector('.a-plus-size-lock');
    if (locked) {
        input.value = A_PLUS_DOUBLE_SIZE;
        picker.querySelectorAll('[data-size-value], [data-size-custom]').forEach(button => button.classList.remove('active'));
        if (!lockLabel) {
            lockLabel = document.createElement('div');
            lockLabel.className = 'a-plus-size-lock';
            lockLabel.textContent = 'A+ 连续双图已固定输出：1464 × 1200';
            picker.appendChild(lockLabel);
        }
    } else {
        lockLabel?.remove();
    }
}

function updateAPlusDoubleUi(mode) {
    const active = isAPlusDoubleActive(mode);
    const button = document.getElementById(mode + 'APlusDoubleBtn');
    const ready = document.getElementById(mode + 'APlusDoubleReady');
    if (button) {
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (ready) ready.hidden = !active;

    if (mode === 'free') {
        const nameSection = document.getElementById('freeFileNameSection');
        const nameInput = document.getElementById('freeFileName');
        const sizeSection = document.getElementById('freeSizeSection');
        if (nameSection) nameSection.hidden = active;
        if (sizeSection) sizeSection.hidden = active;
        if (nameInput) nameInput.disabled = active;
        setAPlusSizeLocked('freeSizeSelect', active);
    } else if (mode === 'program') {
        const refSection = document.getElementById('progRefSection');
        const refInput = document.getElementById('progRefInput');
        const sizeSection = document.getElementById('progSizeSection');
        refSection?.classList.toggle('a-plus-source-hidden', active);
        if (sizeSection) sizeSection.hidden = active;
        if (refInput) refInput.disabled = active;
        setAPlusSizeLocked('progSizeSelect', active);
    } else if (mode === 'resize') {
        const targetSection = document.getElementById('resizeTargetSection');
        const targetGrid = document.getElementById('resizeTargetGrid');
        const customSize = document.getElementById('resizeCustomSize');
        const customInputs = targetSection?.querySelectorAll('input[type="number"]') || [];
        const reflowInput = document.getElementById('resizeReflow');
        const dropZone = document.getElementById('resizeDropZone');
        const imageInput = document.getElementById('resizeImageInput');
        targetSection?.classList.toggle('resize-a-plus-locked', active);
        targetGrid?.querySelectorAll('.resize-target-btn').forEach(button => { button.disabled = active; });
        customInputs.forEach(input => { input.disabled = active; });
        if (reflowInput) {
            if (active) reflowInput.checked = false;
            reflowInput.disabled = active;
        }
        if (customSize) customSize.hidden = active || !targetGrid?.querySelector('.resize-target-btn.active[data-custom="true"]');
        if (dropZone) dropZone.hidden = active;
        if (imageInput) imageInput.disabled = active;

        let lockLabel = targetSection?.querySelector('.resize-a-plus-lock');
        if (active && targetSection && !lockLabel) {
            lockLabel = document.createElement('div');
            lockLabel.className = 'resize-a-plus-lock';
            lockLabel.textContent = 'A+ 连续双图已固定输出：600 × 900，完成后自动拆成上下两张 600 × 450';
            targetSection.appendChild(lockLabel);
        } else if (!active) {
            lockLabel?.remove();
        }
    }
}

function activateAPlusDouble(mode, top, bottom, merged) {
    if (!isAPlusDoubleActive(mode)) {
        if (mode === 'free' || mode === 'program') {
            const sizeInput = document.getElementById(mode === 'free' ? 'freeSizeSelect' : 'progSizeSelect');
            aPlusDoubleState.previousSize = sizeInput?.value || '2K 自动识别';
            aPlusDoubleState.previousRefs = mode === 'free' ? [...uploads.freeImages] : [...uploads.progRef];
        }
    }
    Object.assign(aPlusDoubleState, { enabled: true, mode, top, bottom, merged });
    if (mode === 'free') {
        uploads.freeImages = [merged, ...aPlusDoubleState.previousRefs.filter(item => !item?.isAPlusDouble).slice(0, 3)];
        renderFreePreview();
    } else if (mode === 'program') {
        uploads.progRef = [merged];
        renderThumbs('progRefThumbs', 'progRef');
    } else if (mode === 'resize') {
        updateAPlusDoubleUi(mode);
        resizeAPlusApplyHandler?.({ top, bottom, merged });
        return;
    }
    updateAPlusDoubleUi(mode);
}

function deactivateAPlusDouble(mode) {
    if (!isAPlusDoubleActive(mode)) return;
    const previousSize = aPlusDoubleState.previousSize || '2K 自动识别';
    const previousRefs = [...aPlusDoubleState.previousRefs];
    resetAPlusDoubleState();
    if (mode === 'free') {
        uploads.freeImages = previousRefs;
        renderFreePreview();
        syncSizePickerValue('freeSizeSelect', previousSize);
    } else if (mode === 'program') {
        uploads.progRef = previousRefs;
        renderThumbs('progRefThumbs', 'progRef');
        syncSizePickerValue('progSizeSelect', previousSize);
    } else if (mode === 'resize') {
        resizeAPlusApplyHandler?.(null);
    }
    updateAPlusDoubleUi(mode);
}

function openAPlusDoubleModal(mode) {
    if (!['free', 'program', 'resize'].includes(mode) || currentMode !== mode) return;
    const isResizeMode = mode === 'resize';
    const maxBytes = isResizeMode ? 20 * 1024 * 1024 : MAX_STUDIO_FILE_SIZE;
    const title = isResizeMode ? 'A+ 连续双图尺寸修改' : 'A+ 连续双图';
    const description = isResizeMode
        ? '分别上传上下两张 1464 × 600 图片，处理后固定输出 600 × 900，并自动拆成两张 600 × 450。'
        : '分别上传上下两张 1464 × 600 图片';
    const mergeLabel = isResizeMode ? '合并并用于尺寸修改' : '合并并使用';
    document.getElementById('aPlusDoubleModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'aPlusDoubleModal';
    overlay.className = 'a-plus-double-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'aPlusDoubleModalTitle');
    overlay.innerHTML = `
        <div class="a-plus-double-dialog">
            <div class="a-plus-double-dialog-head">
                <div><h3 id="aPlusDoubleModalTitle">${title}</h3><p>${description}</p></div>
                <button type="button" class="a-plus-double-close" aria-label="关闭">×</button>
            </div>
            <div class="a-plus-double-slot-grid">
                <div class="a-plus-double-slot-wrap">
                    <div class="a-plus-double-slot-label"><span>1</span> 上半部分</div>
                    <button type="button" class="a-plus-double-slot" data-a-plus-slot="top"></button>
                    <input type="file" accept="image/*" data-a-plus-input="top" hidden>
                </div>
                <div class="a-plus-double-slot-wrap">
                    <div class="a-plus-double-slot-label"><span>2</span> 下半部分</div>
                    <button type="button" class="a-plus-double-slot" data-a-plus-slot="bottom"></button>
                    <input type="file" accept="image/*" data-a-plus-input="bottom" hidden>
                </div>
            </div>
            <div class="a-plus-double-modal-status" aria-live="polite"></div>
            <div class="a-plus-double-dialog-actions">
                <button type="button" class="a-plus-double-cancel">取消</button>
                <button type="button" class="a-plus-double-disable" ${isAPlusDoubleActive(mode) ? '' : 'hidden'}>停用连续双图</button>
                <button type="button" class="a-plus-double-merge">${mergeLabel}</button>
            </div>
        </div>`;

    const selected = {
        top: isAPlusDoubleActive(mode) ? aPlusDoubleState.top : null,
        bottom: isAPlusDoubleActive(mode) ? aPlusDoubleState.bottom : null
    };
    const status = overlay.querySelector('.a-plus-double-modal-status');
    const mergeButton = overlay.querySelector('.a-plus-double-merge');
    const close = () => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
    };
    const setStatus = (message, error = false) => {
        status.textContent = message;
        status.classList.toggle('error', error);
    };
    const renderSlot = slot => {
        const button = overlay.querySelector(`[data-a-plus-slot="${slot}"]`);
        const item = selected[slot];
        button.replaceChildren();
        button.classList.toggle('has-image', Boolean(item));
        if (item) {
            const image = document.createElement('img');
            image.src = item.dataUrl;
            image.alt = slot === 'top' ? '上半部分预览' : '下半部分预览';
            const copy = document.createElement('span');
            const name = document.createElement('strong');
            const dimensions = document.createElement('small');
            name.textContent = item.name;
            dimensions.textContent = '1464 × 600 · 点击更换';
            copy.append(name, dimensions);
            button.append(image, copy);
        } else {
            button.innerHTML = '<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/></svg><span><strong>选择图片</strong><small>必须为 1464 × 600</small></span>';
        }
        mergeButton.disabled = !(selected.top && selected.bottom);
    };
    const selectFile = async (slot, file) => {
        if (!file) return;
        setStatus(`正在读取${slot === 'top' ? '上半部分' : '下半部分'}...`);
        try {
            selected[slot] = await readAPlusHalf(file, slot === 'top' ? '上半部分' : '下半部分', maxBytes);
            renderSlot(slot);
            setStatus(selected.top && selected.bottom ? '两张图片尺寸正确，可以合并。' : '图片尺寸正确，请继续上传另一张。');
        } catch (error) {
            setStatus(error.message, true);
        }
    };
    ['top', 'bottom'].forEach(slot => {
        const button = overlay.querySelector(`[data-a-plus-slot="${slot}"]`);
        const input = overlay.querySelector(`[data-a-plus-input="${slot}"]`);
        button.addEventListener('click', () => input.click());
        button.addEventListener('dragover', event => { event.preventDefault(); button.classList.add('dragover'); });
        button.addEventListener('dragleave', () => button.classList.remove('dragover'));
        button.addEventListener('drop', event => {
            event.preventDefault();
            button.classList.remove('dragover');
            selectFile(slot, event.dataTransfer.files[0]);
        });
        input.addEventListener('change', event => {
            selectFile(slot, event.target.files[0]);
            event.target.value = '';
        });
        renderSlot(slot);
    });
    const onKeydown = event => { if (event.key === 'Escape') close(); };
    overlay.querySelector('.a-plus-double-close').addEventListener('click', close);
    overlay.querySelector('.a-plus-double-cancel').addEventListener('click', close);
    overlay.querySelector('.a-plus-double-disable').addEventListener('click', () => {
        deactivateAPlusDouble(mode);
        close();
    });
    mergeButton.addEventListener('click', async () => {
        if (!selected.top || !selected.bottom || mergeButton.disabled) return;
        mergeButton.disabled = true;
        mergeButton.textContent = '正在合并...';
        setStatus('正在合并为 1464 × 1200...');
        try {
            const merged = await mergeAPlusHalves(selected.top, selected.bottom);
            activateAPlusDouble(mode, selected.top, selected.bottom, merged);
            close();
        } catch (error) {
            setStatus(error.message, true);
            mergeButton.disabled = false;
            mergeButton.textContent = mergeLabel;
        }
    });
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);
}

function resetInlineShootRequestState(mode) {
    const state = inlineShootRequestState[mode];
    if (!state) return;
    state.enabled = false;
    state.image = null;
}

function initInlineShootRequest(mode) {
    const state = inlineShootRequestState[mode];
    const toggle = document.getElementById(`${mode}PhotographerToggle`);
    const panel = document.getElementById(`${mode}PhotographerPanel`);
    const input = document.getElementById(`${mode}PhotographerInput`);
    const remove = document.getElementById(`${mode}PhotographerRemove`);
    const productSection = mode === 'program' ? document.getElementById('progProductSection') : null;
    if (!state || !toggle || !panel || !input || !remove) return;

    const applyToggleState = () => {
        state.enabled = toggle.checked;
        panel.hidden = !state.enabled;
        if (productSection) productSection.hidden = state.enabled;
        toggle.setAttribute('aria-expanded', String(state.enabled));
        const label = document.getElementById(`${mode}PhotographerState`);
        if (label) {
            label.textContent = state.enabled ? '已开启' : '已关闭';
            label.classList.toggle('is-off', !state.enabled);
        }
    };

    toggle.checked = false;
    applyToggleState();
    toggle.addEventListener('change', applyToggleState);
    input.addEventListener('change', event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const error = validateSheetSelfFile(file);
        if (error) {
            showStudioFieldError(
                document.getElementById(mode === 'program' ? 'progStatus' : 'freeStatus'),
                error,
                document.getElementById(`${mode}PhotographerUpload`)
            );
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            state.image = { file, name: file.name, mimeType: file.type, dataUrl: reader.result };
            renderInlineShootImage(mode);
        };
        reader.onerror = () => showStudioFieldError(
            document.getElementById(mode === 'program' ? 'progStatus' : 'freeStatus'),
            '图片读取失败，请重新选择',
            document.getElementById(`${mode}PhotographerUpload`)
        );
        reader.readAsDataURL(file);
    });
    remove.addEventListener('click', () => {
        state.image = null;
        renderInlineShootImage(mode);
    });
}

function renderInlineShootImage(mode) {
    const state = inlineShootRequestState[mode];
    const upload = document.getElementById(`${mode}PhotographerUpload`);
    const remove = document.getElementById(`${mode}PhotographerRemove`);
    if (!state || !upload || !remove) return;
    if (state.image?.dataUrl) {
        upload.classList.add('has-image');
        upload.innerHTML = `<img src="${sheetSelfEsc(state.image.dataUrl)}" alt="拍摄案例图"><span>拍摄案例图 · 点击更换</span>`;
        remove.hidden = false;
        return;
    }
    upload.classList.remove('has-image');
    upload.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></svg><strong>上传拍摄案例图</strong><small>可选，留空则按参考图拍摄</small>`;
    remove.hidden = true;
}

let shootImages = [];

function setShootStatus(message, type = '') {
    const status = document.getElementById('shootStatus');
    if (!status) return;
    status.textContent = message;
    status.className = 'studio-shoot-status' + (type ? ` ${type}` : '');
}

function openShootModal() {
    if (!currentUser) {
        showLoginModal();
        return;
    }
    shootImages = [];
    document.getElementById('shootProduct').value = '';
    document.getElementById('shootDesc').value = '';
    document.getElementById('shootInput').value = '';
    document.getElementById('shootThumbs').replaceChildren();
    document.getElementById('shootSubmit').disabled = false;
    setShootStatus('');
    const modal = document.getElementById('shootModal');
    modal.removeAttribute('hidden');
    modal.classList.add('modal--visible');
    document.body.classList.add('shoot-modal-open');
    document.getElementById('shootProduct').focus();
}

function closeShootModal() {
    const modal = document.getElementById('shootModal');
    if (!modal) return;
    modal.classList.remove('modal--visible');
    modal.hidden = true;
    document.body.classList.remove('shoot-modal-open');
}

function addShootImages(files) {
    const candidates = Array.from(files || []);
    for (const file of candidates) {
        if (shootImages.length >= 3) {
            setShootStatus('参考图片最多上传 3 张', 'error');
            break;
        }
        if (!file.type.startsWith('image/')) {
            setShootStatus(`请上传图片：${file.name}`, 'error');
            continue;
        }
        if (file.size > 8 * 1024 * 1024) {
            setShootStatus(`单张图片不能超过 8 MB：${file.name}`, 'error');
            continue;
        }
        const reader = new FileReader();
        reader.onload = event => {
            if (shootImages.length >= 3) return;
            shootImages.push({ name: file.name, mimeType: file.type, dataUrl: event.target.result });
            renderShootThumbs();
            setShootStatus('');
        };
        reader.onerror = () => setShootStatus(`图片读取失败：${file.name}`, 'error');
        reader.readAsDataURL(file);
    }
}

function renderShootThumbs() {
    const wrap = document.getElementById('shootThumbs');
    wrap.replaceChildren();
    shootImages.forEach((image, index) => {
        const item = document.createElement('div');
        item.className = 'studio-shoot-thumb';
        const preview = document.createElement('img');
        preview.src = image.dataUrl;
        preview.alt = image.name;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.setAttribute('aria-label', `移除 ${image.name}`);
        remove.textContent = '×';
        remove.addEventListener('click', () => {
            shootImages.splice(index, 1);
            renderShootThumbs();
        });
        item.append(preview, remove);
        wrap.appendChild(item);
    });
}

function initShootRequest() {
    const modal = document.getElementById('shootModal');
    const drop = document.getElementById('shootDrop');
    const input = document.getElementById('shootInput');
    if (!modal || !drop || !input) return;

    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        input.click();
    });
    drop.addEventListener('dragover', event => {
        event.preventDefault();
        drop.classList.add('dragover');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', event => {
        event.preventDefault();
        drop.classList.remove('dragover');
        addShootImages(event.dataTransfer.files);
    });
    drop.addEventListener('paste', event => {
        const item = Array.from(event.clipboardData.items).find(entry => entry.type.startsWith('image/'));
        if (!item) return;
        event.preventDefault();
        addShootImages([item.getAsFile()]);
    });
    input.addEventListener('change', event => {
        addShootImages(event.target.files);
        event.target.value = '';
    });
    modal.addEventListener('click', event => {
        if (event.target === modal) closeShootModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !modal.hidden) closeShootModal();
    });
}

async function submitShoot() {
    const product = document.getElementById('shootProduct').value.trim();
    const desc = document.getElementById('shootDesc').value.trim();
    const button = document.getElementById('shootSubmit');
    if (!currentUser) {
        closeShootModal();
        showLoginModal();
        return;
    }
    if (!product) {
        setShootStatus('请填写产品名称', 'error');
        document.getElementById('shootProduct').focus();
        return;
    }
    if (!desc && !shootImages.length) {
        setShootStatus('请填写需求描述或上传参考图片', 'error');
        document.getElementById('shootDesc').focus();
        return;
    }

    button.disabled = true;
    try {
        const photoKeys = [];
        for (let index = 0; index < shootImages.length; index += 1) {
            const image = shootImages[index];
            setShootStatus(`正在上传参考图片 ${index + 1}/${shootImages.length}...`);
            const formData = new FormData();
            const blob = await fetch(image.dataUrl).then(response => response.blob());
            formData.append('file', blob, image.name);
            formData.append('prefix', 'shoot/ref');
            const uploadResponse = await fetch('/api/studio-upload', { method: 'POST', body: formData });
            const uploadResult = await uploadResponse.json();
            if (!uploadResponse.ok || !uploadResult.ok) throw new Error(uploadResult.error || '图片上传失败');
            photoKeys.push({ key: uploadResult.key, name: uploadResult.name });
        }

        setShootStatus('正在提交拍摄需求...');
        const data = {
            fileName: '白底拍摄需求',
            submitTime: new Date().toLocaleString('zh-CN'),
            basicInfo: { '型号': product, '图片数量': `${shootImages.length} 张` },
            images: photoKeys.map((image, index) => ({
                序号: `图${index + 1}`,
                区域: '拍摄参考',
                图片要求: desc,
                photoKey: image.key,
                photoName: image.name
            })),
            directPhotoKeys: photoKeys,
            directDesc: desc
        };
        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskType: '白底拍摄需求', remarks: desc, submitter: currentUser, data })
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || `提交失败 (${response.status})`);
        setShootStatus('拍摄需求已提交，我会尽快拍给你', 'success');
        setTimeout(closeShootModal, 1200);
    } catch (error) {
        setShootStatus(`提交失败：${error.message}`, 'error');
        button.disabled = false;
    }
}

function toggleModelDropdown() {
    const dd = document.getElementById('modelDropdown');
    if (dd) dd.hidden = !dd.hidden;
}

function initStudioHelp() {
    const modelSection = document.getElementById('modelSelect')?.closest('.sf-section');
    const panel = modelSection?.closest('.studio-panel');
    const layout = modelSection?.closest('.studio-layout');
    const generationScroll = modelSection?.closest('.studio-generation-scroll');
    if (!modelSection || !panel || !layout || !generationScroll) return;

    modelSection.hidden = true;
    modelSection.classList.add('legacy-model-section');

    const section = document.createElement('section');
    section.className = 'studio-help-section';
    section.id = 'studioHelpSection';
    section.innerHTML = `
        <div class="sf-label">问题反馈 / 协助</div>
        <div class="studio-help-launcher">
            <button type="button" class="studio-help-trigger" id="studioHelpTrigger" aria-expanded="false" aria-controls="studioHelpOptions">
                <span class="studio-help-trigger-icon" aria-hidden="true">
                    <img src="assets/studio-help/phone-assist.png" alt="">
                </span>
                <span class="studio-help-trigger-copy"><strong id="studioHelpTriggerTitle">问题反馈 / 协助</strong><small id="studioHelpTriggerHint">图片、描述词或使用问题都可以告诉我们</small></span>
                <svg class="studio-help-trigger-caret" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="studio-help-options" id="studioHelpOptions" role="listbox" aria-label="选择问题类型" hidden>
                <button type="button" data-help-type="图片不清晰">图片不清晰</button>
                <button type="button" data-help-type="如何使用">如何使用</button>
                <button type="button" data-help-type="需要协助">需要协助</button>
                <button type="button" data-help-type="反馈">反馈</button>
                <button type="button" data-help-type="描述词问题">描述词问题</button>
            </div>
        </div>
        <div class="studio-help-feedback" id="studioHelpFeedback" hidden>
            <div class="studio-help-feedback-head">
                <span class="studio-help-type-pill" id="studioHelpTypeLabel"></span>
                <button type="button" class="studio-help-exit" id="studioHelpExit" title="返回作图" aria-label="返回作图">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <p class="studio-help-copy">请说明遇到问题的页面、操作步骤和期望结果。涉及图片或描述词时，可附上截图或原图，方便我们更快协助处理。</p>
            <div class="sf-label">问题说明 <span class="sf-req">*</span></div>
            <textarea class="sf-textarea" id="studioHelpMessage" rows="6" maxlength="2000" placeholder="请把遇到的问题写在这里" oninput="updateCharCount(this,'studioHelpMessageCount',2000)"></textarea>
            <div class="studio-help-count"><span id="studioHelpMessageCount">0</span> / 2000</div>
            <div class="sf-label studio-help-upload-label">上传图片 <span class="sf-sub">（可选，最多 4 张）</span></div>
            <div class="sf-upload-row">
                <div class="sf-upload-box" id="studioHelpDrop">
                    <input type="file" id="studioHelpInput" accept="image/*" multiple hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span>上传图片</span>
                    <small>单张最大 8 MB</small>
                </div>
                <div class="sf-preview-list" id="studioHelpPreviewList"></div>
            </div>
            <button type="button" class="sf-submit" id="studioHelpSubmit">提交问题</button>
            <div id="studioHelpStatus" class="studio-status" style="margin-top:10px" aria-live="polite"></div>
        </div>`;

    modelSection.insertAdjacentElement('afterend', section);
    generationScroll.classList.remove('free-create-section');
    [...generationScroll.children].forEach(child => {
        if (child !== modelSection && child !== section) child.classList.add('free-create-section');
    });
    [...panel.children].forEach(child => {
        if (child !== generationScroll) child.classList.add('free-create-section');
    });

    const trigger = section.querySelector('#studioHelpTrigger');
    const triggerTitle = section.querySelector('#studioHelpTriggerTitle');
    const triggerHint = section.querySelector('#studioHelpTriggerHint');
    const options = section.querySelector('#studioHelpOptions');
    const feedback = section.querySelector('#studioHelpFeedback');
    const typeLabel = section.querySelector('#studioHelpTypeLabel');
    const exit = section.querySelector('#studioHelpExit');
    const drop = section.querySelector('#studioHelpDrop');
    const input = section.querySelector('#studioHelpInput');
    const submit = section.querySelector('#studioHelpSubmit');

    const render = () => {
        const active = Boolean(studioHelpState.type);
        layout.classList.toggle('is-help-active', active);
        feedback.hidden = !active;
        trigger.classList.toggle('is-selected', active);
        triggerTitle.textContent = active ? studioHelpState.type : '问题反馈 / 协助';
        triggerHint.textContent = active ? '已选择，点击可更换问题类型' : '图片、描述词或使用问题都可以告诉我们';
        typeLabel.textContent = studioHelpState.type;
        options.querySelectorAll('button').forEach(button => {
            const selected = button.dataset.helpType === studioHelpState.type;
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-selected', String(selected));
        });
    };

    trigger.addEventListener('click', () => {
        options.hidden = !options.hidden;
        trigger.setAttribute('aria-expanded', String(!options.hidden));
    });
    options.addEventListener('click', event => {
        const button = event.target.closest('button[data-help-type]');
        if (!button) return;
        studioHelpState.type = button.dataset.helpType;
        options.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        render();
        section.querySelector('#studioHelpMessage')?.focus();
    });
    exit.addEventListener('click', () => {
        studioHelpState.type = '';
        options.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        render();
    });
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', event => {
        event.preventDefault();
        drop.classList.add('dragover');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', event => {
        event.preventDefault();
        drop.classList.remove('dragover');
        addStudioHelpImages(Array.from(event.dataTransfer.files));
    });
    input.addEventListener('change', event => {
        addStudioHelpImages(Array.from(event.target.files));
        input.value = '';
    });
    submit.addEventListener('click', submitStudioHelp);
    render();
}

function addStudioHelpImages(files) {
    const status = document.getElementById('studioHelpStatus');
    const drop = document.getElementById('studioHelpDrop');
    for (const file of files) {
        if (uploads.helpImages.length >= 4) {
            showStudioFieldError(status, '最多上传 4 张图片', drop);
            return;
        }
        const validationError = validateStudioImage(file);
        if (validationError) {
            showStudioFieldError(status, validationError, drop);
            continue;
        }
        const reader = new FileReader();
        reader.onload = event => {
            uploads.helpImages.push({ name: file.name, base64: event.target.result.split(',')[1], mimeType: file.type, dataUrl: event.target.result });
            renderStudioHelpImages();
        };
        reader.readAsDataURL(file);
    }
}

function renderStudioHelpImages() {
    const list = document.getElementById('studioHelpPreviewList');
    const drop = document.getElementById('studioHelpDrop');
    if (!list) return;
    list.replaceChildren();
    if (drop) drop.style.display = uploads.helpImages.length >= 4 ? 'none' : '';
    uploads.helpImages.forEach((image, index) => {
        const item = document.createElement('div');
        item.className = 'sf-preview-item';
        const preview = document.createElement('img');
        preview.src = image.dataUrl;
        preview.alt = `反馈图片 ${index + 1}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `删除反馈图片 ${index + 1}`);
        remove.addEventListener('click', () => {
            uploads.helpImages.splice(index, 1);
            renderStudioHelpImages();
        });
        item.append(preview, remove);
        list.append(item);
    });
}

async function submitStudioHelp() {
    if (!currentUser) { showLoginModal(); return; }
    if (!hasAgreed()) { openGuide(); guideShowPage(2); return; }
    const message = document.getElementById('studioHelpMessage')?.value.trim() || '';
    const status = document.getElementById('studioHelpStatus');
    const button = document.getElementById('studioHelpSubmit');
    if (!studioHelpState.type) return;
    if (!message) {
        showStudioFieldError(status, '请写下遇到的问题', document.getElementById('studioHelpMessage'));
        return;
    }
    if (button.dataset.loading === '1') return;

    const originalText = button.textContent;
    button.dataset.loading = '1';
    button.disabled = true;
    button.classList.add('is-loading');
    status.className = 'studio-status';
    try {
        status.textContent = '正在上传图片…';
        const images = uploads.helpImages.length
            ? await uploadImages(uploads.helpImages, 'feedback-images/studio-help')
            : [];
        status.textContent = '正在提交问题…';
        const response = await fetch('/api/studio-help', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: studioHelpState.type, message, images: images.map(item => item.key), submitter: currentUser })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `提交失败 (${response.status})`);
        document.getElementById('studioHelpMessage').value = '';
        updateCharCount(document.getElementById('studioHelpMessage'), 'studioHelpMessageCount', 2000);
        uploads.helpImages = [];
        renderStudioHelpImages();
        status.textContent = '问题已提交，我们会尽快协助处理。';
        status.classList.add('ok');
    } catch (error) {
        status.textContent = `提交失败：${error.message}`;
        status.classList.add('err');
    } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.dataset.loading = '';
        button.textContent = originalText;
    }
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

let cachedStudioGalleryPreview = null;

function releaseBatchImage(image) {
    if (image?.objectUrl) URL.revokeObjectURL(image.objectUrl);
}

function clearRetouchUploads() {
    uploads.retouchImages.forEach(releaseBatchImage);
    uploads.cutoutImages.forEach(releaseBatchImage);
    uploads.retouchImages = [];
    uploads.cutoutImages = [];
}

function renderForm() {
    if (resizeToolCleanup) {
        resizeToolCleanup();
        resizeToolCleanup = null;
    }
    const area = document.getElementById('studioFormArea');
    const attachedGallery = area.querySelector('.studio-gallery-preview');
    if (attachedGallery) cachedStudioGalleryPreview = attachedGallery;
    clearRetouchUploads();
    clearTimeout(programProductAiTimer);
    clearTimeout(programCopyAiStatusTimer);
    programProductAiRequestId += 1;
    programProductAiBusy = false;
    programCopyAiBusy = false;
    resetAPlusDoubleState();
    uploads.freeImages = []; uploads.freeModel = null; uploads.freeScene = null; uploads.freeProduct = []; uploads.freeProduct1 = null; uploads.freeProduct2 = null; uploads.helpImages = []; uploads.progRef = []; uploads.progProduct = []; uploads.variantImages = [];
    studioHelpState.type = '';
    if (currentMode === 'free' || currentMode === 'program') resetInlineShootRequestState(currentMode);
    let galleryWasReady = false;
    if (currentMode === 'free') {
        galleryWasReady = renderGenerationMode(area, FREE_FORM);
        wireFreeUpload('freeProductDrop', 'freeProductInput');
        wirePromptMentions();
        wirePromptOptimizer();
        loadPromptQuota();
        initSizePicker('freeSizeSelect', 'freeSizeHint');
        initInlineShootRequest('free');
        initStudioHelp();
        document.getElementById('freeSubmit').addEventListener('click', submitFree);
    } else if (currentMode === 'program') {
        galleryWasReady = renderGenerationMode(area, PROGRAM_FORM);
        wireDrop('progRefDrop', 'progRefInput', 'progRefThumbs', 'progRef');
        wireDrop('progProductDrop', 'progProductInput', 'progProductThumbs', 'progProduct');
        wireProgramAiTools();
        initSizePicker('progSizeSelect', 'progSizeHint');
        initInlineShootRequest('program');
        document.getElementById('progSubmit').addEventListener('click', submitProgram);
    } else if (currentMode === 'sheet') {
        if (attachedGallery) attachedGallery.remove();
        area.innerHTML = SHEET_SELF_FORM;
        initSheetSelfMode();
    } else if (currentMode === 'photography') {
        if (attachedGallery) attachedGallery.remove();
        area.innerHTML = PHOTOGRAPHY_FORM;
        initPhotographyMode();
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
    if (currentMode !== 'resize' && currentMode !== 'retouch' && currentMode !== 'variant' && currentMode !== 'sheet' && currentMode !== 'photography' && !galleryWasReady) renderStudioGallery();
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

function initSheetSelfMode() {
    const unionId = currentUser?.unionId || '';
    if (unionId && sheetSelfLoadedUnionId !== unionId) {
        sheetSelfState = loadSheetSelfLocal(unionId) || createEmptySheetSelfState();
        sheetSelfLoadedUnionId = unionId;
    }
    const productNameInput = document.getElementById('sheetSelfProductName');
    productNameInput.value = sheetSelfState.productName;
    productNameInput.addEventListener('input', event => {
        sheetSelfState.productName = event.target.value;
        event.target.dataset.aiGenerated = 'false';
        persistSheetSelfDraft();
    });
    document.getElementById('sheetSelfIdentifyProductBtn')?.addEventListener('click', () => runSheetSelfProductRecognition(true));
    document.getElementById('sheetSelfAddSlot')?.addEventListener('click', addSheetSelfSlot);
    renderSheetSelfGrid();
    updateSheetSelfProductAiControls();

    const grid = document.getElementById('sheetSelfGrid');
    grid.addEventListener('input', event => {
        const field = event.target.dataset.sheetField;
        const slotIndex = Number(event.target.dataset.slotIndex);
        if (!field || !Number.isInteger(slotIndex) || !sheetSelfState.slots[slotIndex]) return;
        sheetSelfState.slots[slotIndex][field] = event.target.value;
        persistSheetSelfDraft();
    });
    grid.addEventListener('change', event => {
        const slotIndex = Number(event.target.dataset.slotIndex);
        if (!Number.isInteger(slotIndex) || !sheetSelfState.slots[slotIndex]) return;
        if (event.target.matches('[data-sheet-size]')) {
            const slot = sheetSelfState.slots[slotIndex];
            const previousAPlus = slot.aPlusDouble === true;
            slot.size = normalizeSheetSelfSize(event.target.value);
            slot.aPlusDouble = slot.size === A_PLUS_DOUBLE_SIZE;
            if (previousAPlus !== slot.aPlusDouble) {
                slot.referenceKey = null;
                resetSheetSelfCopyAiState(slot);
            }
            persistSheetSelfDraft(300);
            renderSheetSelfGrid();
            if (slot.aPlusDouble) setTimeout(() => openSheetAPlusDoubleModal(slotIndex), 0);
            return;
        }
        if (event.target.matches('[data-sheet-photographer]')) {
            const slot = sheetSelfState.slots[slotIndex];
            slot.photographer = event.target.checked;
            if (slot.photographer) slot.noProductImage = false;
            persistSheetSelfDraft();
            renderSheetSelfGrid();
            return;
        }
        if (event.target.matches('[data-sheet-no-product]')) {
            const slot = sheetSelfState.slots[slotIndex];
            slot.noProductImage = event.target.checked;
            if (slot.noProductImage) slot.photographer = false;
            slot.status = '';
            persistSheetSelfDraft();
            renderSheetSelfGrid();
            return;
        }
        const uploadType = event.target.dataset.sheetUpload;
        if (uploadType) {
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            handleSheetSelfFiles(slotIndex, uploadType, files);
        }
    });
    grid.addEventListener('click', event => {
        const previewButton = event.target.closest('[data-sheet-image-preview]');
        if (previewButton) {
            openSheetSelfImagePreview(previewButton.dataset.sheetImagePreview, previewButton.dataset.previewLabel);
            return;
        }
        const copyButton = event.target.closest('[data-sheet-generate-copy]');
        if (copyButton) {
            runSheetSelfCopyGeneration(Number(copyButton.dataset.slotIndex));
            return;
        }
        const aPlusButton = event.target.closest('[data-sheet-a-plus-edit]');
        if (aPlusButton) {
            openSheetAPlusDoubleModal(Number(aPlusButton.dataset.slotIndex));
            return;
        }
        const sourceButton = event.target.closest('[data-sheet-source]');
        if (sourceButton) {
            const slotIndex = Number(sourceButton.dataset.slotIndex);
            if (sourceButton.dataset.uploadType === 'a_plus') openSheetAPlusDoubleModal(slotIndex);
            else if (sourceButton.dataset.uploadType === 'reference') document.getElementById(`sheetRefInput-${slotIndex}`)?.click();
            else openSheetImageSource(slotIndex, sourceButton.dataset.uploadType);
            return;
        }
        const button = event.target.closest('[data-sheet-remove]');
        if (!button) return;
        const slotIndex = Number(button.dataset.slotIndex);
        const slot = sheetSelfState.slots[slotIndex];
        if (!slot) return;
        if (button.dataset.sheetRemove === 'reference') {
            slot.referenceKey = null;
            resetSheetSelfCopyAiState(slot);
        } else if (button.dataset.sheetRemove === 'photographyExample') {
            slot.photographyExampleKey = null;
        } else {
            slot.productKeys.splice(Number(button.dataset.productIndex), 1);
            sheetSelfProductAiRequestId += 1;
            sheetSelfProductAiBusy = false;
        }
        slot.status = '';
        persistSheetSelfDraft(400);
        renderSheetSelfGrid();
        updateSheetSelfProductAiControls();
    });
    grid.addEventListener('dragover', event => {
        const uploadButton = event.target.closest('[data-sheet-source][data-upload-type="reference"]');
        if (!uploadButton) return;
        event.preventDefault();
        uploadButton.classList.add('dragover');
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    grid.addEventListener('dragleave', event => {
        const uploadButton = event.target.closest('[data-sheet-source][data-upload-type="reference"]');
        if (!uploadButton || (event.relatedTarget && uploadButton.contains(event.relatedTarget))) return;
        uploadButton.classList.remove('dragover');
    });
    grid.addEventListener('drop', event => {
        const uploadButton = event.target.closest('[data-sheet-source][data-upload-type="reference"]');
        if (!uploadButton) return;
        event.preventDefault();
        uploadButton.classList.remove('dragover');
        handleSheetSelfFiles(Number(uploadButton.dataset.slotIndex), 'reference', Array.from(event.dataTransfer?.files || []));
    });
    document.getElementById('sheetSelfSubmit').addEventListener('click', submitSheetSelf);

    if (!sheetSelfPagehideWired) {
        sheetSelfPagehideWired = true;
        window.addEventListener('pagehide', () => {
            if (!sheetSelfDirty || !currentUser?.unionId) return;
            fetch('/api/sheet-self-draft', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ unionId: currentUser.unionId, draft: sheetSelfDraftPayload() }),
                keepalive: true
            }).catch(() => {});
        });
    }
    if (unionId && sheetSelfServerLoadedUnionId !== unionId) loadSheetSelfServerDraft(unionId);
}

function renderSheetSelfGrid() {
    const grid = document.getElementById('sheetSelfGrid');
    if (!grid) return;
    grid.innerHTML = sheetSelfState.slots.map(renderSheetSelfSlot).join('');
    const addButton = document.getElementById('sheetSelfAddSlot');
    const count = document.getElementById('sheetSelfSlotCount');
    if (count) count.textContent = `${sheetSelfState.slots.length}/${SHEET_SELF_SLOT_COUNT}`;
    if (addButton) {
        addButton.disabled = sheetSelfState.slots.length >= SHEET_SELF_SLOT_COUNT;
        addButton.hidden = sheetSelfState.slots.length >= SHEET_SELF_SLOT_COUNT;
    }
}

function addSheetSelfSlot() {
    if (sheetSelfState.slots.length >= SHEET_SELF_SLOT_COUNT) return;
    sheetSelfState.slots.push(createSheetSelfSlot(sheetSelfState.slots.length));
    persistSheetSelfDraft(300);
    renderSheetSelfGrid();
    document.querySelector(`[data-sheet-slot="${sheetSelfState.slots.length - 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderSheetSelfSlot(slot, slotIndex) {
    const size = normalizeSheetSelfSize(slot.size);
    const isAPlus = size === A_PLUS_DOUBLE_SIZE;
    const noProductImage = slot.noProductImage === true;
    const reference = renderSheetSelfImage(slot.referenceKey, slotIndex, 'reference', 0, isAPlus ? 'A+ 上下双图参考' : '竞品图片', isAPlus ? 'a_plus' : 'reference');
    const products = slot.photographer || noProductImage
        ? ''
        : [0, 1].map(index => renderSheetSelfImage(slot.productKeys[index], slotIndex, 'product', index, `白底产品图 ${index + 1}`)).join('');
    const uploadDisabled = slot.uploading ? ' disabled' : '';
    const copyDisabled = !slot.referenceKey?.key || slot.copyAiBusy ? ' disabled' : '';
    const copyStatus = slot.copyAiStatus || (slot.referenceKey?.key ? '竞品图片已上传，可以生成' : '请先上传竞品图片');
    const copyState = slot.copyAiState || (slot.referenceKey?.key ? 'success' : '');
    const copyTools = `<div class="sheet-self-copy-tools">
        <button type="button" class="program-ai-btn${slot.copyAiBusy ? ' loading' : ''}" data-sheet-generate-copy data-slot-index="${slotIndex}"${copyDisabled}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z"/><path d="M18.5 14l.8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7Z"/></svg>
            <span>${slot.copyAiBusy ? '正在生成...' : 'AI 自动标题和文案'}</span>
        </button>
        <div class="program-ai-status${copyState ? ' ' + copyState : ''}">${sheetSelfEsc(copyStatus)}</div>
    </div>`;
    const slotStatus = `<div class="sheet-self-slot-status${slot.status?.startsWith('失败') ? ' err' : ''}">${sheetSelfEsc(slot.status || (slot.uploading ? '图片上传中，请稍候...' : ''))}</div>`;
    return `<section class="sheet-self-slot" data-sheet-slot="${slotIndex}">
        <div class="sheet-self-slot-head">
            <div class="sheet-self-slot-title"><span class="sheet-self-slot-number">${slotIndex + 1}</span><span>第 ${slotIndex + 1} 张图片</span></div>
            <label class="sheet-self-size"><span>输出尺寸</span><select data-sheet-size data-slot-index="${slotIndex}" aria-label="第 ${slotIndex + 1} 张输出尺寸">
                <option value="1600x1600"${size === '1600x1600' ? ' selected' : ''}>1600 × 1600</option>
                <option value="1464x600"${size === '1464x600' ? ' selected' : ''}>1464 × 600</option>
                <option value="1464x1200"${isAPlus ? ' selected' : ''}>A+ 连续双图</option>
            </select></label>
        </div>
        <div class="sheet-self-fields">
            <div class="sheet-self-reference-front">${reference}</div>
            ${copyTools}
            <div class="sheet-self-field"><label>标题 <span class="sheet-self-field-note">可选，中文自动翻译成英语</span></label><input data-sheet-field="title" data-slot-index="${slotIndex}" maxlength="100" value="${sheetSelfEsc(slot.title)}" placeholder="可选"></div>
            <div class="sheet-self-field"><label>副标题 <span class="sheet-self-field-note">可选，中文自动翻译成英语</span></label><input data-sheet-field="subtitle" data-slot-index="${slotIndex}" maxlength="100" value="${sheetSelfEsc(slot.subtitle)}" placeholder="可选"></div>
        </div>
        <div class="sheet-self-product">
            <div class="sheet-self-field"><label>其他文案 <span class="sheet-self-field-note">可选，中文自动翻译成英语</span></label><textarea data-sheet-field="otherText" data-slot-index="${slotIndex}" maxlength="300" placeholder="可选，多个卖点可用分号分隔">${sheetSelfEsc(slot.otherText)}</textarea></div>
        </div>
        <div class="sheet-self-media">
            <div class="sheet-self-images${noProductImage ? ' is-no-product' : (slot.photographer ? ' is-photographer' : '')}">
                ${products}
                ${!noProductImage && slot.photographer ? renderSheetSelfPhotographyBrief(slot, slotIndex) : ''}
            </div>
            ${isAPlus ? `<div class="sheet-self-a-plus-note">输出 1464 × 1200，完成后自动拆成上下两张 1464 × 600${slot.referenceKey?.key ? `<button type="button" data-sheet-a-plus-edit data-slot-index="${slotIndex}">重新上传</button>` : ''}</div>` : ''}
            <input type="file" accept="image/*" data-sheet-upload="reference" data-slot-index="${slotIndex}" id="sheetRefInput-${slotIndex}" hidden${uploadDisabled}>
            <input type="file" accept="image/*" data-sheet-upload="product" data-slot-index="${slotIndex}" id="sheetProductInput-${slotIndex}" multiple hidden${uploadDisabled}>
            <input type="file" accept="image/*" data-sheet-upload="photographyExample" data-slot-index="${slotIndex}" id="sheetPhotographyExampleInput-${slotIndex}" hidden${uploadDisabled}>
        </div>
        <div class="sheet-self-setting">
            <div class="sheet-self-photo-row">
                <div class="sheet-self-photo-copy"><strong>由摄影师决定</strong><small>开启后，此图片位暂时不需要用户上传两张白底图</small></div>
                <label class="sheet-self-switch" title="由摄影师提供两张拍摄原图"><input type="checkbox" data-sheet-photographer data-slot-index="${slotIndex}"${slot.photographer ? ' checked' : ''}><span></span></label>
            </div>
            <div class="sheet-self-photo-row">
                <div class="sheet-self-photo-copy"><strong>无需上传产品</strong><small>根据参考图生成图片</small></div>
                <div class="sheet-self-switch-control">
                    <span class="sheet-self-switch-state${noProductImage ? ' is-on' : ' is-off'}">${noProductImage ? '已开启' : '已关闭'}</span>
                    <label class="sheet-self-switch" title="无需产品图，直接根据参考图生成"><input type="checkbox" data-sheet-no-product data-slot-index="${slotIndex}" aria-label="无需上传产品"${noProductImage ? ' checked' : ''}><span></span></label>
                </div>
            </div>
            ${slotStatus}
        </div>
    </section>`;
}

function renderSheetSelfPhotographyBrief(slot, slotIndex) {
    const example = slot.photographyExampleKey;
    const exampleUrl = example?.key ? sheetSelfImageUrl(example.key) : '';
    const exampleControl = exampleUrl
        ? `<div class="sheet-self-photography-example has-image">
            <button type="button" class="sheet-self-image-preview" data-sheet-image-preview="${sheetSelfEsc(exampleUrl)}" data-preview-label="拍摄案例图" title="点击放大查看" aria-label="放大查看拍摄案例图"><img src="${sheetSelfEsc(exampleUrl)}" alt="拍摄案例图" loading="lazy"></button>
            <span class="sheet-self-image-badge">拍摄案例图</span>
            <button type="button" class="sheet-self-image-remove" data-sheet-remove="photographyExample" data-slot-index="${slotIndex}" title="移除拍摄案例图" aria-label="移除拍摄案例图">×</button>
        </div>`
        : `<label class="sheet-self-photography-example" for="sheetPhotographyExampleInput-${slotIndex}">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></svg>
            <strong>上传拍摄案例图</strong>
            <small>可选，留空则按参考图拍摄</small>
        </label>`;
    return `<div class="sheet-self-photography-brief">
        ${exampleControl}
        <div class="sheet-self-photography-note">
            <label for="sheetPhotographyNote-${slotIndex}">拍摄备注 <span>可选</span></label>
            <textarea id="sheetPhotographyNote-${slotIndex}" data-sheet-field="photographyNote" data-slot-index="${slotIndex}" maxlength="300" placeholder="例如：参考这个角度、光线或摆放方式">${sheetSelfEsc(slot.photographyNote)}</textarea>
        </div>
    </div>`;
}

function renderSheetSelfImage(file, slotIndex, type, productIndex, label, sourceType = type) {
    if (file?.key) {
        const imageUrl = sheetSelfImageUrl(file.key);
        const removeAttrs = type === 'reference'
            ? `data-sheet-remove="reference" data-slot-index="${slotIndex}"`
            : `data-sheet-remove="product" data-slot-index="${slotIndex}" data-product-index="${productIndex}"`;
        return `<div class="sheet-self-image-slot ${type === 'reference' ? 'is-reference' : 'is-product'}">
            <button type="button" class="sheet-self-image-preview" data-sheet-image-preview="${sheetSelfEsc(imageUrl)}" data-preview-label="${sheetSelfEsc(label)}" title="点击放大查看" aria-label="放大查看${sheetSelfEsc(label)}"><img src="${sheetSelfEsc(imageUrl)}" alt="${sheetSelfEsc(label)}" loading="lazy"></button>
            <span class="sheet-self-image-badge">${sheetSelfEsc(label)}</span>
            <button type="button" class="sheet-self-image-remove" ${removeAttrs} title="移除${sheetSelfEsc(label)}" aria-label="移除${sheetSelfEsc(label)}">×</button>
        </div>`;
    }
    const uploadHint = sourceType === 'a_plus'
        ? '上传上下两张 1464 × 600'
        : sourceType === 'reference' ? '拖拽或点击上传 · 单张最大 8 MB' : '单张最大 8 MB';
    return `<div class="sheet-self-image-slot ${type === 'reference' ? 'is-reference' : 'is-product'}${sheetSelfState.slots[slotIndex].uploading ? ' is-loading' : ''}">
        <button type="button" class="sheet-self-image-choice" data-sheet-source data-slot-index="${slotIndex}" data-upload-type="${sourceType}">
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></svg>
            <span>${label}<br>${uploadHint}</span>
        </button>
    </div>`;
}

function openSheetSelfImagePreview(imageUrl, label) {
    if (!imageUrl) return;
    const existing = document.getElementById('sheetSelfImagePreview');
    if (existing?.closePreview) existing.closePreview();

    const previousOverflow = document.body.style.overflow;
    const overlay = document.createElement('div');
    const previewLabel = label || '素材图片';
    overlay.id = 'sheetSelfImagePreview';
    overlay.className = 'sheet-image-preview-overlay';
    overlay.innerHTML = `<div class="sheet-image-preview-dialog" role="dialog" aria-modal="true" aria-label="${sheetSelfEsc(previewLabel)}">
        <div class="sheet-image-preview-head"><strong>${sheetSelfEsc(previewLabel)}</strong><button type="button" class="sheet-image-preview-close" aria-label="关闭大图">×</button></div>
        <div class="sheet-image-preview-stage"><span class="sheet-image-preview-status">图片加载中...</span><img src="${sheetSelfEsc(imageUrl)}" alt="${sheetSelfEsc(previewLabel)}"></div>
    </div>`;

    const close = () => {
        document.removeEventListener('keydown', onKeydown);
        document.body.style.overflow = previousOverflow;
        overlay.remove();
    };
    const onKeydown = event => { if (event.key === 'Escape') close(); };
    overlay.closePreview = close;
    overlay.querySelector('.sheet-image-preview-close').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    const image = overlay.querySelector('img');
    const status = overlay.querySelector('.sheet-image-preview-status');
    image.addEventListener('load', () => { status.hidden = true; });
    image.addEventListener('error', () => { status.textContent = '图片加载失败，请稍后重试'; });
    document.addEventListener('keydown', onKeydown);
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
    if (image.complete) {
        if (image.naturalWidth > 0) status.hidden = true;
        else status.textContent = '图片加载失败，请稍后重试';
    }
    overlay.querySelector('.sheet-image-preview-close').focus();
}

function normalizeSheetSelfSize(value) {
    const size = String(value || '').replace(/[×\s]/g, 'x').toLowerCase();
    return ['1600x1600', '1464x600', A_PLUS_DOUBLE_SIZE].includes(size) ? size : '1600x1600';
}

function openSheetAPlusDoubleModal(slotIndex) {
    const slot = sheetSelfState.slots[slotIndex];
    if (currentMode !== 'sheet' || !slot || slot.uploading) return;
    document.getElementById('aPlusDoubleModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'aPlusDoubleModal';
    overlay.className = 'a-plus-double-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'aPlusDoubleModalTitle');
    overlay.innerHTML = `
        <div class="a-plus-double-dialog">
            <div class="a-plus-double-dialog-head">
                <div><h3 id="aPlusDoubleModalTitle">第 ${slotIndex + 1} 张 · A+ 连续双图</h3><p>分别上传上下两张 1464 × 600 图片</p></div>
                <button type="button" class="a-plus-double-close" aria-label="关闭">×</button>
            </div>
            <div class="a-plus-double-slot-grid">
                <div class="a-plus-double-slot-wrap">
                    <div class="a-plus-double-slot-label"><span>1</span> 上半部分</div>
                    <button type="button" class="a-plus-double-slot" data-a-plus-slot="top"></button>
                    <input type="file" accept="image/*" data-a-plus-input="top" hidden>
                </div>
                <div class="a-plus-double-slot-wrap">
                    <div class="a-plus-double-slot-label"><span>2</span> 下半部分</div>
                    <button type="button" class="a-plus-double-slot" data-a-plus-slot="bottom"></button>
                    <input type="file" accept="image/*" data-a-plus-input="bottom" hidden>
                </div>
            </div>
            <div class="a-plus-double-modal-status" aria-live="polite">合并后固定输出 1464 × 1200，成品会自动拆成上下两张。</div>
            <div class="a-plus-double-dialog-actions">
                <button type="button" class="a-plus-double-cancel">取消</button>
                <button type="button" class="a-plus-double-merge" disabled>合并并使用</button>
            </div>
        </div>`;

    const selected = { top: null, bottom: null };
    const status = overlay.querySelector('.a-plus-double-modal-status');
    const mergeButton = overlay.querySelector('.a-plus-double-merge');
    const close = () => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
    };
    const setStatus = (message, error = false) => {
        status.textContent = message;
        status.classList.toggle('error', error);
    };
    const renderSlot = part => {
        const button = overlay.querySelector(`[data-a-plus-slot="${part}"]`);
        const item = selected[part];
        button.replaceChildren();
        button.classList.toggle('has-image', Boolean(item));
        if (item) {
            const image = document.createElement('img');
            image.src = item.dataUrl;
            image.alt = part === 'top' ? '上半部分预览' : '下半部分预览';
            const copy = document.createElement('span');
            const name = document.createElement('strong');
            const dimensions = document.createElement('small');
            name.textContent = item.name;
            dimensions.textContent = '1464 × 600 · 点击更换';
            copy.append(name, dimensions);
            button.append(image, copy);
        } else {
            button.innerHTML = '<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/></svg><span><strong>选择图片</strong><small>必须为 1464 × 600</small></span>';
        }
        mergeButton.disabled = !(selected.top && selected.bottom);
    };
    const selectFile = async (part, file) => {
        if (!file) return;
        setStatus(`正在读取${part === 'top' ? '上半部分' : '下半部分'}...`);
        try {
            selected[part] = await readAPlusHalf(file, part === 'top' ? '上半部分' : '下半部分');
            renderSlot(part);
            setStatus(selected.top && selected.bottom ? '两张图片尺寸正确，可以合并。' : '图片尺寸正确，请继续上传另一张。');
        } catch (error) {
            setStatus(error.message, true);
        }
    };
    ['top', 'bottom'].forEach(part => {
        const button = overlay.querySelector(`[data-a-plus-slot="${part}"]`);
        const input = overlay.querySelector(`[data-a-plus-input="${part}"]`);
        button.addEventListener('click', () => input.click());
        button.addEventListener('dragover', event => { event.preventDefault(); button.classList.add('dragover'); });
        button.addEventListener('dragleave', () => button.classList.remove('dragover'));
        button.addEventListener('drop', event => {
            event.preventDefault();
            button.classList.remove('dragover');
            selectFile(part, event.dataTransfer.files[0]);
        });
        input.addEventListener('change', event => {
            selectFile(part, event.target.files[0]);
            event.target.value = '';
        });
        renderSlot(part);
    });
    const onKeydown = event => { if (event.key === 'Escape') close(); };
    overlay.querySelector('.a-plus-double-close').addEventListener('click', close);
    overlay.querySelector('.a-plus-double-cancel').addEventListener('click', close);
    mergeButton.addEventListener('click', async () => {
        if (!selected.top || !selected.bottom || mergeButton.disabled) return;
        mergeButton.disabled = true;
        mergeButton.textContent = '正在合并并保存...';
        setStatus('正在合并为 1464 × 1200 并保存...');
        slot.uploading = true;
        try {
            const merged = await mergeAPlusHalves(selected.top, selected.bottom);
            const [uploaded] = await uploadImages([{ file: merged.file, name: merged.file.name }], 'studio/sheet-self');
            slot.size = A_PLUS_DOUBLE_SIZE;
            slot.aPlusDouble = true;
            slot.referenceKey = uploaded;
            slot.status = 'A+ 上下双图已合并并保存';
            resetSheetSelfCopyAiState(slot);
            persistSheetSelfDraft(300);
            close();
        } catch (error) {
            setStatus(error.message, true);
            mergeButton.disabled = false;
            mergeButton.textContent = '合并并使用';
        } finally {
            slot.uploading = false;
            renderSheetSelfGrid();
        }
    });
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);
}

function openSheetImageSource(slotIndex, type) {
    if (!Number.isInteger(slotIndex) || !sheetSelfState.slots[slotIndex] || type !== 'product') return;
    document.getElementById('sheetImageSourceModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'sheetImageSourceModal';
    overlay.className = 'sheet-source-overlay';
    const label = type === 'reference' ? '竞品图片' : '白底产品图';
    overlay.innerHTML = `<div class="sheet-source-dialog" role="dialog" aria-modal="true" aria-label="选择图片来源">
        <div class="sheet-source-head"><strong>选择${label}来源</strong><button type="button" class="sheet-source-close" aria-label="关闭">×</button></div>
        <div class="sheet-source-options">
            <button type="button" class="sheet-source-option" data-sheet-source-action="library"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7.5h7l2 2h9v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z"/><path d="M3 7.5V5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2.5"/></svg><strong>从资料库选择</strong><small>浏览产品分类并选择已有图片</small></button>
            <button type="button" class="sheet-source-option" data-sheet-source-action="local"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></svg><strong>本地上传</strong><small>从电脑中选择一张或多张图片</small></button>
        </div>
    </div>`;
    const close = () => overlay.remove();
    overlay.querySelector('.sheet-source-close').onclick = close;
    overlay.onclick = event => { if (event.target === overlay) close(); };
    overlay.querySelector('[data-sheet-source-action="local"]').onclick = () => {
        close();
        const inputId = type === 'reference' ? `sheetRefInput-${slotIndex}` : `sheetProductInput-${slotIndex}`;
        document.getElementById(inputId)?.click();
    };
    overlay.querySelector('[data-sheet-source-action="library"]').onclick = () => {
        close();
        openSheetLibraryPicker(slotIndex, type);
    };
    document.body.appendChild(overlay);
}

function openSheetLibraryPicker(slotIndex, type) {
    sheetLibraryTarget = { slotIndex, type };
    return openLibPicker('sheet');
}

async function handleSheetSelfFiles(slotIndex, type, files) {
    const slot = sheetSelfState.slots[slotIndex];
    if (!slot || !files.length || slot.uploading) return;
    const selected = type === 'product'
        ? files.slice(0, Math.max(0, 2 - slot.productKeys.length))
        : files.slice(0, 1);
    if (!selected.length) {
        slot.status = '白底产品图最多上传两张';
        renderSheetSelfGrid();
        return;
    }
    const invalid = selected.map(validateSheetSelfFile).find(Boolean);
    if (invalid) {
        slot.status = '失败：' + invalid;
        renderSheetSelfGrid();
        return;
    }

    slot.uploading = true;
    slot.status = `正在上传 ${selected.length} 张图片...`;
    renderSheetSelfGrid();
    let shouldIdentifyProduct = false;
    try {
        const keys = await uploadImages(selected.map(file => ({ file, name: file.name })), 'studio/sheet-self');
        if (type === 'reference') {
            slot.referenceKey = keys[0];
            resetSheetSelfCopyAiState(slot);
        } else if (type === 'photographyExample') {
            slot.photographyExampleKey = keys[0];
        } else {
            slot.productKeys = [...slot.productKeys, ...keys].slice(0, 2);
            shouldIdentifyProduct = true;
        }
        slot.status = '图片已上传并保存';
        persistSheetSelfDraft(300);
    } catch (error) {
        slot.status = '失败：' + error.message;
    } finally {
        slot.uploading = false;
        renderSheetSelfGrid();
        updateSheetSelfProductAiControls();
    }
    if (shouldIdentifyProduct) queueSheetSelfProductRecognition();
}

function validateSheetSelfFile(file) {
    if (!file?.type?.startsWith('image/')) return '请选择图片文件';
    if (file.size > MAX_STUDIO_FILE_SIZE) return `${file.name} 超过 8MB`;
    return '';
}

function resetSheetSelfCopyAiState(slot) {
    slot.copyAiRequestId = (Number(slot.copyAiRequestId) || 0) + 1;
    slot.copyAiBusy = false;
    slot.copyAiStatus = '';
    slot.copyAiState = '';
}

function findSheetSelfProductImageKey() {
    for (const slot of sheetSelfState.slots) {
        const key = slot.productKeys?.find(file => file?.key)?.key;
        if (key) return key;
    }
    return '';
}

function updateSheetSelfProductAiControls() {
    const button = document.getElementById('sheetSelfIdentifyProductBtn');
    const status = document.getElementById('sheetSelfProductAiStatus');
    if (!button || !status) return;
    const hasProductImage = Boolean(findSheetSelfProductImageKey());
    button.disabled = sheetSelfProductAiBusy || !hasProductImage;
    button.classList.toggle('loading', sheetSelfProductAiBusy);
    const label = button.querySelector('span');
    if (label) label.textContent = sheetSelfProductAiBusy ? '正在识别...' : 'AI 识别产品';
    if (!sheetSelfProductAiBusy && !hasProductImage) setProgramAiStatus(status, '上传白底产品图后自动识别', '');
    else if (!sheetSelfProductAiBusy && status.textContent === '正在分析白底产品图...') {
        setProgramAiStatus(status, '白底产品图已更新，可以重新识别', 'success');
    }
}

function queueSheetSelfProductRecognition() {
    setTimeout(() => runSheetSelfProductRecognition(false), 250);
}

async function runSheetSelfProductRecognition(force) {
    const imageKey = findSheetSelfProductImageKey();
    const input = document.getElementById('sheetSelfProductName');
    const status = document.getElementById('sheetSelfProductAiStatus');
    if (!imageKey || !input || !status || sheetSelfProductAiBusy) return;
    if (!force && input.value.trim() && input.dataset.aiGenerated !== 'true') {
        setProgramAiStatus(status, '已保留手动填写，可点击“AI 识别产品”覆盖', '');
        return;
    }

    const baseline = input.value;
    const requestId = ++sheetSelfProductAiRequestId;
    sheetSelfProductAiBusy = true;
    setProgramAiStatus(status, '正在分析白底产品图...', '');
    updateSheetSelfProductAiControls();
    try {
        const data = await callProgramAi({ action: 'identify_product', imageKey });
        if (requestId !== sheetSelfProductAiRequestId || currentMode !== 'sheet') return;
        if (!force && input.value !== baseline && input.dataset.aiGenerated !== 'true') {
            setProgramAiStatus(status, '已保留手动填写，可点击“AI 识别产品”覆盖', '');
            return;
        }
        sheetSelfState.productName = data.productName;
        input.value = data.productName;
        input.dataset.aiGenerated = 'true';
        persistSheetSelfDraft(300);
        setProgramAiStatus(status, `已识别：${data.productName}`, 'success');
    } catch (error) {
        if (requestId === sheetSelfProductAiRequestId) setProgramAiStatus(status, error.message || 'AI 识别失败，请重试', 'error');
    } finally {
        if (requestId === sheetSelfProductAiRequestId) {
            sheetSelfProductAiBusy = false;
            updateSheetSelfProductAiControls();
        }
    }
}

async function runSheetSelfCopyGeneration(slotIndex) {
    const slot = sheetSelfState.slots[slotIndex];
    if (!slot?.referenceKey?.key || slot.copyAiBusy) return;
    const requestId = (Number(slot.copyAiRequestId) || 0) + 1;
    slot.copyAiRequestId = requestId;
    slot.copyAiBusy = true;
    slot.copyAiStatus = '正在分析参考图...';
    slot.copyAiState = '';
    renderSheetSelfGrid();
    try {
        const data = await callProgramAi({
            action: 'generate_copy',
            imageKey: slot.referenceKey.key,
            productName: sheetSelfState.productName.trim()
        });
        if (sheetSelfState.slots[slotIndex] !== slot || slot.copyAiRequestId !== requestId) return;
        slot.title = data.title || '';
        slot.subtitle = data.subtitle || '';
        slot.otherText = data.otherText || '';
        slot.copyAiStatus = '标题和文案已生成';
        slot.copyAiState = 'success';
        persistSheetSelfDraft(300);
    } catch (error) {
        if (sheetSelfState.slots[slotIndex] === slot && slot.copyAiRequestId === requestId) {
            slot.copyAiStatus = error.message || 'AI 文案生成失败，请重试';
            slot.copyAiState = 'error';
        }
    } finally {
        if (sheetSelfState.slots[slotIndex] === slot && slot.copyAiRequestId === requestId) {
            slot.copyAiBusy = false;
            renderSheetSelfGrid();
        }
    }
}

function persistSheetSelfDraft(delay = 5000) {
    sheetSelfState.savedAt = new Date().toISOString();
    sheetSelfDirty = true;
    if (currentUser?.unionId) {
        try { localStorage.setItem(SHEET_SELF_LOCAL_PREFIX + currentUser.unionId, JSON.stringify(sheetSelfDraftPayload())); } catch {}
    }
    setSheetSelfSaveStatus('已保存在当前设备，正在同步...', 'is-saving');
    clearTimeout(sheetSelfSaveTimer);
    sheetSelfSaveTimer = setTimeout(saveSheetSelfServerDraft, delay);
}

async function saveSheetSelfServerDraft() {
    if (!currentUser?.unionId || sheetSelfSaving || !sheetSelfDirty) return;
    sheetSelfSaving = true;
    setSheetSelfSaveStatus('正在同步...', 'is-saving');
    try {
        const response = await fetch('/api/sheet-self-draft', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unionId: currentUser.unionId, draft: sheetSelfDraftPayload() })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || '同步失败');
        sheetSelfDirty = false;
        setSheetSelfSaveStatus('已自动保存', 'is-saved');
    } catch (error) {
        setSheetSelfSaveStatus('已保存在当前设备', '');
    } finally {
        sheetSelfSaving = false;
    }
}

async function loadSheetSelfServerDraft(unionId) {
    sheetSelfServerLoadedUnionId = unionId;
    try {
        const response = await fetch('/api/sheet-self-draft?unionId=' + encodeURIComponent(unionId), { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !result.ok || !result.draft) return;
        const serverDraft = normalizeSheetSelfDraft(result.draft);
        const localTime = Date.parse(sheetSelfState.savedAt || '') || 0;
        const serverTime = Date.parse(serverDraft.savedAt || '') || 0;
        if (serverTime >= localTime && !sheetSelfDirty) {
            sheetSelfState = serverDraft;
            try { localStorage.setItem(SHEET_SELF_LOCAL_PREFIX + unionId, JSON.stringify(sheetSelfDraftPayload())); } catch {}
            if (currentMode === 'sheet') {
                const productNameInput = document.getElementById('sheetSelfProductName');
                if (productNameInput) productNameInput.value = sheetSelfState.productName;
                renderSheetSelfGrid();
                updateSheetSelfProductAiControls();
            }
        }
        setSheetSelfSaveStatus('已自动保存', 'is-saved');
    } catch {}
}

function loadSheetSelfLocal(unionId) {
    try {
        const value = JSON.parse(localStorage.getItem(SHEET_SELF_LOCAL_PREFIX + unionId) || 'null');
        return value ? normalizeSheetSelfDraft(value) : null;
    } catch { return null; }
}

function normalizeSheetSelfDraft(value) {
    const state = createEmptySheetSelfState();
    const sourceSlots = Array.isArray(value?.slots) ? value.slots.slice(0, SHEET_SELF_SLOT_COUNT) : [];
    const legacyProductName = Array.isArray(value?.slots)
        ? value.slots.find(slot => String(slot?.productName || '').trim())?.productName
        : '';
    state.productName = String(value?.productName || legacyProductName || '').slice(0, 100);
    state.savedAt = String(value?.savedAt || '');
    const highestContentIndex = sourceSlots.reduce((highest, slot, index) => sheetSelfDraftSlotHasContent(slot) ? index : highest, -1);
    const requestedCount = Number(value?.visibleSlotCount);
    const visibleSlotCount = Math.min(
        SHEET_SELF_SLOT_COUNT,
        Math.max(SHEET_SELF_DEFAULT_SLOT_COUNT, Number.isInteger(requestedCount) ? requestedCount : highestContentIndex + 1)
    );
    state.slots = Array.from({ length: visibleSlotCount }, (_, index) => {
        const empty = createSheetSelfSlot(index);
        const slot = sourceSlots[index] || {};
        const requestedSize = normalizeSheetSelfSize(slot.size);
        const aPlusDouble = requestedSize === A_PLUS_DOUBLE_SIZE || slot.aPlusDouble === true;
        return {
            ...empty,
            noProductImage: slot.noProductImage === true,
            photographer: sheetSelfDraftSlotHasContent(slot) ? slot.photographer === true : false,
            photographyExampleKey: normalizeSheetSelfFileKey(slot.photographyExampleKey),
            photographyNote: String(slot.photographyNote || '').slice(0, 300),
            size: aPlusDouble ? A_PLUS_DOUBLE_SIZE : requestedSize,
            aPlusDouble,
            title: String(slot.title || '').slice(0, 100),
            subtitle: String(slot.subtitle || '').slice(0, 100),
            otherText: String(slot.otherText || '').slice(0, 300),
            referenceKey: normalizeSheetSelfFileKey(slot.referenceKey),
            productKeys: Array.isArray(slot.productKeys) ? slot.productKeys.slice(0, 2).map(normalizeSheetSelfFileKey).filter(Boolean) : []
        };
    });
    return state;
}

function normalizeSheetSelfFileKey(value) {
    const key = String(value?.key || '');
    if (!key.startsWith('studio/sheet-self/')) return null;
    return { key, name: String(value?.name || '图片.jpg').slice(0, 160) };
}

function sheetSelfDraftPayload() {
    return {
        version: 5,
        productName: sheetSelfState.productName,
        visibleSlotCount: sheetSelfState.slots.length,
        savedAt: sheetSelfState.savedAt || new Date().toISOString(),
        slots: sheetSelfState.slots.map(slot => ({
            index: slot.index,
            noProductImage: slot.noProductImage === true,
            photographer: slot.photographer === true,
            photographyExampleKey: slot.photographyExampleKey,
            photographyNote: slot.photographyNote,
            size: normalizeSheetSelfSize(slot.size),
            aPlusDouble: slot.aPlusDouble === true,
            title: slot.title,
            subtitle: slot.subtitle,
            otherText: slot.otherText,
            referenceKey: slot.referenceKey,
            productKeys: slot.productKeys
        }))
    };
}

async function submitSheetSelf() {
    const status = document.getElementById('sheetSelfStatus');
    const button = document.getElementById('sheetSelfSubmit');
    if (!currentUser) { showLoginModal(); return; }
    if (!hasAgreed()) { openGuide(); guideShowPage(2); return; }
    if (button.dataset.loading === '1' || sheetSelfState.slots.some(slot => slot.uploading)) return;

    const activeSlots = sheetSelfState.slots.filter(sheetSelfSlotHasContent);
    if (!activeSlots.length) {
        showStudioFieldError(status, '请至少填写一个图片位', document.getElementById('sheetSelfGrid'));
        return;
    }
    if (!sheetSelfState.productName.trim()) {
        showStudioFieldError(status, '请填写顶部的统一产品名称', document.getElementById('sheetSelfProductName'));
        return;
    }
    const invalidSlot = activeSlots.find(slot => !slot.referenceKey?.key
        || (!slot.noProductImage && !slot.photographer && slot.productKeys.length !== 2));
    if (invalidSlot) {
        const invalidIndex = invalidSlot.index;
        const slot = invalidSlot;
        const message = !slot.referenceKey?.key
                ? (slot.aPlusDouble ? `第 ${invalidIndex + 1} 张请上传 A+ 上下两张 1464 × 600 图片` : `第 ${invalidIndex + 1} 张请上传竞品图片`)
                : `第 ${invalidIndex + 1} 张请上传两张白底产品图，或开启“无需上传产品”/“由摄影师决定”`;
        showStudioFieldError(status, message, document.querySelector(`[data-sheet-slot="${invalidIndex}"]`));
        return;
    }

    const originalText = button.textContent;
    button.dataset.loading = '1';
    button.disabled = true;
    button.textContent = `正在创建 ${activeSlots.length} 张任务...`;
    status.className = 'studio-status';
    status.textContent = '正在保存并启动自动流程...';
    try {
        const response = await fetch('/api/sheet-self-submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submitter: currentUser, slots: activeSlots.map(slot => ({
                index: slot.index,
                noProductImage: slot.noProductImage === true,
                photographer: slot.noProductImage === true ? false : slot.photographer,
                skipRetouch: true,
                photographyExampleKey: slot.photographyExampleKey,
                photographyNote: slot.photographyNote,
                productName: sheetSelfState.productName,
                size: normalizeSheetSelfSize(slot.size),
                aPlusDouble: slot.aPlusDouble === true,
                title: slot.title,
                subtitle: slot.subtitle,
                otherText: slot.otherText,
                referenceKey: slot.referenceKey,
                productKeys: slot.noProductImage === true ? [] : slot.productKeys
            })) })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `提交失败 (${response.status})`);

        clearTimeout(sheetSelfSaveTimer);
        sheetSelfDirty = false;
        try { localStorage.removeItem(SHEET_SELF_LOCAL_PREFIX + currentUser.unionId); } catch {}
        fetch('/api/sheet-self-draft', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unionId: currentUser.unionId, preserveFiles: true })
        }).catch(() => {});
        sheetSelfState = createEmptySheetSelfState();
        document.getElementById('sheetSelfProductName').value = '';
        renderSheetSelfGrid();
        setSheetSelfSaveStatus('已提交，新表格等待填写', 'is-saved');
        status.textContent = '';
        showSuccessModal(result, `已启动 ${result.automaticSlots} 个图片位；${result.photographerSlots} 个图片位等待摄影师补图。每完成一张就会立即发到钉钉。`);
    } catch (error) {
        status.textContent = '提交失败：' + error.message;
        status.classList.add('err');
    } finally {
        button.dataset.loading = '';
        button.disabled = false;
        button.textContent = originalText;
    }
}

function sheetSelfSlotHasContent(slot) {
    return Boolean(slot.title.trim()
        || slot.subtitle.trim()
        || slot.otherText.trim()
        || slot.photographyNote.trim()
        || normalizeSheetSelfSize(slot.size) !== '1600x1600'
        || slot.aPlusDouble === true
        || slot.noProductImage === true
        || slot.referenceKey?.key
        || slot.photographyExampleKey?.key
        || slot.productKeys.length);
}

function sheetSelfDraftSlotHasContent(slot) {
    return Boolean(String(slot?.productName || '').trim()
        || String(slot?.title || '').trim()
        || String(slot?.subtitle || '').trim()
        || String(slot?.otherText || '').trim()
        || String(slot?.photographyNote || '').trim()
        || normalizeSheetSelfSize(slot?.size) !== '1600x1600'
        || slot?.aPlusDouble === true
        || slot?.noProductImage === true
        || slot?.referenceKey?.key
        || slot?.photographyExampleKey?.key
        || (Array.isArray(slot?.productKeys) && slot.productKeys.length));
}

function setSheetSelfSaveStatus(text, className) {
    const element = document.getElementById('sheetSelfSaveStatus');
    if (!element) return;
    element.textContent = text;
    element.className = 'sheet-self-save' + (className ? ' ' + className : '');
}

function sheetSelfImageUrl(key) {
    return '/api/library-file/' + encodeURIComponent(key);
}

function sheetSelfEsc(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function initPhotographyMode() {
    const list = document.getElementById('photographySlotList');
    list?.addEventListener('click', event => {
        const preview = event.target.closest('[data-photography-preview]');
        if (preview) {
            openSheetSelfImagePreview(preview.dataset.photographyPreview, preview.dataset.previewLabel);
            return;
        }
        const removeImage = event.target.closest('[data-photography-remove-image]');
        if (removeImage) {
            const slot = photographyModeState.slots[Number(removeImage.dataset.slotIndex)];
            if (slot) slot.photographyExampleKey = null;
            renderPhotographyModeSlots();
            return;
        }
        const removeSlot = event.target.closest('[data-photography-remove-slot]');
        if (!removeSlot || photographyModeState.slots.length <= 1) return;
        photographyModeState.slots.splice(Number(removeSlot.dataset.slotIndex), 1);
        photographyModeState.slots.forEach((slot, index) => { slot.index = index; });
        renderPhotographyModeSlots();
    });
    list?.addEventListener('change', event => {
        const slotIndex = Number(event.target.dataset.slotIndex);
        const slot = photographyModeState.slots[slotIndex];
        if (!slot) return;
        if (event.target.matches('[data-photography-example-input]')) {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) handlePhotographyModeFile(slotIndex, file);
            return;
        }
        if (event.target.matches('[data-photography-retouch]')) {
            slot.skipRetouch = !event.target.checked;
            renderPhotographyModeSlots();
            return;
        }
        if (event.target.matches('[data-photography-cutout]')) {
            slot.cutoutEnabled = event.target.checked;
            renderPhotographyModeSlots();
        }
    });
    list?.addEventListener('input', event => {
        if (!event.target.matches('[data-photography-note]')) return;
        const slot = photographyModeState.slots[Number(event.target.dataset.slotIndex)];
        if (slot) slot.photographyNote = event.target.value;
    });
    document.getElementById('photographyAddSlot')?.addEventListener('click', () => {
        if (photographyModeState.slots.length >= PHOTOGRAPHY_SLOT_COUNT) return;
        photographyModeState.slots.push(createPhotographyModeSlot(photographyModeState.slots.length));
        renderPhotographyModeSlots();
    });
    document.getElementById('photographySubmit')?.addEventListener('click', submitPhotographyMode);
    renderPhotographyModeSlots();
}

function renderPhotographyModeSlots() {
    const list = document.getElementById('photographySlotList');
    if (!list) return;
    list.innerHTML = photographyModeState.slots.map(renderPhotographyModeSlot).join('');
    const count = document.getElementById('photographySlotCount');
    const addButton = document.getElementById('photographyAddSlot');
    if (count) count.textContent = `${photographyModeState.slots.length}/${PHOTOGRAPHY_SLOT_COUNT}`;
    if (addButton) addButton.disabled = photographyModeState.slots.length >= PHOTOGRAPHY_SLOT_COUNT;
}

function renderPhotographyModeSlot(slot, slotIndex) {
    const retouchEnabled = !slot.skipRetouch;
    const cutoutEnabled = slot.cutoutEnabled !== false;
    const example = slot.photographyExampleKey?.key
        ? (() => {
            const imageUrl = sheetSelfImageUrl(slot.photographyExampleKey.key);
            return `<div class="photography-upload${slot.uploading ? ' is-loading' : ''}">
                <button type="button" class="photography-upload-preview" data-photography-preview="${sheetSelfEsc(imageUrl)}" data-preview-label="第 ${slotIndex + 1} 个图片位拍摄案例图" title="点击放大查看"><img src="${sheetSelfEsc(imageUrl)}" alt="拍摄案例图"></button>
                <span class="photography-upload-badge">拍摄案例图</span>
                <button type="button" class="photography-upload-remove" data-photography-remove-image data-slot-index="${slotIndex}" aria-label="移除拍摄案例图" title="移除拍摄案例图">×</button>
            </div>`;
        })()
        : `<div class="photography-upload${slot.uploading ? ' is-loading' : ''}">
            <label class="photography-upload-label" for="photographyExampleInput-${slotIndex}">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></svg>
                <strong>${slot.uploading ? '图片上传中...' : '上传拍摄案例图'}</strong>
                <small>可选，留空则按备注拍摄</small>
            </label>
        </div>`;
    return `<section class="photography-request-slot" data-photography-slot="${slotIndex}">
        <div class="photography-slot-head">
            <div><strong>图片位 ${slotIndex + 1}</strong><small>每个图片位可单独设置处理方式</small></div>
            ${photographyModeState.slots.length > 1 ? `<button type="button" class="photography-slot-remove" data-photography-remove-slot data-slot-index="${slotIndex}" aria-label="删除图片位 ${slotIndex + 1}" title="删除图片位">×</button>` : ''}
        </div>
        <div class="photography-body">
            <section class="photography-assets">
                <div class="photography-section-title">拍摄要求</div>
                <div class="photography-assets-grid photography-assets-grid-single">
                    ${example}
                    <div class="photography-note">
                        <label for="photographyNote-${slotIndex}">拍摄备注 <span>可选</span></label>
                        <textarea id="photographyNote-${slotIndex}" data-photography-note data-slot-index="${slotIndex}" maxlength="300" placeholder="例如：拍摄角度、光线或摆放方式">${sheetSelfEsc(slot.photographyNote)}</textarea>
                    </div>
                </div>
                <input type="file" id="photographyExampleInput-${slotIndex}" data-photography-example-input data-slot-index="${slotIndex}" accept="image/*" hidden>
            </section>
            <aside class="photography-settings">
                <div class="photography-section-title">设置</div>
                <div class="photography-setting-row">
                    <div class="photography-setting-copy"><strong>需要精修</strong><small>${retouchEnabled ? '已开启，自动精修拍摄原图' : '已关闭，为普通白底'}</small></div>
                    <div class="sheet-self-switch-control">
                        <span class="sheet-self-switch-state${retouchEnabled ? '' : ' is-off'}">${retouchEnabled ? '已开启' : '已关闭'}</span>
                        <label class="sheet-self-switch" title="控制此图片位是否需要精修"><input type="checkbox" data-photography-retouch data-slot-index="${slotIndex}" aria-label="图片位 ${slotIndex + 1} 需要精修"${retouchEnabled ? ' checked' : ''}><span></span></label>
                    </div>
                </div>
                <div class="photography-setting-row">
                    <div class="photography-setting-copy"><strong>白底抠图</strong><small>${cutoutEnabled ? '已开启，自动抠成白底图' : '已关闭，保留拍摄背景'}</small></div>
                    <div class="sheet-self-switch-control">
                        <span class="sheet-self-switch-state${cutoutEnabled ? '' : ' is-off'}">${cutoutEnabled ? '已开启' : '已关闭'}</span>
                        <label class="sheet-self-switch" title="控制此图片位是否需要白底抠图"><input type="checkbox" data-photography-cutout data-slot-index="${slotIndex}" aria-label="图片位 ${slotIndex + 1} 白底抠图"${cutoutEnabled ? ' checked' : ''}><span></span></label>
                    </div>
                </div>
            </aside>
        </div>
    </section>`;
}

async function handlePhotographyModeFile(slotIndex, file) {
    const slot = photographyModeState.slots[slotIndex];
    if (!slot || photographyModeState.slots.some(item => item.uploading)) return;
    const status = document.getElementById('photographyStatus');
    const error = validateSheetSelfFile(file);
    if (error) {
        showStudioFieldError(status, error, document.querySelector(`[data-photography-slot="${slotIndex}"] .photography-upload`));
        return;
    }
    slot.uploading = true;
    status.textContent = '正在上传图片...';
    status.className = 'studio-status';
    renderPhotographyModeSlots();
    try {
        const [key] = await uploadImages([{ file, name: file.name }], 'studio/sheet-self');
        slot.photographyExampleKey = key;
        status.textContent = '图片已上传';
        status.className = 'studio-status ok';
    } catch (uploadError) {
        status.textContent = '上传失败：' + uploadError.message;
        status.className = 'studio-status err';
    } finally {
        slot.uploading = false;
        renderPhotographyModeSlots();
    }
}

async function submitPhotographyMode() {
    const status = document.getElementById('photographyStatus');
    const button = document.getElementById('photographySubmit');
    if (!currentUser) { showLoginModal(); return; }
    if (!hasAgreed()) { openGuide(); guideShowPage(2); return; }
    if (button.dataset.loading === '1' || photographyModeState.slots.some(slot => slot.uploading)) return;

    const originalText = button.textContent;
    button.dataset.loading = '1';
    button.disabled = true;
    button.textContent = `正在创建 ${photographyModeState.slots.length} 个图片位...`;
    status.textContent = '正在创建图片拍摄任务...';
    status.className = 'studio-status';
    try {
        const response = await fetch('/api/sheet-self-submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceMode: 'photography',
                submitter: currentUser,
                slots: photographyModeState.slots.map((slot, index) => ({
                    index,
                    photographer: true,
                    skipRetouch: slot.skipRetouch === true,
                    cutoutEnabled: slot.cutoutEnabled !== false,
                    photographyExampleKey: slot.photographyExampleKey,
                    photographyNote: slot.photographyNote,
                    productName: `图片拍摄-${index + 1}`,
                    size: '1600x1600',
                    referenceKey: null,
                    productKeys: []
                }))
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `提交失败 (${response.status})`);
        photographyModeState.slots = [createPhotographyModeSlot(0)];
        renderPhotographyModeSlots();
        status.textContent = '';
        showSuccessModal({ ...result, waitingPhotography: true }, `已提交 ${result.photographerSlots || 1} 个图片位。摄影师补图后会按设置处理，完成后通过钉钉通知。`);
    } catch (error) {
        status.textContent = '提交失败：' + error.message;
        status.className = 'studio-status err';
    } finally {
        button.dataset.loading = '';
        button.disabled = false;
        button.textContent = originalText;
    }
}

function initRetouchMode() {
    wireBatchImageUpload({
        inputId: 'retouchImageInput',
        dropZoneId: 'retouchDropZone',
        selectedId: 'retouchSelected',
        hintId: 'retouchUploadHint',
        statusId: 'retouchStatus',
        uploadKey: 'retouchImages'
    });
    wireBatchImageUpload({
        inputId: 'cutoutImageInput',
        dropZoneId: 'cutoutDropZone',
        selectedId: 'cutoutSelected',
        hintId: 'cutoutUploadHint',
        statusId: 'cutoutStatus',
        uploadKey: 'cutoutImages'
    });
    const cutoutMode = document.getElementById('cutoutMode');
    cutoutMode?.addEventListener('change', syncCutoutModeUi);
    syncCutoutModeUi();
    document.getElementById('retouchSubmit').addEventListener('click', submitRetouch);
    document.getElementById('cutoutSubmit').addEventListener('click', submitCutout);
    loadRetouchQueue();
}

function syncCutoutModeUi() {
    const vectorMode = document.getElementById('cutoutMode')?.value === 'vector';
    const outputSection = document.getElementById('cutoutOutputFormatSection');
    if (outputSection) outputSection.hidden = vectorMode;
}

function wireBatchImageUpload({ inputId, dropZoneId, selectedId, hintId, statusId, uploadKey }) {
    const dropZone = document.getElementById(dropZoneId);
    const selected = document.getElementById(selectedId);
    const actualInput = document.getElementById(inputId);
    if (!actualInput || !dropZone || !selected) return;

    const addFiles = files => {
        const incoming = Array.from(files || []);
        if (!incoming.length) return;
        const remaining = MAX_RETOUCH_IMAGES - uploads[uploadKey].length;
        if (remaining <= 0) {
            showStudioFieldError(document.getElementById(statusId), `最多上传 ${MAX_RETOUCH_IMAGES} 张图片`, dropZone);
            return;
        }

        let added = 0;
        let firstError = '';
        incoming.slice(0, remaining).forEach(file => {
            const validationError = validateStudioImage(file);
            if (validationError) {
                if (!firstError) firstError = validationError;
                return;
            }
            uploads[uploadKey].push({
                batchId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                name: file.name,
                mimeType: file.type || 'image/jpeg',
                file,
                objectUrl: URL.createObjectURL(file)
            });
            added += 1;
        });
        renderBatchImageSelection(uploadKey, selectedId, hintId);
        if (incoming.length > remaining) firstError = `最多上传 ${MAX_RETOUCH_IMAGES} 张，已自动保留前 ${MAX_RETOUCH_IMAGES} 张`;
        const status = document.getElementById(statusId);
        if (firstError) {
            showStudioFieldError(status, firstError, dropZone);
        } else if (added && status) {
            status.textContent = '';
            status.className = 'studio-status';
        }
    };

    actualInput.addEventListener('change', () => {
        addFiles(actualInput.files);
        actualInput.value = '';
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
        addFiles(event.dataTransfer.files);
    });
    selected.addEventListener('click', event => {
        const removeButton = event.target.closest('[data-batch-remove]');
        if (!removeButton) return;
        const batchId = removeButton.dataset.batchRemove;
        const image = uploads[uploadKey].find(item => item.batchId === batchId);
        releaseBatchImage(image);
        uploads[uploadKey] = uploads[uploadKey].filter(item => item.batchId !== batchId);
        renderBatchImageSelection(uploadKey, selectedId, hintId);
    });
    renderBatchImageSelection(uploadKey, selectedId, hintId);
}

function renderBatchImageSelection(uploadKey, selectedId, hintId) {
    const selected = document.getElementById(selectedId);
    const hint = document.getElementById(hintId);
    if (!selected) return;
    const images = uploads[uploadKey] || [];
    selected.replaceChildren();
    images.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'retouch-selected-item';
        const image = document.createElement('img');
        image.src = item.objectUrl || item.dataUrl || '';
        image.alt = item.name || `图片 ${index + 1}`;
        const name = document.createElement('span');
        name.className = 'retouch-selected-name';
        name.textContent = item.name || `图片 ${index + 1}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'retouch-selected-remove';
        remove.dataset.batchRemove = item.batchId;
        remove.title = '移除图片';
        remove.setAttribute('aria-label', `移除 ${name.textContent}`);
        remove.textContent = '×';
        card.append(image, name, remove);
        selected.appendChild(card);
    });
    if (hint) hint.textContent = images.length
        ? `已选择 ${images.length}/${MAX_RETOUCH_IMAGES} 张，单张最大 15 MB`
        : `JPG、PNG、WebP，单张最大 15 MB，最多 ${MAX_RETOUCH_IMAGES} 张`;
}

async function loadRetouchQueue() {
    const list = document.getElementById('retouchQueueList');
    const summary = document.getElementById('retouchQueueSummary');
    if (!list || !summary) return;
    if (!currentUser?.unionId) {
        summary.innerHTML = '';
        list.innerHTML = '<div class="retouch-queue-empty">登录后查看精修队列</div>';
        return;
    }

    try {
        const response = await fetch('/api/studio-tasks?retouchQueue=1&limit=12&format=names-v1');
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || '加载失败');
        renderRetouchQueue(Array.isArray(data.tasks) ? data.tasks : [], list, summary, '暂无精修任务');
    } catch {
        summary.innerHTML = '';
        list.innerHTML = '<div class="retouch-queue-empty">精修队列加载失败，请稍后再试</div>';
    }
}

async function loadResizeQueue() {
    const list = document.getElementById('resizeQueueList');
    const summary = document.getElementById('resizeQueueSummary');
    if (!list || !summary) return;
    if (!currentUser?.unionId) {
        summary.innerHTML = '';
        list.innerHTML = '<div class="retouch-queue-empty">登录后查看尺寸修改队列</div>';
        return;
    }

    try {
        const response = await fetch('/api/studio-tasks?resizeQueue=1&limit=12&format=names-v1');
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || '加载失败');
        renderRetouchQueue(Array.isArray(data.tasks) ? data.tasks : [], list, summary, '暂无尺寸修改任务');
    } catch {
        summary.innerHTML = '';
        list.innerHTML = '<div class="retouch-queue-empty">尺寸修改队列加载失败，请稍后再试</div>';
    }
}

function renderRetouchQueue(tasks, list, summary, emptyText) {
    const activeTasks = tasks.filter(task => task.status === 'pending' || task.status === 'processing');
    const pending = activeTasks.filter(task => task.status === 'pending').length;
    const processing = activeTasks.filter(task => task.status === 'processing').length;
    summary.innerHTML = '<span>待处理 ' + pending + '</span><span>处理中 ' + processing + '</span>';
    list.innerHTML = '';
    if (!activeTasks.length) {
        list.innerHTML = '<div class="retouch-queue-empty">' + emptyText + '</div>';
        return;
    }

    const statusMap = {
        pending: ['待处理', '#b45309', '#fef3c7'],
        processing: ['处理中', '#1d4ed8', '#dbeafe']
    };
    activeTasks.forEach(task => {
        const row = document.createElement('div');
        row.className = 'retouch-queue-row';
        const name = document.createElement('div');
        name.className = 'retouch-queue-name';
        name.textContent = (task.submitterName || '匿名用户') + ' 提交';

        const state = statusMap[task.status] || statusMap.pending;
        const badge = document.createElement('span');
        badge.className = 'retouch-queue-status';
        badge.textContent = state[0];
        badge.style.color = state[1];
        badge.style.background = state[2];
        row.append(name, badge);
        list.appendChild(row);
    });
}

function initVariantMode() {
    const input = document.getElementById('variantInput');
    const drop = document.getElementById('variantDrop');
    const scope = document.getElementById('variantScope');
    const palette = document.getElementById('variantPalette');
    const colorName = document.getElementById('variantColorName');
    const colorPicker = initVariantColorPicker();

    const addFiles = files => {
        const remaining = MAX_VARIANT_IMAGES - uploads.variantImages.length;
        if (remaining <= 0) {
            showStudioUploadError(`变体改色最多上传 ${MAX_VARIANT_IMAGES} 张图片`);
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
        if (files.length > remaining) showStudioUploadError(`最多上传 ${MAX_VARIANT_IMAGES} 张，已自动限制`);
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
    if (count) count.textContent = '(' + n + '/' + MAX_VARIANT_IMAGES + ')';
    if (drop) drop.style.display = n >= MAX_VARIANT_IMAGES ? 'none' : '';
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
    const input = document.getElementById('resizeImageInput');
    const targetGrid = document.getElementById('resizeTargetGrid');
    const dropZone = document.getElementById('resizeDropZone');
    const dropText = document.getElementById('resizeDropText');
    const fileList = document.getElementById('resizeFileList');
    const status = document.getElementById('resizeStatus');
    const downloadBtn = document.getElementById('resizeDownloadBtn');
    const canvas = document.getElementById('resizeCanvas');
    const customSize = document.getElementById('resizeCustomSize');
    const customWidth = document.getElementById('resizeCustomWidth');
    const customHeight = document.getElementById('resizeCustomHeight');
    const reflowInput = document.getElementById('resizeReflow');
    const context = canvas.getContext('2d');
    let currentFile = null;
    let currentImage = null;
    let selectedFiles = [];
    const previewUrls = new Map();
    const MAX_RESIZE_BATCH_FILES = 10;
    resizeToolCleanup = () => previewUrls.forEach(url => URL.revokeObjectURL(url));

    const getPreviewUrl = file => {
        if (!previewUrls.has(file)) previewUrls.set(file, URL.createObjectURL(file));
        return previewUrls.get(file);
    };
    const releasePreviewUrl = file => {
        const url = previewUrls.get(file);
        if (url) URL.revokeObjectURL(url);
        previewUrls.delete(file);
    };
    const readImageFile = file => new Promise((resolve, reject) => {
        const imageUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(imageUrl);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(imageUrl);
            reject(new Error('图片读取失败，请重新选择。'));
        };
        image.src = imageUrl;
    });

    const getTarget = () => {
        if (isAPlusDoubleActive('resize')) {
            return { width: 600, height: 900, custom: false, aPlusDouble: true };
        }
        const active = targetGrid.querySelector('.resize-target-btn.active');
        if (active?.dataset.custom === 'true') {
            return {
                width: Number(customWidth?.value || 0),
                height: Number(customHeight?.value || 0),
                custom: true
            };
        }
        return {
            width: Number(active?.dataset.width || 1464),
            height: Number(active?.dataset.height || 600),
            custom: false
        };
    };
    const isValidTarget = target => Number.isInteger(target.width)
        && Number.isInteger(target.height)
        && target.width >= 100 && target.width <= 5000
        && target.height >= 100 && target.height <= 5000;
    const reset = (message = '等待上传图片') => {
        downloadBtn.disabled = true;
        canvas.style.display = 'none';
        status.className = 'resize-status';
        status.textContent = message;
    };
    const showError = message => {
        reset(message);
        status.className = 'resize-status error';
    };
    const renderSelectedFiles = () => {
        fileList.innerHTML = '';
        selectedFiles.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'resize-file-item';

            const image = document.createElement('img');
            image.src = getPreviewUrl(file);
            image.alt = '';

            const name = document.createElement('div');
            name.className = 'resize-file-name';
            name.title = file.name;
            name.textContent = `${index + 1}. ${file.name}`;

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'resize-file-remove';
            remove.title = '移除图片';
            remove.textContent = '×';
            remove.addEventListener('click', () => {
                if (isAPlusDoubleActive('resize')) {
                    deactivateAPlusDouble('resize');
                    return;
                }
                const removed = selectedFiles.splice(index, 1)[0];
                if (removed) releasePreviewUrl(removed);
                renderSelectedFiles();
                if (selectedFiles.length) loadFile(selectedFiles[0]);
                else {
                    currentFile = null;
                    currentImage = null;
                    reset();
                }
            });

            item.append(image, name, remove);
            fileList.appendChild(item);
        });
    };
    const applyBatchSummary = () => {
        const count = selectedFiles.length;
        if (!count) return;
        if (count > 1) {
            status.textContent = `已选择 ${count} 张图片，点击后会按顺序逐张处理。第一张：${status.textContent}`;
            downloadBtn.textContent = `开始逐张处理 ${count} 张图片`;
        }
    };
    const validateResizeFile = file => {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return '请选择 JPG、PNG 或 WebP 图片。';
        if (file.size > 20 * 1024 * 1024) return `${file.name} 超过单张 20 MB 限制。`;
        return '';
    };
    const addFiles = files => {
        if (isAPlusDoubleActive('resize')) {
            showError('A+ 连续双图请通过上方按钮分别上传上下两张 1464 × 600 图片。');
            return;
        }
        const incoming = Array.from(files || []);
        const remaining = MAX_RESIZE_BATCH_FILES - selectedFiles.length;
        if (remaining <= 0) {
            showError(`最多批量上传 ${MAX_RESIZE_BATCH_FILES} 张图片。`);
            return;
        }

        const accepted = [];
        for (const file of incoming.slice(0, remaining)) {
            const error = validateResizeFile(file);
            if (error) {
                showError(error);
                continue;
            }
            accepted.push(file);
        }
        if (!accepted.length) return;

        selectedFiles.push(...accepted);
        renderSelectedFiles();
        loadFile(selectedFiles[0]);
        if (incoming.length > remaining) {
            status.className = 'resize-status error';
            status.textContent = `最多选择 ${MAX_RESIZE_BATCH_FILES} 张，超出的图片未加入。`;
        }
    };
    const updateTarget = () => {
        const target = getTarget();
        customSize.hidden = !target.custom;
        dropText.textContent = '批量上传需要修改尺寸的图片';
        if (!isValidTarget(target)) {
            reset('请输入 100–5000 px 的自定义宽度和高度');
            return;
        }
        if (currentImage && currentFile) {
            prepareResizeResult(currentFile, currentImage);
            applyBatchSummary();
        }
        else reset();
    };
    const loadFile = async file => {
        reset('正在读取图片...');
        const validationError = validateResizeFile(file);
        if (validationError) {
            showError(validationError);
            return;
        }
        try {
            const image = await readImageFile(file);
            currentFile = file;
            currentImage = image;
            prepareResizeResult(file, image);
            applyBatchSummary();
        } catch (error) {
            showError(error.message || '图片读取失败，请重新选择。');
        }
    };
    const applyResizeAPlusDouble = selection => {
        selectedFiles.forEach(releasePreviewUrl);
        selectedFiles = [];
        currentFile = null;
        currentImage = null;
        if (!selection?.merged?.file) {
            renderSelectedFiles();
            reset();
            return;
        }
        const mergedFile = selection.merged.file;
        mergedFile.isAPlusDouble = true;
        selectedFiles = [mergedFile];
        renderSelectedFiles();
        loadFile(mergedFile);
    };
    resizeAPlusApplyHandler = applyResizeAPlusDouble;
    resizeToolCleanup = () => {
        previewUrls.forEach(url => URL.revokeObjectURL(url));
        if (resizeAPlusApplyHandler === applyResizeAPlusDouble) resizeAPlusApplyHandler = null;
    };
    const prepareResizeResult = (file, image) => {
        const target = getTarget();
        if (!isValidTarget(target)) {
            showError('请输入 100–5000 px 的自定义宽度和高度。');
            return;
        }
        if (!reflowInput.checked && canResizeLocally(image, target)) {
            renderLocalResize(image, target);
            downloadBtn.disabled = false;
            downloadBtn.textContent = `下载 ${target.width} × ${target.height} 图片`;
            status.className = 'resize-status ready';
            status.textContent = `可本地转换：${image.naturalWidth} × ${image.naturalHeight} → ${target.width} × ${target.height}，不消耗 AI`;
            return;
        }
        canvas.style.display = 'none';
        downloadBtn.disabled = false;
        downloadBtn.textContent = `提交后台 AI 修改成 ${target.width} × ${target.height}`;
        status.className = 'resize-status ai';
        status.textContent = reflowInput.checked
            ? `当前图片 ${image.naturalWidth} × ${image.naturalHeight}，AI 将按目标比例重新排版；完成后会钉钉通知你。`
            : `当前图片 ${image.naturalWidth} × ${image.naturalHeight}，将提交后台 AI 处理；完成后会钉钉通知你。`;
    };
    const canResizeLocally = (image, target) => {
        if (image.naturalWidth === target.width && image.naturalHeight === target.height) return true;
        if (target.width === 1464 && target.height === 600) {
            return (image.naturalWidth === 1464 && image.naturalHeight === 600)
                || (image.naturalWidth === 2560 && image.naturalHeight === 1024);
        }
        if (target.width === 1600 && target.height === 1600) {
            return image.naturalWidth === image.naturalHeight;
        }
        return false;
    };
    const renderLocalResize = (image, target) => {
        canvas.width = target.width;
        canvas.height = target.height;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, target.width, target.height);
        const scaledWidth = image.naturalWidth * (target.height / image.naturalHeight);
        const scaledHeight = image.naturalHeight * (target.width / image.naturalWidth);
        if (target.width === target.height && image.naturalWidth === image.naturalHeight) {
            context.drawImage(image, 0, 0, target.width, target.height);
        } else if (scaledWidth >= target.width) {
            context.drawImage(image, (target.width - scaledWidth) / 2, 0, scaledWidth, target.height);
        } else {
            context.drawImage(image, 0, (target.height - scaledHeight) / 2, target.width, scaledHeight);
        }
        canvas.style.display = 'none';
    };
    const downloadLocalResult = (file, image, target) => new Promise((resolve, reject) => {
        renderLocalResize(image, target);
        const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'aplus-image';
        canvas.toBlob(blob => {
            if (!blob) {
                reject(new Error(`${file.name} 转换失败。`));
                return;
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${baseName}-${target.width}x${target.height}.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            resolve();
        }, type, 0.95);
    });

    targetGrid.querySelectorAll('.resize-target-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            targetGrid.querySelectorAll('.resize-target-btn').forEach(item => item.classList.remove('active'));
            btn.classList.add('active');
            updateTarget();
        });
    });
    [customWidth, customHeight].forEach(field => field?.addEventListener('input', updateTarget));
    reflowInput.addEventListener('change', updateTarget);
    input.addEventListener('change', () => {
        if (input.files.length) addFiles(input.files);
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
        if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
    });
    downloadBtn.addEventListener('click', async () => {
        if (!selectedFiles.length || downloadBtn.dataset.loading === '1') return;
        const target = getTarget();
        if (!isValidTarget(target)) {
            showError('请输入 100–5000 px 的自定义宽度和高度。');
            return;
        }

        downloadBtn.dataset.loading = '1';
        downloadBtn.disabled = true;
        const originalFiles = [...selectedFiles];
        const prepared = [];
        try {
            status.className = 'resize-status ai';
            status.textContent = `正在读取 1/${originalFiles.length} 张图片...`;
            for (let index = 0; index < originalFiles.length; index++) {
                status.textContent = `正在读取 ${index + 1}/${originalFiles.length} 张图片...`;
                prepared.push({ file: originalFiles[index], image: await readImageFile(originalFiles[index]) });
            }

            const aPlusDouble = isAPlusDoubleActive('resize');
            const hasAiTasks = aPlusDouble || prepared.some(item => reflowInput.checked || !canResizeLocally(item.image, target));
            if (hasAiTasks && !currentUser) {
                showLoginModal();
                return;
            }
            if (hasAiTasks && !hasAgreed()) {
                openGuide();
                guideShowPage(2);
                return;
            }

            let localCount = 0;
            let aiCount = 0;
            const failedFiles = [];
            for (let index = 0; index < prepared.length; index++) {
                const item = prepared[index];
                status.textContent = `正在处理 ${index + 1}/${prepared.length}：${item.file.name}`;
                try {
                    const useLocal = !aPlusDouble && !reflowInput.checked && canResizeLocally(item.image, target);
                    if (useLocal) {
                        await downloadLocalResult(item.file, item.image, target);
                        localCount++;
                        await new Promise(resolve => setTimeout(resolve, 300));
                    } else {
                        await submitResizeAiTask(item.file, target, aPlusDouble ? false : reflowInput.checked, aPlusDouble);
                        aiCount++;
                    }
                } catch (error) {
                    failedFiles.push(item.file);
                    console.error('Resize batch item failed:', item.file.name, error);
                }
            }

            originalFiles.forEach(file => {
                if (!failedFiles.includes(file)) releasePreviewUrl(file);
            });
            selectedFiles = failedFiles;
            renderSelectedFiles();
            currentFile = null;
            currentImage = null;

            if (failedFiles.length) {
                status.className = 'resize-status error';
                status.textContent = `已完成 ${localCount + aiCount} 张，${failedFiles.length} 张失败并保留在列表中，可再次处理。`;
                loadFile(failedFiles[0]);
            } else {
                reset(`已按顺序处理 ${localCount + aiCount} 张图片。`);
                status.className = 'resize-status ready';
            }
            if (aiCount) {
                const successText = aPlusDouble
                    ? 'A+ 连续双图已加入队列，后台会处理为 600 × 900，并在完成后通过钉钉发送上下两张 600 × 450 图片。'
                    : `${aiCount} 个尺寸修改任务已按顺序加入队列，后台会逐张处理，完成后通过钉钉通知`;
                showSuccessModal(null, successText);
                loadResizeQueue();
            }
        } catch (error) {
            status.className = 'resize-status error';
            status.textContent = error.message || '批量处理失败，请重试。';
        } finally {
            downloadBtn.dataset.loading = '';
            if (!selectedFiles.length) {
                downloadBtn.disabled = true;
                downloadBtn.textContent = '上传图片后继续';
            } else {
                downloadBtn.disabled = false;
                applyBatchSummary();
            }
        }
    });
    updateAPlusDoubleUi('resize');
    updateTarget();
    loadResizeQueue();
}

function fileToStudioUpload(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve({
            name: file.name,
            mimeType: file.type || 'image/png',
            base64: String(event.target.result || '').split(',')[1] || '',
            dataUrl: event.target.result
        });
        reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
        reader.readAsDataURL(file);
    });
}

async function submitResizeAiTask(file, target, resizeReflow, aPlusDouble = false) {
    const upload = await fileToStudioUpload(file);
    const refKeys = await uploadImages([upload], 'studio/resize');
    const size = `${target.width}x${target.height}`;
    const response = await fetch('/api/studio-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            mode: 'resize_ai',
            submitter: currentUser,
            productKeys: [],
            modelKeys: [],
            refKeys,
            desc: `${aPlusDouble ? 'A+ 连续双图尺寸修改，合并图会在完成后自动拆成上下两张。' : 'AI 尺寸修改为 ' + size}${resizeReflow ? '，允许重新排版' : ''}`,
            size,
            resizeTarget: size,
            resizeReflow,
            aPlusDouble,
            imageName: file.name.replace(/\.[^.]+$/, '')
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
        throw new Error('提交失败：' + (result.error || response.status));
    }
    return result;
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
    const hasRemaining = remaining !== null && remaining !== undefined && remaining !== '' && Number.isFinite(Number(remaining));
    promptQuotaRemaining.optimize = hasRemaining ? Number(remaining) : null;
    const button = document.getElementById('optimizePromptBtn');
    if (button && hasRemaining && Number(remaining) <= 0) {
        button.disabled = true;
        button.title = 'AI 美化暂时不可用，请稍后再试';
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
    const pinned = list.filter(item => item && item.pinned);
    const arr = list.filter(item => !item || !item.pinned);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return pinned.concat(arr);
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
            if (bucket === 'progProduct') queueProgramProductRecognition();
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
    if (bucket === 'progRef' || bucket === 'progProduct') updateProgramAiControls();
}

function wireProgramAiTools() {
    const productInput = document.getElementById('progProductName');
    const identifyButton = document.getElementById('progIdentifyProductBtn');
    const copyButton = document.getElementById('progGenerateCopyBtn');
    if (!productInput || !identifyButton || !copyButton) return;

    productInput.addEventListener('input', () => {
        productInput.dataset.aiGenerated = 'false';
        if (uploads.progProduct.length) {
            setProgramAiStatus(document.getElementById('progProductAiStatus'), '已保留手动填写，可点击“AI 识别产品”覆盖', '');
        }
    });
    identifyButton.addEventListener('click', () => runProgramProductRecognition(true));
    copyButton.addEventListener('click', runProgramCopyGeneration);
    updateProgramAiControls();
}

function updateProgramAiControls() {
    if (currentMode !== 'program') return;
    const identifyButton = document.getElementById('progIdentifyProductBtn');
    const copyButton = document.getElementById('progGenerateCopyBtn');
    const productStatus = document.getElementById('progProductAiStatus');
    const copyStatus = document.getElementById('progCopyAiStatus');
    if (identifyButton) identifyButton.disabled = programProductAiBusy || uploads.progProduct.length === 0;
    if (copyButton) copyButton.disabled = programCopyAiBusy;

    if (productStatus && !programProductAiBusy && uploads.progProduct.length === 0) {
        setProgramAiStatus(productStatus, '上传白底产品图后自动识别', '');
    }
    if (copyStatus && !programCopyAiBusy) {
        if (copyStatus.dataset.state === 'prerequisite' || uploads.progRef.length !== 1) {
            copyStatus.hidden = true;
            copyStatus.textContent = '';
            copyStatus.dataset.state = '';
        }
    }
}

function queueProgramProductRecognition() {
    clearTimeout(programProductAiTimer);
    if (currentMode !== 'program' || !uploads.progProduct.length) return;
    programProductAiTimer = setTimeout(() => runProgramProductRecognition(false), 250);
}

async function runProgramProductRecognition(force) {
    const image = uploads.progProduct[0];
    const input = document.getElementById('progProductName');
    const button = document.getElementById('progIdentifyProductBtn');
    const status = document.getElementById('progProductAiStatus');
    if (!image || !input || !button || !status || programProductAiBusy) return;
    if (!force && input.value.trim() && input.dataset.aiGenerated !== 'true') {
        setProgramAiStatus(status, '已保留手动填写，可点击“AI 识别产品”覆盖', '');
        return;
    }

    const baseline = input.value;
    const requestId = ++programProductAiRequestId;
    programProductAiBusy = true;
    button.classList.add('loading');
    button.querySelector('span').textContent = '正在识别...';
    setProgramAiStatus(status, '正在分析白底产品图...', '');
    updateProgramAiControls();
    try {
        const data = await callProgramAi({ action: 'identify_product', image });
        if (requestId !== programProductAiRequestId || currentMode !== 'program') return;
        if (!force && input.value !== baseline && input.dataset.aiGenerated !== 'true') {
            setProgramAiStatus(status, '已保留手动填写，可点击“AI 识别产品”覆盖', '');
            return;
        }
        input.value = data.productName;
        input.dataset.aiGenerated = 'true';
        setProgramAiStatus(status, `已识别：${data.productName}`, 'success');
    } catch (error) {
        if (requestId === programProductAiRequestId) setProgramAiStatus(status, error.message || 'AI 识别失败，请重试', 'error');
    } finally {
        if (requestId === programProductAiRequestId) {
            programProductAiBusy = false;
            button.classList.remove('loading');
            button.querySelector('span').textContent = 'AI 识别产品';
            updateProgramAiControls();
        }
    }
}

async function runProgramCopyGeneration() {
    const image = uploads.progRef[0];
    const button = document.getElementById('progGenerateCopyBtn');
    const status = document.getElementById('progCopyAiStatus');
    if (!button || !status || programCopyAiBusy) return;
    clearTimeout(programCopyAiStatusTimer);
    if (!image) {
        setProgramAiStatus(status, '请先上传竞品图片', 'error');
        programCopyAiStatusTimer = setTimeout(() => { status.hidden = true; }, 2600);
        return;
    }

    programCopyAiBusy = true;
    button.classList.add('loading');
    button.querySelector('span').textContent = '正在优化...';
    setProgramAiStatus(status, '正在分析参考图...', '');
    updateProgramAiControls();
    try {
        const data = await callProgramAi({
            action: 'generate_copy',
            image,
            productName: document.getElementById('progProductName')?.value.trim() || ''
        });
        document.getElementById('progTitle').value = data.title || '';
        document.getElementById('progSubtitle').value = data.subtitle || '';
        document.getElementById('progOtherText').value = data.otherText || '';
        setProgramAiStatus(status, '标题和文案已生成', 'success');
    } catch (error) {
        setProgramAiStatus(status, error.message || 'AI 文案生成失败，请重试', 'error');
    } finally {
        programCopyAiBusy = false;
        button.classList.remove('loading');
        button.querySelector('span').textContent = 'AI 优化';
        updateProgramAiControls();
    }
}

async function callProgramAi(payload) {
    const requestBody = { ...payload, userId: currentUser?.unionId || '' };
    if (payload.image) {
        requestBody.image = { base64: payload.image.base64, mimeType: payload.image.mimeType };
    }
    const response = await fetch('/api/program-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'AI 请求失败，请稍后重试');
    return data;
}

function setProgramAiStatus(element, text, state) {
    if (!element) return;
    const isPopover = element.classList.contains('program-ai-popover');
    element.textContent = text;
    element.className = 'program-ai-status' + (isPopover ? ' program-ai-popover' : '') + (state ? ' ' + state : '');
    element.dataset.state = state || (text.startsWith('请先') ? 'prerequisite' : 'info');
    if (isPopover) element.hidden = !text;
}

function updateCharCount(el, countId, max) {
    const n = el.value.length;
    const el2 = document.getElementById(countId);
    if (el2) el2.textContent = n;
    el.style.borderColor = n > max * 0.9 ? (n >= max ? '#ef4444' : '#f59e0b') : '';
}

const STUDIO_UPLOAD_MAX_ATTEMPTS = 3;

function waitForStudioUploadRetry(delayMs) {
    return new Promise(resolve => setTimeout(resolve, delayMs));
}

function makeStudioUploadError(message, retryable, status = 0) {
    const error = new Error(message);
    error.retryable = retryable;
    error.status = status;
    return error;
}

function uploadStudioImageOnce({ blob, name, prefix, uploadId, onProgress }) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', blob, name);
        formData.append('prefix', prefix);
        formData.append('uploadId', uploadId);

        const request = new XMLHttpRequest();
        request.open('POST', '/api/studio-upload');
        request.timeout = 120000;
        request.upload.onprogress = event => {
            if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
        };
        request.onload = () => {
            let result = {};
            try { result = JSON.parse(request.responseText || '{}'); } catch {}
            if (request.status >= 200 && request.status < 300 && result.ok) {
                if (onProgress) onProgress(1);
                resolve(result);
                return;
            }
            const retryable = request.status === 408 || request.status === 425 || request.status === 429 || request.status >= 500;
            const fallback = request.status === 413
                ? '图片超过允许大小'
                : `上传服务返回错误 (${request.status || '未知'})`;
            reject(makeStudioUploadError(result.error || fallback, retryable, request.status));
        };
        request.onerror = () => reject(makeStudioUploadError('网络连接中断', true));
        request.ontimeout = () => reject(makeStudioUploadError('上传超时', true, 408));
        request.onabort = () => reject(makeStudioUploadError('上传已取消', false));
        request.send(formData);
    });
}

async function uploadStudioImageWithRetry(options) {
    let lastError;
    for (let attempt = 1; attempt <= STUDIO_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
        try {
            return await uploadStudioImageOnce(options);
        } catch (error) {
            lastError = error;
            if (!error.retryable || attempt >= STUDIO_UPLOAD_MAX_ATTEMPTS) break;
            options.onRetry?.({
                attempt: attempt + 1,
                maxAttempts: STUDIO_UPLOAD_MAX_ATTEMPTS,
                error
            });
            await waitForStudioUploadRetry(700 * attempt);
        }
    }
    if (lastError?.retryable) {
        throw new Error(`${lastError.message}，自动重试 ${STUDIO_UPLOAD_MAX_ATTEMPTS} 次仍未成功`);
    }
    throw lastError || new Error('图片上传失败');
}

async function uploadImages(files, prefix, options = {}) {
    const keys = [];
    for (let index = 0; index < files.length; index += 1) {
        const f = files[index];
        const blob = f.file || await fetch('data:' + f.mimeType + ';base64,' + f.base64).then(r => r.blob());
        const uploadId = f.uploadId || f.batchId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        f.uploadId = uploadId;
        const json = await uploadStudioImageWithRetry({
            blob,
            name: f.name || `image-${index + 1}.jpg`,
            prefix,
            uploadId,
            onProgress: ratio => options.onProgress?.({ index, total: files.length, ratio }),
            onRetry: retry => options.onRetry?.({ index, total: files.length, ...retry })
        });
        keys.push({ key: json.key, name: json.name });
    }
    return keys;
}

async function submitStudioTaskWithRetry(payload, onRetry) {
    let lastError;
    for (let attempt = 1; attempt <= STUDIO_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
            let response;
            try {
                response = await fetch('/api/studio-submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeout);
            }
            const result = await response.json().catch(() => ({}));
            if (response.ok && result.ok) return result;
            const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
            throw makeStudioUploadError(result.error || `创建任务失败 (${response.status})`, retryable, response.status);
        } catch (error) {
            const normalized = error?.name === 'AbortError'
                ? makeStudioUploadError('创建任务超时', true, 408)
                : error instanceof TypeError
                    ? makeStudioUploadError('网络连接中断', true)
                    : error;
            lastError = normalized;
            if (!normalized?.retryable || attempt >= STUDIO_UPLOAD_MAX_ATTEMPTS) break;
            onRetry?.({ attempt: attempt + 1, maxAttempts: STUDIO_UPLOAD_MAX_ATTEMPTS, error: normalized });
            await waitForStudioUploadRetry(700 * attempt);
        }
    }
    if (lastError?.retryable) {
        throw new Error(`${lastError.message}，自动重试 ${STUDIO_UPLOAD_MAX_ATTEMPTS} 次仍未成功`);
    }
    throw lastError || new Error('创建任务失败');
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
        const refPrefix = mode === 'retouch' ? 'studio/retouch' : mode === 'cutout' ? 'studio/cutout' : mode === 'variant' ? 'studio/variant' : mode === 'resize_ai' ? 'studio/resize' : 'studio/ref';
        const uploadedRefKeys = payload.refImages && payload.refImages.length ? await uploadImages(payload.refImages, refPrefix) : [];
        const refKeys = uploadedRefKeys;
        const modelKeys = payload.modelImages && payload.modelImages.length ? await uploadImages(payload.modelImages, 'studio/model') : [];
        const photographyExampleKeys = payload.photographyExampleImage
            ? await uploadImages([payload.photographyExampleImage], 'studio/photography-brief')
            : [];

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
        if (payload.resizeTarget) submitPayload.resizeTarget = payload.resizeTarget;
        if (payload.resizeReflow !== undefined) submitPayload.resizeReflow = payload.resizeReflow === true;
        if (payload.cutoutOutputFormat) submitPayload.cutoutOutputFormat = payload.cutoutOutputFormat;
        if (payload.cutoutMode) submitPayload.cutoutMode = payload.cutoutMode;
        if (payload.aPlusDouble !== undefined) submitPayload.aPlusDouble = payload.aPlusDouble === true;
        if (payload.photographerDecision !== undefined) submitPayload.photographerDecision = payload.photographerDecision === true;
        if (payload.photographyNote !== undefined) submitPayload.photographyNote = payload.photographyNote;
        if (photographyExampleKeys.length) submitPayload.photographyExampleKey = photographyExampleKeys[0];

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
    if (uploads.freeImages[i]?.isAPlusDouble && isAPlusDoubleActive('free')) {
        deactivateAPlusDouble('free');
        return;
    }
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
        + '<span style="font-size:1rem;font-weight:700;color:#111827">' + (purpose === 'model' ? '选择模特' : purpose === 'scene' ? '选择场景' : purpose === 'sheet' ? '从资料库选择图片' : '白底素材库') + '</span>'
        + '<button id="libPickerClose" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#9ca3af">×</button>'
        + '</div><div style="font-size:0.8rem;color:#6366f1;margin-bottom:12px">' + (purpose === 'model' ? '点击图片选择为模特参考图' : purpose === 'scene' ? '点击图片选择为场景参考图' : purpose === 'sheet' ? '进入产品分类，点击一张图片导入当前图片位' : '点击图片加入，最多4张') + '</div>'
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
    const isSheetPicker = modal.dataset.purpose === 'sheet';
    const visibleCategories = Object.fromEntries(Object.entries(categories).filter(([cat, products]) => {
        if (isModelPicker) return cat === '模特';
        if (modal.dataset.purpose === 'scene') return cat !== '模特';
        if (isSheetPicker) {
            return cat !== '模特'
                && cat !== '说明书'
                && Object.values(products || {}).some(files => files.some(isLibraryImageFile));
        }
        return cat !== '模特';
    }));
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
        const prodCount = Object.values(products).filter(files => !isSheetPicker || files.some(isLibraryImageFile)).length;
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
    const isSheetPicker = modal.dataset.purpose === 'sheet';
    const visibleProducts = Object.entries(products).filter(([, files]) => !isSheetPicker || files.some(isLibraryImageFile));
    body.innerHTML = '';
    body.appendChild(libPickerBreadcrumb([cat], () => renderLibPickerCategories(categories, body, modal)));
    if (!visibleProducts.length) {
        body.insertAdjacentHTML('beforeend', '<p style="color:#9ca3af;font-size:0.85rem">此分类暂无产品图片</p>');
        return;
    }
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px';
    for (const [prod, files] of visibleProducts) {
        const imageFiles = files.filter(isLibraryImageFile);
        const cover = files.find(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f.name)) || files[0];
        const card = document.createElement('div');
        card.style.cssText = 'cursor:pointer;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;transition:border-color 0.15s';
        card.innerHTML = (cover ? '<img src="/api/library-file/' + encodeURIComponent(cover.key) + '" style="width:100%;aspect-ratio:1.3;object-fit:cover;display:block" loading="lazy">' : '<div style="aspect-ratio:1.3;background:#f3f4f6"></div>')
            + '<div style="padding:8px 10px"><div style="font-size:0.86rem;font-weight:700;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + prod + '</div><div style="font-size:0.74rem;color:#9ca3af;margin-top:2px">' + (isSheetPicker ? imageFiles.length : files.length) + ' 张</div></div>';
        card.onmouseover = () => card.style.borderColor = '#111827';
        card.onmouseout = () => card.style.borderColor = '#e5e7eb';
        card.onclick = () => renderLibPickerImages(categories, cat, prod, body, modal);
        grid.appendChild(card);
    }
    body.appendChild(grid);
}

function renderLibPickerImages(categories, cat, prod, body, modal) {
    const isSheetPicker = modal.dataset.purpose === 'sheet';
    const files = ((categories[cat] && categories[cat][prod]) || []).filter(file => !isSheetPicker || isLibraryImageFile(file));
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
            if (isSheetPicker) {
                await importSheetLibraryFile(f, modal);
                return;
            }
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

function isLibraryImageFile(file) {
    return /\.(png|jpg|jpeg|webp|gif)$/i.test(String(file?.name || ''));
}

async function importSheetLibraryFile(libraryFile, modal) {
    const target = sheetLibraryTarget;
    const slot = Number.isInteger(target?.slotIndex) ? sheetSelfState.slots[target.slotIndex] : null;
    if (!slot || !['reference', 'product'].includes(target?.type) || slot.uploading) return;
    if (target.type === 'product' && slot.productKeys.length >= 2) {
        slot.status = '白底产品图最多上传两张';
        renderSheetSelfGrid();
        modal.remove();
        sheetLibraryTarget = null;
        return;
    }

    slot.uploading = true;
    slot.status = '正在从资料库导入图片...';
    renderSheetSelfGrid();
    let shouldIdentifyProduct = false;
    try {
        const response = await fetch('/api/library-file/' + encodeURIComponent(libraryFile.key));
        if (!response.ok) throw new Error(`读取资料库图片失败 (${response.status})`);
        const blob = await response.blob();
        const extension = String(libraryFile.name || '').split('.').pop().toLowerCase();
        const inferredMime = extension === 'jpg' || extension === 'jpeg'
            ? 'image/jpeg'
            : extension === 'webp'
                ? 'image/webp'
                : extension === 'gif'
                    ? 'image/gif'
                    : 'image/png';
        const file = new File([blob], libraryFile.name || `资料库图片.${extension || 'png'}`, {
            type: blob.type.startsWith('image/') ? blob.type : inferredMime
        });
        const invalid = validateSheetSelfFile(file);
        if (invalid) throw new Error(invalid);

        const [uploaded] = await uploadImages([{ file, name: file.name }], 'studio/sheet-self');
        if (target.type === 'reference') {
            slot.referenceKey = uploaded;
            resetSheetSelfCopyAiState(slot);
        }
        else {
            slot.productKeys = [...slot.productKeys, uploaded].slice(0, 2);
            shouldIdentifyProduct = true;
        }
        slot.status = '已从资料库导入并保存';
        persistSheetSelfDraft(300);
        modal.remove();
        sheetLibraryTarget = null;
    } catch (error) {
        slot.status = '失败：' + error.message;
        alert('选取失败：' + error.message);
    } finally {
        slot.uploading = false;
        renderSheetSelfGrid();
        updateSheetSelfProductAiControls();
    }
    if (shouldIdentifyProduct) queueSheetSelfProductRecognition();
}

function showSuccessModal(task, estimateText = '') {
    const queueText = estimateText || formatStudioQueueInfo(task?.queueInfo);
    const waitingPhotography = task?.waitingPhotography === true;
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
        + '<div style="font-size:0.88rem;color:#6b7280;line-height:1.7">' + (waitingPhotography
            ? '网站已收到你的任务，并已提醒摄影师拍照。<br>摄影师补图后会自动开始作图，完成后通过钉钉通知。'
            : '网站已收到你的任务并进入处理队列。<br>可在「我的任务」查看进度，完成后会通过钉钉通知。') + '</div>'
        + (queueText ? '<div style="margin-top:12px;padding:9px 12px;border-radius:7px;background:#eff6ff;color:#1d4ed8;font-size:.84rem;font-weight:700">' + queueText + '</div>' : '')
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

function formatStudioQueueInfo(queueInfo) {
    if (!queueInfo || !Number.isFinite(Number(queueInfo.completionMinutes))) return '';
    const aheadCount = Math.max(0, Number(queueInfo.aheadCount) || 0);
    const waitMinutes = Math.max(0, Number(queueInfo.waitMinutes) || 0);
    const ownMinutes = Math.max(1, Number(queueInfo.ownMinutes) || 1);
    const completionMinutes = Math.max(ownMinutes, Number(queueInfo.completionMinutes) || ownMinutes);
    if (aheadCount > 0) {
        return `前面还有 ${aheadCount} 个任务，预计约 ${waitMinutes} 分钟后开始处理；本任务通常需要 ${ownMinutes} 分钟，预计约 ${completionMinutes} 分钟完成。`;
    }
    return `当前前面没有其他任务；本任务通常需要 ${ownMinutes} 分钟，预计约 ${completionMinutes} 分钟完成。`;
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
    const aPlusDouble = isAPlusDoubleActive('free');
    const desc = sanitizePrompt(document.getElementById('freeDesc').value.trim());
    const want = '';
    const scene = uploads.freeScene ? uploads.freeScene.name : '';
    const sizeEl = document.getElementById('freeSizeSelect');
    const size = aPlusDouble ? A_PLUS_DOUBLE_SIZE : (sizeEl ? sizeEl.value : '');
    const imageNameEl = document.getElementById('freeFileName');
    const imageName = aPlusDouble ? '' : (imageNameEl ? imageNameEl.value.trim() : '');
    const status = document.getElementById('freeStatus');
    const photographerDecision = inlineShootRequestState.free.enabled === true;
    const photographyNote = document.getElementById('freePhotographerNote')?.value.trim() || '';
    if (!desc) { showStudioFieldError(status, '请填写提示词', document.getElementById('freeDesc')); return; }
    if (!size) { showStudioFieldError(status, '请选择或填写尺寸', document.getElementById('freeSizeSelectPicker')); return; }
    if (aPlusDouble && !uploads.freeImages.some(item => item?.isAPlusDouble)) { showStudioFieldError(status, '请重新上传 A+ 连续双图', document.getElementById('freeAPlusDoubleBtn')); return; }
    submitTask('free', { desc, want, note: scene ? ('场景：' + scene) : '', scene, size, imageName, aPlusDouble, photographerDecision, photographyNote, photographyExampleImage: inlineShootRequestState.free.image, refImages: [...(uploads.freeScene ? [uploads.freeScene] : []), ...(uploads.freeImages || [])], modelImages: uploads.freeModel ? [uploads.freeModel] : [], productImages: uploads.freeProduct || [] }, status, document.getElementById('freeSubmit'), showSuccessModal);
}

function submitProgram() {
    const aPlusDouble = isAPlusDoubleActive('program');
    const productName = document.getElementById('progProductName').value.trim();
    const title = document.getElementById('progTitle')?.value.trim() || '';
    const subtitle = document.getElementById('progSubtitle')?.value.trim() || '';
    const otherText = document.getElementById('progOtherText')?.value.trim() || '';
    const sizeEl = document.getElementById('progSizeSelect');
    const size = aPlusDouble ? A_PLUS_DOUBLE_SIZE : (sizeEl ? sizeEl.value : '');
    const status = document.getElementById('progStatus');
    const photographerDecision = inlineShootRequestState.program.enabled === true;
    const photographyNote = document.getElementById('programPhotographerNote')?.value.trim() || '';
    if (!productName) { showStudioFieldError(status, '请填写产品名称', document.getElementById('progProductName')); return; }
    if (!size) { showStudioFieldError(status, '请选择或填写尺寸', document.getElementById('progSizeSelectPicker')); return; }
    if (uploads.progRef.length !== 1) { showStudioFieldError(status, '请上传1张竞品图片', document.getElementById('progRefDrop')); return; }
    if (!photographerDecision && uploads.progProduct.length !== 2) { showStudioFieldError(status, '请上传2张白底产品图（当前' + uploads.progProduct.length + '张）', document.getElementById('progProductDrop')); return; }
    submitTask('program', { productName, title, subtitle, otherText, size, aPlusDouble, analyzePrompt: ANALYZE_PROMPT, photographerDecision, photographyNote, photographyExampleImage: inlineShootRequestState.program.image, refImages: uploads.progRef, productImages: photographerDecision ? [] : uploads.progProduct }, status, document.getElementById('progSubmit'), showSuccessModal);
}

function submitRetouch() {
    const status = document.getElementById('retouchStatus');
    if (!uploads.retouchImages.length) {
        showStudioFieldError(status, '请上传待精修图片', document.getElementById('retouchDropZone'));
        return;
    }
    submitImageBatch({
        mode: 'retouch',
        uploadKey: 'retouchImages',
        inputId: 'retouchImageInput',
        selectedId: 'retouchSelected',
        hintId: 'retouchUploadHint',
        status,
        btn: document.getElementById('retouchSubmit')
    });
}

function submitCutout() {
    const status = document.getElementById('cutoutStatus');
    const cutoutMode = document.getElementById('cutoutMode')?.value === 'vector' ? 'vector' : 'normal';
    const cutoutOutputFormat = cutoutMode === 'vector'
        ? 'png'
        : (document.getElementById('cutoutOutputFormat')?.value === 'jpg' ? 'jpg' : 'png');
    if (!uploads.cutoutImages.length) {
        showStudioFieldError(status, '请上传待处理图片', document.getElementById('cutoutDropZone'));
        return;
    }
    submitImageBatch({
        mode: 'cutout',
        uploadKey: 'cutoutImages',
        inputId: 'cutoutImageInput',
        selectedId: 'cutoutSelected',
        hintId: 'cutoutUploadHint',
        status,
        btn: document.getElementById('cutoutSubmit'),
        extraPayload: { cutoutMode, cutoutOutputFormat }
    });
}

function escapeBatchProgressText(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function renderBatchSubmissionProgress(status, state) {
    const total = Math.max(1, Number(state.total) || 1);
    const completed = Math.max(0, Number(state.completed) || 0);
    const failed = Math.max(0, Number(state.failed) || 0);
    const percent = Math.max(0, Math.min(100, Math.round(Number(state.percent) || 0)));
    const current = Math.max(1, Math.min(total, Number(state.current) || 1));
    const phase = state.phase || 'uploading';
    const phaseText = phase === 'creating'
        ? `第 ${current}/${total} 张 · 正在创建任务`
        : phase === 'retrying'
            ? `第 ${current}/${total} 张 · 正在自动重试`
            : phase === 'success'
                ? `提交完成 · ${completed}/${total} 张`
                : phase === 'error'
                    ? `提交结束 · 成功 ${completed} 张，失败 ${failed} 张`
                    : `第 ${current}/${total} 张 · 正在上传`;
    const detail = state.detail || state.fileName || '';
    const stateClass = phase === 'retrying'
        ? ' is-retrying'
        : phase === 'success'
            ? ' is-success'
            : phase === 'error'
                ? ' is-error'
                : '';
    const countText = failed
        ? `已完成 ${completed} · 失败 ${failed}`
        : `已完成 ${completed}/${total}`;

    status.className = `studio-status batch-submit-progress${stateClass}`;
    status.innerHTML = `
        <div class="batch-submit-progress-head">
            <strong>${escapeBatchProgressText(phaseText)}</strong>
            <span>${percent}%</span>
        </div>
        <div class="batch-submit-progress-track" role="progressbar" aria-label="批量提交进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
            <span class="batch-submit-progress-bar" style="width:${percent}%"></span>
        </div>
        <div class="batch-submit-progress-meta">
            <span>${escapeBatchProgressText(detail)}</span>
            <span>${escapeBatchProgressText(countText)}</span>
        </div>`;
}

async function submitImageBatch({ mode, uploadKey, inputId, selectedId, hintId, status, btn, extraPayload = {} }) {
    if (!currentUser) { showLoginModal(); return; }
    if (!hasAgreed()) { openGuide(); guideShowPage(2); return; }
    if (btn.dataset.loading === '1') return;

    const batch = uploads[uploadKey].slice();
    const successfulIds = new Set();
    const failures = [];
    const submittedTasks = [];
    const originalText = btn.textContent;
    const input = document.getElementById(inputId);
    const prefix = mode === 'retouch' ? 'studio/retouch' : 'studio/cutout';
    btn.dataset.loading = '1';
    btn.disabled = true;
    btn.classList.add('is-loading');
    if (input) input.disabled = true;
    status.className = 'studio-status';

    try {
        for (let index = 0; index < batch.length; index += 1) {
            const item = batch[index];
            btn.textContent = `提交中 ${index + 1}/${batch.length}`;
            renderBatchSubmissionProgress(status, {
                phase: 'uploading',
                current: index + 1,
                total: batch.length,
                completed: submittedTasks.length,
                failed: failures.length,
                percent: (index / batch.length) * 100,
                fileName: item.name
            });
            try {
                const refKeys = await uploadImages([item], prefix, {
                    onProgress: ({ ratio }) => renderBatchSubmissionProgress(status, {
                        phase: 'uploading',
                        current: index + 1,
                        total: batch.length,
                        completed: submittedTasks.length,
                        failed: failures.length,
                        percent: ((index + ratio * 0.82) / batch.length) * 100,
                        fileName: item.name
                    }),
                    onRetry: ({ attempt, maxAttempts, error }) => renderBatchSubmissionProgress(status, {
                        phase: 'retrying',
                        current: index + 1,
                        total: batch.length,
                        completed: submittedTasks.length,
                        failed: failures.length,
                        percent: ((index + 0.08) / batch.length) * 100,
                        detail: `${error.message}，正在进行第 ${attempt}/${maxAttempts} 次上传`
                    })
                });
                renderBatchSubmissionProgress(status, {
                    phase: 'creating',
                    current: index + 1,
                    total: batch.length,
                    completed: submittedTasks.length,
                    failed: failures.length,
                    percent: ((index + 0.88) / batch.length) * 100,
                    fileName: item.name
                });
                const result = await submitStudioTaskWithRetry({
                    mode,
                    submitter: currentUser,
                    productKeys: [],
                    refKeys,
                    modelKeys: [],
                    clientRequestId: item.batchId,
                    ...extraPayload
                }, ({ attempt, maxAttempts, error }) => {
                    renderBatchSubmissionProgress(status, {
                        phase: 'retrying',
                        current: index + 1,
                        total: batch.length,
                        completed: submittedTasks.length,
                        failed: failures.length,
                        percent: ((index + 0.92) / batch.length) * 100,
                        detail: `${error.message}，正在进行第 ${attempt}/${maxAttempts} 次任务确认`
                    });
                });
                successfulIds.add(item.batchId);
                submittedTasks.push(result);
            } catch (error) {
                failures.push({ item, error: error.message || String(error) });
            }
            const itemFailed = failures.some(failure => failure.item.batchId === item.batchId);
            renderBatchSubmissionProgress(status, {
                phase: itemFailed ? 'error' : 'uploading',
                current: index + 1,
                total: batch.length,
                completed: submittedTasks.length,
                failed: failures.length,
                percent: ((index + 1) / batch.length) * 100,
                detail: itemFailed
                    ? `${item.name} 提交失败，已保留图片并继续下一张`
                    : `${item.name} 已提交`
            });
        }
    } finally {
        uploads[uploadKey] = uploads[uploadKey].filter(item => {
            if (!successfulIds.has(item.batchId)) return true;
            releaseBatchImage(item);
            return false;
        });
        renderBatchImageSelection(uploadKey, selectedId, hintId);
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.dataset.loading = '';
        btn.textContent = originalText;
        if (input) input.disabled = false;
    }

    if (failures.length) {
        const firstFailure = failures[0];
        renderBatchSubmissionProgress(status, {
            phase: 'error',
            current: batch.length,
            total: batch.length,
            completed: submittedTasks.length,
            failed: failures.length,
            percent: 100,
            detail: `${firstFailure.item.name}：${firstFailure.error}。失败图片已保留，可重新提交`
        });
    } else {
        renderBatchSubmissionProgress(status, {
            phase: 'success',
            current: batch.length,
            total: batch.length,
            completed: submittedTasks.length,
            failed: 0,
            percent: 100,
            detail: '全部图片已上传并创建任务'
        });
    }

    if (submittedTasks.length) {
        const vectorCutout = mode === 'cutout' && extraPayload.cutoutMode === 'vector';
        const formatLabel = mode === 'cutout' ? String(extraPayload.cutoutOutputFormat || 'png').toUpperCase() : '';
        const firstQueueInfo = submittedTasks[0]?.queueInfo;
        const lastQueueInfo = submittedTasks[submittedTasks.length - 1]?.queueInfo;
        const aheadText = firstQueueInfo?.aheadCount > 0
            ? `前面已有 ${firstQueueInfo.aheadCount} 个任务`
            : '当前前面没有其他任务';
        const batchMinutes = Math.max(1, Number(lastQueueInfo?.completionMinutes) || 1);
        const message = mode === 'retouch'
            ? `已提交 ${submittedTasks.length} 个精修任务，${aheadText}；每张通常需要 20 分钟，预计这一批约 ${batchMinutes} 分钟完成`
            : vectorCutout
                ? `已提交 ${submittedTasks.length} 个矢量图白底任务，${aheadText}；将逐张处理，预计这一批约 ${batchMinutes} 分钟完成`
                : `已提交 ${submittedTasks.length} 个白底抠图任务，${aheadText}；将逐张处理并导出 ${formatLabel}，预计这一批约 ${batchMinutes} 分钟完成`;
        showSuccessModal(null, failures.length ? `${message}；另有 ${failures.length} 张提交失败，可关闭弹窗后重试` : message);
        if (mode === 'retouch') loadRetouchQueue();
    }
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
    const desc = scope === 'style'
        ? `将整体风格调整为 ${colorName || colorHex} 色系（不改产品）`
        : `${scope === 'background' ? '修改背景' : '修改产品'}为 ${colorName || colorHex}`;
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
initShootRequest();

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
                    <h3 style="font-size:1.2rem;font-weight:600;color:#111827;margin-bottom:8px">上传竞品图片</h3>
                    <p style="color:#6b7280;font-size:0.95rem;line-height:1.6;margin:0">上传1张作为参考的亚马逊产品图片，AI会分析其风格、构图和光影效果</p>
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


