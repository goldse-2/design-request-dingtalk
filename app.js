let parsedData = null;
let currentUser = null;
let directImages = [];
let directMode = false;

const uploadZone   = document.getElementById('uploadZone');
const fileInput    = document.getElementById('fileInput');
const uploadEmpty  = document.getElementById('uploadEmpty');
const uploadFilled = document.getElementById('uploadFilled');
const fileNameEl   = document.getElementById('fileName');
const clearFile    = document.getElementById('clearFile');
const taskType     = document.getElementById('taskType');
const taskCat      = document.getElementById('taskCat');
const taskSub      = document.getElementById('taskSub');
const taskSubStep  = document.getElementById('taskSubStep');
const taskSelected = document.getElementById('taskSelected');
const remarks      = document.getElementById('remarks');
const submitBtn    = document.getElementById('submitBtn');
const statusEl     = document.getElementById('status');
const previewEmpty   = document.getElementById('previewEmpty');
const previewContent = document.getElementById('previewContent');
const userNameEl  = document.getElementById('userName');
const userAvatarEl = document.getElementById('userAvatar');

// ── DingTalk login ──────────────────────────────────────
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
        restorePendingForm();
        return;
    }

    const authError = params.get('auth_error');
    if (authError) {
        alert('钉钉登录失败：' + decodeURIComponent(authError));
        window.history.replaceState({}, '', window.location.pathname);
        restorePendingForm();
    }

    const stored = sessionStorage.getItem('dt_user') || localStorage.getItem('dt_user');
    if (stored) {
        try {
            const user = JSON.parse(stored);
            // Force re-login if old session missing unionId
            if (!user.unionId) {
                sessionStorage.removeItem('dt_user');
                localStorage.removeItem('dt_user');
            } else {
                setUser(user);
            }
        } catch {}
    }
}

function savePendingForm() {
    if (!parsedData) return;
    try {
        const save = {
            parsedData,
            taskType: taskType.value,
            remarks: remarks.value
        };
        sessionStorage.setItem('pending_form', JSON.stringify(save));
    } catch (e) {
        try {
            const stripped = JSON.parse(JSON.stringify(parsedData));
            stripped.images = stripped.images.map(img => {
                const { imageData, imageData2, ...rest } = img;
                return rest;
            });
            sessionStorage.setItem('pending_form', JSON.stringify({
                parsedData: stripped,
                taskType: taskType.value,
                remarks: remarks.value
            }));
        } catch {}
    }
}

function restorePendingForm() {
    const raw = sessionStorage.getItem('pending_form');
    if (!raw) return;
    sessionStorage.removeItem('pending_form');
    try {
        const saved = JSON.parse(raw);
        parsedData = saved.parsedData;
        taskType.value = saved.taskType || '';
        remarks.value = saved.remarks || '';
        if (taskType.value) {
            taskSelected.textContent = `已选择：${taskType.value}`;
            taskSelected.hidden = false;
        }
        if (parsedData) {
            fileNameEl.textContent = parsedData.fileName || '';
            uploadEmpty.hidden = true;
            uploadFilled.hidden = false;
            renderPreview();
            updateSubmitState();
        }
    } catch {}
}

function setUser(user) {
    currentUser = user;
    userNameEl.textContent = user.name;
    if (userAvatarEl && user.avatar) {
        userAvatarEl.src = user.avatar;
        userAvatarEl.style.display = 'block';
    }
    const userBtn = document.getElementById('userBtn');
    if (userBtn) {
        userBtn.title = user.name + '（点击退出）';
        document.getElementById('loginIcon').style.display = 'none';
    }
    const topbarUser = document.getElementById('topbarUser');
    const topbarAvatar = document.getElementById('topbarAvatar');
    if (topbarUser && topbarAvatar && user.avatar) {
        topbarAvatar.src = user.avatar;
        topbarAvatar.title = user.name;
        topbarUser.hidden = false;
    }
    if (typeof hideLoginModal === 'function') hideLoginModal();
}

function clearUser() {
    currentUser = null;
    sessionStorage.removeItem('dt_user');
    localStorage.removeItem('dt_user');
    if (userAvatarEl) { userAvatarEl.src = ''; userAvatarEl.style.display = 'none'; }
    const userBtn = document.getElementById('userBtn');
    if (userBtn) {
        userBtn.title = '点击登录';
        document.getElementById('loginIcon').style.display = 'block';
    }
    const topbarUser = document.getElementById('topbarUser');
    if (topbarUser) topbarUser.hidden = true;
}

function handleUserBtnClick() {
    if (currentUser) {
        clearUser();
    } else {
        showLoginModal();
    }
}

const loginModal = document.getElementById('loginModal');

function showLoginModal() {
    loginModal.removeAttribute('hidden');
    loginModal.classList.add('modal--visible');
}

function hideLoginModal() {
    loginModal.classList.remove('modal--visible');
}

function showSuccessModal(q) {
    const modal = document.getElementById('successModal');
    if (!modal) return;
    document.getElementById('successQueue').textContent = q > 0 ? `前面预计 ${q} 张表格，排队中` : '排队中';
    modal.removeAttribute('hidden');
    modal.classList.add('modal--visible');
    setTimeout(() => { modal.classList.remove('modal--visible'); modal.hidden = true; }, 4800);
}

initAuth();
if (!currentUser) showLoginModal();

// ── File upload ─────────────────────────────────────────
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag'));
uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
});
fileInput.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
clearFile.addEventListener('click', e => { e.stopPropagation(); resetFile(); });

const TASK_SUBTYPES = {
    '图片': ['单张', '套图', '其他'],
    '视频': ['教程视频', '普通视频', '其他'],
    '设计': ['说明书', '包装', '其他']
};

const TASK_SUBSUBTYPES = {
    '其他': ['绿标', '修改文案', '其他']
};
let selectedCat = '';
let selectedSub = '';

const taskSubSubStep = (() => {
    const el = document.createElement('div');
    el.className = 'task-step';
    el.id = 'taskSubSubStep';
    el.hidden = true;
    el.innerHTML = '<div class="task-step-label">第三步：选择具体类型</div><div class="task-options" id="taskSubSub"></div>';
    document.getElementById('taskGuide').appendChild(el);
    return el;
})();
const taskSubSub = document.getElementById('taskSubSub');

function selectCategory(cat) {
    selectedCat = cat;
    selectedSub = '';
    Array.from(taskCat.children).forEach(btn => btn.classList.toggle('active', btn.dataset.cat === cat));
    taskSub.innerHTML = (TASK_SUBTYPES[cat] || [])
        .map(sub => `<button type="button" class="task-opt" data-sub="${sub}">${sub}</button>`)
        .join('');
    taskSubStep.hidden = false;
    taskSubSubStep.hidden = true;
    taskSubSub.innerHTML = '';
    taskType.value = '';
    taskSelected.hidden = true;
    applyDirectMode();
    updateSubmitState();
}

function selectSubtype(sub) {
    selectedSub = sub;
    Array.from(taskSub.children).forEach(btn => btn.classList.toggle('active', btn.dataset.sub === sub));
    const subsubs = TASK_SUBSUBTYPES[sub];
    if (subsubs && selectedCat === '图片') {
        taskSubSub.innerHTML = subsubs
            .map(s => `<button type="button" class="task-opt" data-subsub="${s}">${s}</button>`)
            .join('');
        taskSubSubStep.hidden = false;
        taskType.value = '';
        taskSelected.hidden = true;
    } else {
        taskSubSubStep.hidden = true;
        taskSubSub.innerHTML = '';
        taskType.value = `${selectedCat} - ${sub}`;
        taskSelected.textContent = `已选择：${taskType.value}`;
        taskSelected.hidden = false;
    }
    applyDirectMode();
    updateSubmitState();
}

function selectSubSubtype(subsub) {
    Array.from(taskSubSub.children).forEach(btn => btn.classList.toggle('active', btn.dataset.subsub === subsub));
    taskType.value = `${selectedCat} - ${subsub}`;
    taskSelected.textContent = `已选择：${taskType.value}`;
    taskSelected.hidden = false;
    updateSubmitState();
}

taskCat.addEventListener('click', e => {
    const btn = e.target.closest('.task-opt');
    if (btn) selectCategory(btn.dataset.cat);
});
taskSub.addEventListener('click', e => {
    const btn = e.target.closest('.task-opt');
    if (btn) selectSubtype(btn.dataset.sub);
});
taskSubSub.addEventListener('click', e => {
    const btn = e.target.closest('.task-opt');
    if (btn) selectSubSubtype(btn.dataset.subsub);
});

const excelField = document.getElementById('excelField');
const imageField = document.getElementById('imageField');
const designField = document.getElementById('designField');
const packagingField = document.getElementById('packagingField');
const directDrop = document.getElementById('directDrop');
const directInput = document.getElementById('directInput');
const directThumbs = document.getElementById('directThumbs');
const directDesc = document.getElementById('directDesc');
const designProduct = document.getElementById('designProduct');
const designBrand = document.getElementById('designBrand');
const designEmail = document.getElementById('designEmail');
const designAmazonName = document.getElementById('designAmazonName');
const designImageDrop = document.getElementById('designImageDrop');
const designImageInput = document.getElementById('designImageInput');
const designImageThumbs = document.getElementById('designImageThumbs');
const designTime = document.getElementById('designTime');
const designCalendar = document.getElementById('designCalendar');
const packagingProduct = document.getElementById('packagingProduct');
const packagingBrand = document.getElementById('packagingBrand');
const packagingEmail = document.getElementById('packagingEmail');
const packagingAmazonName = document.getElementById('packagingAmazonName');
const packagingSize = document.getElementById('packagingSize');
const packagingImageDrop = document.getElementById('packagingImageDrop');
const packagingImageInput = document.getElementById('packagingImageInput');
const packagingImageThumbs = document.getElementById('packagingImageThumbs');
const packagingTime = document.getElementById('packagingTime');
const packagingCalendar = document.getElementById('packagingCalendar');

let designImages = [];
let packagingImages = [];

// 自定义日期选择器类
class CustomDatePicker {
    constructor(input, calendar) {
        this.input = input;
        this.calendar = calendar;
        this.selectedDate = null;
        this.currentMonth = new Date();
        this.minDate = new Date();
        this.maxDate = new Date();
        this.maxDate.setMonth(this.maxDate.getMonth() + 2);
        
        this.init();
    }
    
    init() {
        // 点击输入框显示日历
        this.input.addEventListener('click', () => {
            this.calendar.hidden = false;
            this.render();
        });
        
        // 点击日历外部关闭
        document.addEventListener('click', (e) => {
            if (!this.input.contains(e.target) && !this.calendar.contains(e.target)) {
                this.calendar.hidden = true;
            }
        });
        
        // 月份导航
        this.calendar.querySelectorAll('.calendar-nav').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.dataset.action === 'prev') {
                    this.currentMonth.setMonth(this.currentMonth.getMonth() - 1);
                } else {
                    this.currentMonth.setMonth(this.currentMonth.getMonth() + 1);
                }
                this.render();
            });
        });
        
        // 设置默认值为今天
        this.selectDate(new Date());
    }
    
    render() {
        // 每次渲染时更新最小日期为今天（确保日期是最新的）
        this.minDate = new Date();
        this.minDate.setHours(0, 0, 0, 0);
        this.maxDate = new Date();
        this.maxDate.setMonth(this.maxDate.getMonth() + 2);
        this.maxDate.setHours(23, 59, 59, 999);
        
        const year = this.currentMonth.getFullYear();
        const month = this.currentMonth.getMonth();
        
        // 更新标题
        const title = this.calendar.querySelector('.calendar-title');
        title.textContent = `${year}年${month + 1}月`;
        
        // 获取当月第一天和最后一天
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startWeekday = firstDay.getDay();
        const daysInMonth = lastDay.getDate();
        
        // 渲染日期
        const daysContainer = this.calendar.querySelector('.calendar-days');
        daysContainer.innerHTML = '';
        
        // 填充空白
        for (let i = 0; i < startWeekday; i++) {
            const empty = document.createElement('div');
            empty.className = 'calendar-day empty';
            daysContainer.appendChild(empty);
        }
        
        // 填充日期
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dayEl = document.createElement('div');
            dayEl.className = 'calendar-day';
            dayEl.textContent = day;
            
            // 检查是否在有效范围内
            if (date < this.minDate || date > this.maxDate) {
                dayEl.classList.add('disabled');
            } else {
                dayEl.addEventListener('click', () => this.selectDate(date));
            }
            
            // 标记今天
            if (this.isToday(date)) {
                dayEl.classList.add('today');
            }
            
            // 标记选中日期
            if (this.selectedDate && this.isSameDay(date, this.selectedDate)) {
                dayEl.classList.add('selected');
            }
            
            daysContainer.appendChild(dayEl);
        }
    }
    
    selectDate(date) {
        this.selectedDate = date;
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        this.input.value = `${month}-${day}`;
        this.input.dataset.fullDate = date.toISOString().split('T')[0];
        this.calendar.hidden = true;
        
        // 触发 change 事件
        this.input.dispatchEvent(new Event('change'));
    }
    
    isToday(date) {
        const today = new Date();
        return this.isSameDay(date, today);
    }
    
    isSameDay(date1, date2) {
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
    }
    
    getValue() {
        return this.input.dataset.fullDate || '';
    }
    
    clear() {
        this.selectedDate = null;
        this.input.value = '';
        this.input.dataset.fullDate = '';
        this.currentMonth = new Date();
    }
}

function applyDirectMode() {
    directMode = (selectedCat === '图片' && selectedSub === '单张');
    const designMode = (selectedCat === '设计' && selectedSub === '说明书');
    const packagingMode = (selectedCat === '设计' && selectedSub === '包装');
    
    if (directMode) {
        excelField.hidden = true;
        imageField.hidden = false;
        designField.hidden = true;
        packagingField.hidden = true;
        resetFile();
    } else if (designMode) {
        excelField.hidden = true;
        imageField.hidden = true;
        designField.hidden = false;
        packagingField.hidden = true;
        resetFile();
        clearDirectImages();
        clearPackagingFields();
    } else if (packagingMode) {
        excelField.hidden = true;
        imageField.hidden = true;
        designField.hidden = true;
        packagingField.hidden = false;
        resetFile();
        clearDirectImages();
        clearDesignFields();
    } else {
        imageField.hidden = true;
        designField.hidden = true;
        packagingField.hidden = true;
        excelField.hidden = false;
        clearDirectImages();
        clearDesignFields();
        clearPackagingFields();
    }
    updateSubmitState();
}

function clearPackagingFields() {
    if (packagingProduct) packagingProduct.value = '';
    if (packagingBrand) packagingBrand.value = '';
    if (packagingEmail) packagingEmail.value = '';
    if (packagingAmazonName) packagingAmazonName.value = '';
    if (packagingSize) packagingSize.value = '';
    if (packagingDatePicker) packagingDatePicker.clear();
    clearPackagingImages();
}

function clearDesignFields() {
    if (designProduct) designProduct.value = '';
    if (designBrand) designBrand.value = '';
    if (designEmail) designEmail.value = '';
    if (designAmazonName) designAmazonName.value = '';
    if (designDatePicker) designDatePicker.clear();
    clearDesignImages();
}

function clearDirectImages() {
    directImages = [];
    if (directThumbs) directThumbs.innerHTML = '';
    if (directInput) directInput.value = '';
    if (directDesc) directDesc.value = '';
}

function addDirectImages(files) {
    Array.from(files).forEach(file => {
        if (directImages.length >= 3) { alert('最多上传 3 张图片'); return; }
        if (!file.type.startsWith('image/')) { alert('请上传图片文件：' + file.name); return; }
        if (file.size > 8 * 1024 * 1024) { alert('单张图片不能超过 8MB：' + file.name); return; }
        const reader = new FileReader();
        reader.onload = ev => {
            directImages.push({ name: file.name, mimeType: file.type, base64: ev.target.result.split(',')[1], dataUrl: ev.target.result });
            renderDirectThumbs();
            updateSubmitState();
        };
        reader.readAsDataURL(file);
    });
}

function renderDirectThumbs() {
    if (!directThumbs) return;
    directThumbs.innerHTML = '';
    directImages.forEach((f, i) => {
        const div = document.createElement('div');
        div.className = 'sf-preview-item';
        div.innerHTML = `<img src="${f.dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"><button data-i="${i}" type="button">×</button>`;
        div.querySelector('button').addEventListener('click', () => {
            directImages.splice(i, 1); renderDirectThumbs(); updateSubmitState();
        });
        directThumbs.appendChild(div);
    });
}

if (directDrop) {
    directDrop.addEventListener('click', () => directInput.click());
    directDrop.addEventListener('dragover', e => { e.preventDefault(); directDrop.classList.add('drag'); });
    directDrop.addEventListener('dragleave', () => directDrop.classList.remove('drag'));
    directDrop.addEventListener('drop', e => {
        e.preventDefault(); directDrop.classList.remove('drag');
        addDirectImages(e.dataTransfer.files);
    });
    directInput.addEventListener('change', e => { addDirectImages(e.target.files); e.target.value = ''; });
}

// 设计表单字段监听
if (designProduct) designProduct.addEventListener('input', updateSubmitState);
if (designBrand) designBrand.addEventListener('input', updateSubmitState);
if (designEmail) designEmail.addEventListener('input', updateSubmitState);
if (designAmazonName) designAmazonName.addEventListener('input', updateSubmitState);

// 初始化设计日期选择器
let designDatePicker = null;
if (designTime && designCalendar) {
    designDatePicker = new CustomDatePicker(designTime, designCalendar);
    designTime.addEventListener('change', updateSubmitState);
}

// 包装表单字段监听
if (packagingProduct) packagingProduct.addEventListener('input', updateSubmitState);
if (packagingBrand) packagingBrand.addEventListener('input', updateSubmitState);
if (packagingEmail) packagingEmail.addEventListener('input', updateSubmitState);
if (packagingAmazonName) packagingAmazonName.addEventListener('input', updateSubmitState);
if (packagingSize) packagingSize.addEventListener('input', updateSubmitState);

// 初始化包装日期选择器
let packagingDatePicker = null;
if (packagingTime && packagingCalendar) {
    packagingDatePicker = new CustomDatePicker(packagingTime, packagingCalendar);
    packagingTime.addEventListener('change', updateSubmitState);
}

// 设计图片上传
if (designImageDrop) {
    designImageDrop.addEventListener('click', () => designImageInput.click());
    designImageDrop.addEventListener('dragover', e => { e.preventDefault(); designImageDrop.classList.add('drag'); });
    designImageDrop.addEventListener('dragleave', () => designImageDrop.classList.remove('drag'));
    designImageDrop.addEventListener('drop', e => {
        e.preventDefault(); designImageDrop.classList.remove('drag');
        addDesignImages(e.dataTransfer.files);
    });
    designImageInput.addEventListener('change', e => { addDesignImages(e.target.files); e.target.value = ''; });
}

// 包装图片上传
if (packagingImageDrop) {
    packagingImageDrop.addEventListener('click', () => packagingImageInput.click());
    packagingImageDrop.addEventListener('dragover', e => { e.preventDefault(); packagingImageDrop.classList.add('drag'); });
    packagingImageDrop.addEventListener('dragleave', () => packagingImageDrop.classList.remove('drag'));
    packagingImageDrop.addEventListener('drop', e => {
        e.preventDefault(); packagingImageDrop.classList.remove('drag');
        addPackagingImages(e.dataTransfer.files);
    });
    packagingImageInput.addEventListener('change', e => { addPackagingImages(e.target.files); e.target.value = ''; });
}

function addDesignImages(files) {
    Array.from(files).forEach(file => {
        if (designImages.length >= 3) { alert('最多上传 3 张图片'); return; }
        if (!file.type.startsWith('image/')) { alert('请上传图片文件：' + file.name); return; }
        if (file.size > 8 * 1024 * 1024) { alert('单张图片不能超过 8MB：' + file.name); return; }
        const reader = new FileReader();
        reader.onload = ev => {
            designImages.push({ name: file.name, mimeType: file.type, base64: ev.target.result.split(',')[1], dataUrl: ev.target.result });
            renderDesignImageThumbs();
            updateSubmitState();
        };
        reader.readAsDataURL(file);
    });
}

function renderDesignImageThumbs() {
    if (!designImageThumbs) return;
    designImageThumbs.innerHTML = designImages.map((img, i) => `
        <div class="sf-preview-item">
            <img src="${img.dataUrl}" alt="${img.name}">
            <button type="button" onclick="removeDesignImage(${i})">×</button>
        </div>
    `).join('');
}

function removeDesignImage(idx) {
    designImages.splice(idx, 1);
    renderDesignImageThumbs();
    updateSubmitState();
}

function clearDesignImages() {
    designImages = [];
    if (designImageThumbs) designImageThumbs.innerHTML = '';
    if (designImageInput) designImageInput.value = '';
}

function addPackagingImages(files) {
    Array.from(files).forEach(file => {
        if (packagingImages.length >= 3) { alert('最多上传 3 张图片'); return; }
        if (!file.type.startsWith('image/')) { alert('请上传图片文件：' + file.name); return; }
        if (file.size > 8 * 1024 * 1024) { alert('单张图片不能超过 8MB：' + file.name); return; }
        const reader = new FileReader();
        reader.onload = ev => {
            packagingImages.push({ name: file.name, mimeType: file.type, base64: ev.target.result.split(',')[1], dataUrl: ev.target.result });
            renderPackagingImageThumbs();
            updateSubmitState();
        };
        reader.readAsDataURL(file);
    });
}

function renderPackagingImageThumbs() {
    if (!packagingImageThumbs) return;
    packagingImageThumbs.innerHTML = packagingImages.map((img, i) => `
        <div class="sf-preview-item">
            <img src="${img.dataUrl}" alt="${img.name}">
            <button type="button" onclick="removePackagingImage(${i})">×</button>
        </div>
    `).join('');
}

function removePackagingImage(idx) {
    packagingImages.splice(idx, 1);
    renderPackagingImageThumbs();
    updateSubmitState();
}

function clearPackagingImages() {
    packagingImages = [];
    if (packagingImageThumbs) packagingImageThumbs.innerHTML = '';
    if (packagingImageInput) packagingImageInput.value = '';
}

function loadFile(file) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) { alert('请上传 Excel 文件（.xlsx 或 .xls）'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        const arrayBuffer = e.target.result;
        parsedData = {
            fileName: file.name,
            submitTime: new Date().toLocaleString('zh-CN'),
            basicInfo: {},
            images: [],
            originalFile: arrayBufferToBase64(arrayBuffer)
        };
        fileNameEl.textContent = file.name;
        uploadEmpty.hidden = true;
        uploadFilled.hidden = false;
        updateSubmitState();
    };
    reader.readAsArrayBuffer(file);
}

async function extractImages(arrayBuffer) {
    const idToImage = {};
    try {
        const zip = await JSZip.loadAsync(arrayBuffer);

        const rIdToFile = {};
        if (zip.files['xl/_rels/cellimages.xml.rels']) {
            const relsXml = await zip.files['xl/_rels/cellimages.xml.rels'].async('text');
            for (const [, rId, target] of relsXml.matchAll(/Id="(rId\d+)"[^>]+Target="([^"]+)"/g)) {
                rIdToFile[rId] = target;
            }
        }

        const idToRId = {};
        if (zip.files['xl/cellimages.xml']) {
            const cellImgXml = await zip.files['xl/cellimages.xml'].async('text');
            for (const block of cellImgXml.match(/<etc:cellImage>[\s\S]*?<\/etc:cellImage>/g) || []) {
                const nameMatch = block.match(/name="([^"]+)"/);
                const embedMatch = block.match(/r:embed="([^"]+)"/);
                if (nameMatch && embedMatch) idToRId[nameMatch[1]] = embedMatch[1];
            }
        }

        for (const [id, rId] of Object.entries(idToRId)) {
            const filePath = rIdToFile[rId];
            if (!filePath) continue;
            const fullPath = 'xl/' + filePath;
            if (!zip.files[fullPath]) continue;
            const base64 = await zip.files[fullPath].async('base64');
            const ext = filePath.split('.').pop().toLowerCase();
            const mime = { png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' }[ext] || 'image/jpeg';
            idToImage[id] = `data:${mime};base64,${base64}`;
        }
    } catch (err) {
        console.warn('Image extraction failed:', err);
    }
    return idToImage;
}

function resetFile() {
    parsedData = null;
    fileInput.value = '';
    uploadEmpty.hidden = false;
    uploadFilled.hidden = true;
    previewEmpty.hidden = false;
    previewContent.hidden = true;
    updateSubmitState();
}

function updateSubmitState() {
    const designMode = (selectedCat === '设计' && selectedSub === '说明书');
    const packagingMode = (selectedCat === '设计' && selectedSub === '包装');
    
    if (directMode) {
        submitBtn.disabled = !(directImages.length > 0 && taskType.value);
        renderDirectPreview();
    } else if (designMode) {
        // 设计模式：产品、品牌、亚马逊名称必填，售后邮箱和图片可选，时间必选
        const hasRequired = designProduct?.value.trim() && designBrand?.value.trim() && designAmazonName?.value.trim() && designTime?.dataset.fullDate && taskType.value;
        submitBtn.disabled = !hasRequired;
        renderDesignPreview();
    } else if (packagingMode) {
        // 包装模式：产品、品牌、亚马逊名称、包装尺寸必填，售后邮箱和图片可选，时间必选
        const hasRequired = packagingProduct?.value.trim() && packagingBrand?.value.trim() && packagingAmazonName?.value.trim() && packagingSize?.value.trim() && packagingTime?.dataset.fullDate && taskType.value;
        submitBtn.disabled = !hasRequired;
        renderPackagingPreview();
    } else {
        submitBtn.disabled = !(parsedData && taskType.value);
    }
}

function renderPackagingPreview() {
    const product = packagingProduct?.value.trim() || '';
    const brand = packagingBrand?.value.trim() || '';
    const email = packagingEmail?.value.trim() || '';
    const amazonName = packagingAmazonName?.value.trim() || '';
    const size = packagingSize?.value.trim() || '';
    const time = packagingTime?.value || '';
    
    if (!product && !brand && !amazonName && !size) {
        previewEmpty.hidden = false;
        previewContent.hidden = true;
        return;
    }
    
    document.getElementById('previewBadge').textContent = '设计包装';
    const chips = [];
    if (product) chips.push(`产品：${product}`);
    if (brand) chips.push(`品牌：${brand}`);
    if (email) chips.push(`售后邮箱：${email}`);
    if (amazonName) chips.push(`亚马逊名称：${amazonName}`);
    if (size) chips.push(`包装尺寸：${size}`);
    if (time) chips.push(`需要时间：${time}`);
    if (packagingImages.length > 0) chips.push(`产品图片：${packagingImages.length} 张`);
    
    document.getElementById('previewBasic').innerHTML = chips.map(t => `<span class="preview-chip">${escapeHtml(t)}</span>`).join('');
    document.getElementById('previewImages').innerHTML = '';
    previewEmpty.hidden = true;
    previewContent.hidden = false;
}

function renderDesignPreview() {
    const product = designProduct?.value.trim() || '';
    const brand = designBrand?.value.trim() || '';
    const email = designEmail?.value.trim() || '';
    const amazonName = designAmazonName?.value.trim() || '';
    const time = designTime?.value || '';
    
    if (!product && !brand && !amazonName) {
        previewEmpty.hidden = false;
        previewContent.hidden = true;
        return;
    }
    
    document.getElementById('previewBadge').textContent = '设计说明书';
    const chips = [];
    if (product) chips.push(`产品：${product}`);
    if (brand) chips.push(`品牌：${brand}`);
    if (email) chips.push(`售后邮箱：${email}`);
    if (amazonName) chips.push(`亚马逊名称：${amazonName}`);
    if (time) chips.push(`需要时间：${time}`);
    if (designImages.length > 0) chips.push(`产品图片：${designImages.length} 张`);
    
    document.getElementById('previewBasic').innerHTML = chips.map(t => `<span class="preview-chip">${escapeHtml(t)}</span>`).join('');
    document.getElementById('previewImages').innerHTML = '';
    previewEmpty.hidden = true;
    previewContent.hidden = false;
}

function renderDirectPreview() {
    if (!directImages.length) {
        previewEmpty.hidden = false;
        previewContent.hidden = true;
        return;
    }
    document.getElementById('previewBadge').textContent = '单张图片';
    document.getElementById('previewBasic').innerHTML =
        `<span class="chip"><span class="chip-key">类型</span><span class="chip-val">${esc(taskType.value || '图片 - 单张')}</span></span>`
        + `<span class="chip"><span class="chip-key">图片数量</span><span class="chip-val">${directImages.length} 张</span></span>`;

    const imagesEl = document.getElementById('previewImages');
    let html = `<h4>提交图片（共 ${directImages.length} 张）</h4>`;
    html += '<table class="direct-img-table"><thead><tr><th>序号</th><th>预览</th><th>文件名</th><th>大小</th></tr></thead><tbody>';
    directImages.forEach((f, i) => {
        const sizeKB = f.base64 ? Math.round(f.base64.length * 0.75 / 1024) : 0;
        html += `<tr>
            <td>${i + 1}</td>
            <td><img src="${f.dataUrl}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb"></td>
            <td style="word-break:break-all;font-size:0.82rem">${esc(f.name)}</td>
            <td style="font-size:0.82rem;color:#6b7280">${sizeKB} KB</td>
        </tr>`;
    });
    html += '</tbody></table>';
    if (directDesc && directDesc.value.trim()) {
        html += `<div class="img-line" style="margin-top:10px"><span class="img-label">描述</span><span>${esc(directDesc.value.trim())}</span></div>`;
    }
    imagesEl.innerHTML = html;
    previewEmpty.hidden = true;
    previewContent.hidden = false;
}

function parseWorkbook(wb, fileN, idToImage) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const data = { fileName: fileN, submitTime: new Date().toLocaleString('zh-CN'), basicInfo: {}, images: [] };
    let section = '主图';

    for (const row of rows) {
        const c0 = s(row[0]), c1 = s(row[1]), c2 = s(row[2]);

        if (c0 === '型号') {
            data.basicInfo['型号'] = c1;
            if (s(row[3]) === '交表时间') data.basicInfo['交表时间'] = fmtDate(row[4]);
        } else if (c0 === '颜色要求') {
            data.basicInfo['颜色要求'] = c1;
        } else if (/^A\+/.test(c0)) {
            section = 'A+';
        } else if (/^图\d+$/.test(c0)) {
            const m1 = c1.match(/(ID_[A-F0-9]+)/i);
            const m2 = c2.match(/(ID_[A-F0-9]+)/i);
            const req = s(row[3]);
            const size = (req.match(/(\d{3,4}[*×xX]\d{3,4})/) || [])[1] || '';
            data.images.push({
                序号: c0,
                区域: section,
                图片要求: req,
                尺寸: size,
                参考链接: s(row[4]),
                文案: s(row[5]),
                imageData: m1 ? idToImage[m1[1]] : null,
                imageData2: m2 ? idToImage[m2[1]] : null
            });
        }
    }
    data.basicInfo['图片数量'] = data.images.length + ' 张';
    return data;
}

function s(v) { return String(v ?? '').trim(); }

function fmtDate(v) {
    if (!v) return '';
    if (typeof v === 'number') {
        try { const d = XLSX.SSF.parse_date_code(v); return `${d.y}-${pad(d.m)}-${pad(d.d)}`; } catch { return String(v); }
    }
    return String(v).replace(/T.*/, '').slice(0, 10);
}

function pad(n) { return String(n).padStart(2, '0'); }
function arrayBufferToBase64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function renderPreview() {
    if (!parsedData) return;
    document.getElementById('previewBadge').textContent = parsedData.basicInfo['型号'] || '';
    document.getElementById('previewBasic').innerHTML = Object.entries(parsedData.basicInfo)
        .filter(([, v]) => v)
        .map(([k, v]) => `<span class="chip"><span class="chip-key">${k}</span><span class="chip-val">${v}</span></span>`)
        .join('');

    const imagesEl = document.getElementById('previewImages');
    if (!parsedData.images.length) {
        imagesEl.innerHTML = '<p style="color:#9ca3af;font-size:0.85rem;padding:4px 0">未检测到图片需求行</p>';
    } else {
        const mainImgs = parsedData.images.filter(i => i.区域 === '主图');
        const aplusImgs = parsedData.images.filter(i => i.区域 === 'A+');
        let html = `<h4>图片需求（共 ${parsedData.images.length} 张）</h4>`;
        if (mainImgs.length) {
            html += `<div class="section-label">主图（${mainImgs.length} 张）</div>`;
            html += mainImgs.map(img => imgCard(img)).join('');
        }
        if (aplusImgs.length) {
            html += `<div class="section-label">A+（${aplusImgs.length} 张）</div>`;
            html += aplusImgs.map(img => imgCard(img)).join('');
        }
        imagesEl.innerHTML = html;
    }
    previewEmpty.hidden = true;
    previewContent.hidden = false;
}

function imgCard(img) {
    const images = [];
    if (img.imageData) images.push(img.imageData);
    if (img.imageData2) images.push(img.imageData2);

    return `<div class="img-row">
        <div class="img-row-head">
            <span class="img-num">${img.序号}</span>
            ${img.尺寸 ? `<span class="img-size">${img.尺寸}</span>` : ''}
        </div>
        ${images.length ? `<div class="img-thumb-grid">${images.map((src, i) => `<img src="${src}" alt="${img.序号}-${i + 1}">`).join('')}</div>` : ''}
        ${imgLine('要求', img.图片要求)}
        ${imgLine('文案', img.文案)}
        ${img.参考链接 ? `<div class="img-line"><span class="img-label">链接</span><a href="${img.参考链接}" target="_blank" style="color:#6366f1;word-break:break-all;font-size:0.82rem">${img.参考链接.slice(0, 60)}${img.参考链接.length > 60 ? '…' : ''}</a></div>` : ''}
    </div>`;
}

function imgLine(label, val) {
    if (!val) return '';
    return `<div class="img-line"><span class="img-label">${label}</span><span>${esc(val)}</span></div>`;
}

function esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// ── Submit ──────────────────────────────────────────────
submitBtn.addEventListener('click', async () => {
    const designMode = (selectedCat === '设计' && selectedSub === '说明书');
    const packagingMode = (selectedCat === '设计' && selectedSub === '包装');
    
    if (directMode) {
        if (!directImages.length || !taskType.value) return;
    } else if (designMode || packagingMode) {
        // 设计和包装模式不需要 parsedData
        if (!taskType.value) return;
    } else if (!parsedData || !taskType.value) {
        return;
    }
    if (!currentUser) {
        showLoginModal();
        return;
    }
    doSubmit();
});

async function doSubmit() {
    if (directMode) return doDirectSubmit();
    
    const designMode = (selectedCat === '设计' && selectedSub === '说明书');
    if (designMode) return doDesignSubmit();
    
    const packagingMode = (selectedCat === '设计' && selectedSub === '包装');
    if (packagingMode) return doPackagingSubmit();
    
    if (!parsedData || !taskType.value) return;
    setStatus('提交中...', 'busy');
    submitBtn.disabled = true;

    const payload = {
        ...parsedData,
        images: (parsedData.images || []).map(img => {
            const { imageData, imageData2, ...rest } = img;
            return rest;
        })
    };

    try {
        const res = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                taskType: taskType.value,
                remarks: remarks.value.trim(),
                submitter: currentUser || null,
                data: payload
            })
        });
        const json = await res.json();
        if (res.ok && json.ok) {
            const q = json.queuePosition || 0;
            showSuccessModal(q);
            setTimeout(resetAll, 5000);
        } else {
            setStatus('提交失败：' + (json.error || res.status), 'err');
            submitBtn.disabled = false;
        }
    } catch (err) {
        setStatus('网络错误：' + err.message, 'err');
        submitBtn.disabled = false;
    }
}

async function doPackagingSubmit() {
    const product = packagingProduct?.value.trim() || '';
    const brand = packagingBrand?.value.trim() || '';
    const email = packagingEmail?.value.trim() || '';
    const amazonName = packagingAmazonName?.value.trim() || '';
    const size = packagingSize?.value.trim() || '';
    const time = packagingTime?.dataset.fullDate || '';
    
    if (!product || !brand || !amazonName || !size || !time || !taskType.value) return;
    
    setStatus('提交中...', 'busy');
    submitBtn.disabled = true;
    
    try {
        // 上传产品图片
        const photoKeys = [];
        if (packagingImages.length > 0) {
            setStatus('上传产品图片中...', 'busy');
            for (const img of packagingImages) {
                const fd = new FormData();
                const blob = await fetch(img.dataUrl).then(r => r.blob());
                fd.append('file', blob, img.name);
                fd.append('prefix', 'design/packaging');
                const upRes = await fetch('/api/studio-upload', { method: 'POST', body: fd });
                const upJson = await upRes.json();
                if (!upRes.ok || !upJson.ok) throw new Error('图片上传失败：' + (upJson.error || upRes.status));
                photoKeys.push({ key: upJson.key, name: upJson.name });
            }
        }
        
        const data = {
            fileName: '设计包装提交',
            submitTime: new Date().toLocaleString('zh-CN'),
            basicInfo: {
                '型号': product,
                '品牌': brand,
                '售后邮箱': email || '未提供',
                '亚马逊名称': amazonName,
                '包装尺寸': size,
                '需要时间': time
            },
            images: photoKeys.map((k, i) => ({ 序号: '图' + (i + 1), 区域: '产品图', photoKey: k.key, photoName: k.name })),
            packagingInfo: {
                product,
                brand,
                email,
                amazonName,
                size,
                time,
                productImages: photoKeys
            }
        };
        
        setStatus('提交中...', 'busy');
        const res = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                taskType: taskType.value,
                remarks: remarks.value.trim(),
                submitter: currentUser || null,
                data
            })
        });
        const json = await res.json();
        if (res.ok && json.ok) {
            showSuccessModal(json.queuePosition || 0);
            setTimeout(resetAll, 5000);
        } else {
            setStatus('提交失败：' + (json.error || res.status), 'err');
            submitBtn.disabled = false;
        }
    } catch (err) {
        setStatus('错误：' + err.message, 'err');
        submitBtn.disabled = false;
    }
}

async function doDesignSubmit() {
    const product = designProduct?.value.trim() || '';
    const brand = designBrand?.value.trim() || '';
    const email = designEmail?.value.trim() || '';
    const amazonName = designAmazonName?.value.trim() || '';
    const time = designTime?.dataset.fullDate || '';
    
    if (!product || !brand || !amazonName || !time || !taskType.value) return;
    
    setStatus('提交中...', 'busy');
    submitBtn.disabled = true;
    
    try {
        // 上传产品图片
        const photoKeys = [];
        if (designImages.length > 0) {
            setStatus('上传产品图片中...', 'busy');
            for (const img of designImages) {
                const fd = new FormData();
                const blob = await fetch(img.dataUrl).then(r => r.blob());
                fd.append('file', blob, img.name);
                fd.append('prefix', 'design/product');
                const upRes = await fetch('/api/studio-upload', { method: 'POST', body: fd });
                const upJson = await upRes.json();
                if (!upRes.ok || !upJson.ok) throw new Error('图片上传失败：' + (upJson.error || upRes.status));
                photoKeys.push({ key: upJson.key, name: upJson.name });
            }
        }
        
        const data = {
            fileName: '设计说明书提交',
            submitTime: new Date().toLocaleString('zh-CN'),
            basicInfo: {
                '型号': product,
                '品牌': brand,
                '售后邮箱': email || '未提供',
                '亚马逊名称': amazonName,
                '需要时间': time
            },
            images: photoKeys.map((k, i) => ({ 序号: '图' + (i + 1), 区域: '产品图', photoKey: k.key, photoName: k.name })),
            designInfo: {
                product,
                brand,
                email,
                amazonName,
                time,
                productImages: photoKeys
            }
        };
        
        setStatus('提交中...', 'busy');
        const res = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                taskType: taskType.value,
                remarks: remarks.value.trim(),
                submitter: currentUser || null,
                data
            })
        });
        const json = await res.json();
        if (res.ok && json.ok) {
            showSuccessModal(json.queuePosition || 0);
            setTimeout(resetAll, 5000);
        } else {
            setStatus('提交失败：' + (json.error || res.status), 'err');
            submitBtn.disabled = false;
        }
    } catch (err) {
        setStatus('错误：' + err.message, 'err');
        submitBtn.disabled = false;
    }
}

async function doDirectSubmit() {
    if (!directImages.length || !taskType.value) return;
    setStatus('上传图片中...', 'busy');
    submitBtn.disabled = true;
    try {
        const photoKeys = [];
        for (const img of directImages) {
            const fd = new FormData();
            const blob = await fetch(img.dataUrl).then(r => r.blob());
            fd.append('file', blob, img.name);
            fd.append('prefix', 'direct/image');
            const upRes = await fetch('/api/studio-upload', { method: 'POST', body: fd });
            const upJson = await upRes.json();
            if (!upRes.ok || !upJson.ok) throw new Error('图片上传失败：' + (upJson.error || upRes.status));
            photoKeys.push({ key: upJson.key, name: upJson.name });
        }

        const desc = directDesc ? directDesc.value.trim() : '';
        const data = {
            fileName: '单张图片提交',
            submitTime: new Date().toLocaleString('zh-CN'),
            basicInfo: { '型号': '单张图片', '图片数量': directImages.length + ' 张' },
            images: photoKeys.map((k, i) => ({ 序号: '图' + (i + 1), 区域: '直传', 图片要求: desc, photoKey: k.key, photoName: k.name })),
            directPhotoKeys: photoKeys,
            directDesc: desc
        };

        setStatus('提交中...', 'busy');
        const res = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                taskType: taskType.value,
                remarks: remarks.value.trim(),
                submitter: currentUser || null,
                data
            })
        });
        const json = await res.json();
        if (res.ok && json.ok) {
            showSuccessModal(json.queuePosition || 0);
            setTimeout(resetAll, 5000);
        } else {
            setStatus('提交失败：' + (json.error || res.status), 'err');
            submitBtn.disabled = false;
        }
    } catch (err) {
        setStatus('错误：' + err.message, 'err');
        submitBtn.disabled = false;
    }
}

function setStatus(msg, cls) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + cls;
}

function resetAll() {
    resetFile();
    clearDirectImages();
    clearDesignFields();
    clearPackagingFields();
    directMode = false;
    imageField.hidden = true;
    designField.hidden = true;
    packagingField.hidden = true;
    excelField.hidden = false;
    taskType.value = '';
    remarks.value = '';
    selectedCat = '';
    selectedSub = '';
    taskSub.innerHTML = '';
    taskSubStep.hidden = true;
    taskSubSubStep.hidden = true;
    taskSubSub.innerHTML = '';
    taskSelected.hidden = true;
    taskSelected.textContent = '';
    Array.from(taskCat.children).forEach(btn => btn.classList.remove('active'));
    submitBtn.textContent = '取号';
    statusEl.className = 'status';
    statusEl.textContent = '';
}


// ── Task Queue Display ──────────────────────────
(function() {
    const queueCount = document.getElementById('queueCount');
    const queueEmpty = document.getElementById('queueEmpty');
    const queueList = document.getElementById('queueList');
    const processingTask = document.getElementById('processingTask');
    const processingEmpty = document.getElementById('processingEmpty');
    const processingDuration = document.getElementById('processingDuration');
    const processingEta = document.getElementById('processingEta');

    if (!queueList) return;

    let processingStartTime = null;
    let _processingDurationTimer = null;

    function updateProcessingDuration() {
        if (!processingStartTime || !processingDuration) return;
        const elapsed = Math.floor((Date.now() - processingStartTime) / 1000);
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        const s = elapsed % 60;
        processingDuration.textContent = h + 'h ' + m + 'm ' + s + 's';
    }

    function startDurationTicker() {
        if (_processingDurationTimer) return;
        _processingDurationTimer = setInterval(updateProcessingDuration, 1000);
    }

    function stopDurationTicker() {
        if (_processingDurationTimer) {
            clearInterval(_processingDurationTimer);
            _processingDurationTimer = null;
        }
    }

    async function loadTaskQueue() {
        try {
            const res = await fetch('/api/queue');
            const json = await res.json();
            if (!json.ok || !json.submissions) {
                if (queueEmpty) queueEmpty.hidden = false;
                queueList.hidden = true;
                queueCount.textContent = '0';
                if (processingEmpty) processingEmpty.hidden = false;
                if (processingTask) processingTask.hidden = true;
                return;
            }

            const allTasks = json.submissions.filter(function(t) {
                if (!t || t.archived) return false;
                const productName = t.data && t.data.basicInfo && t.data.basicInfo['\u578b\u53f7'];
                return Boolean(String(productName || t.taskType || '').trim());
            });
            const processingTasks = allTasks.filter(t => t.status === 'processing');
            const pendingTasks = allTasks.filter(t => !t.status || t.status === 'pending');

            // Show processing task
            if (processingTasks.length > 0 && processingTask) {
                const task = processingTasks[0];
                const taskName = (task.data && task.data.basicInfo && task.data.basicInfo['\u578b\u53f7']) || task.taskType || 'Task';
                const nameEl = processingTask.querySelector('.processing-task-name');
                if (nameEl) {
                    var submitter = task.submitter || {};
                    var avatar = submitter.avatar || '';
                    var sname = submitter.name || '';
                    var submitterHtml = sname ? '<span style="font-size:0.85rem;color:#6b7280;font-weight:500;display:inline-flex;align-items:center;gap:5px;margin-left:10px">' + (avatar ? '<img src="' + avatar + '" style="width:18px;height:18px;border-radius:50%;vertical-align:middle">' : '') + '<span>' + sname + '</span></span>' : '';
                    nameEl.innerHTML = '<span>' + taskName + '</span>' + submitterHtml;
                }
                processingStartTime = task.processingStartTime || (task.createdAt ? new Date(task.createdAt).getTime() : null);
                if (processingStartTime) {
                    updateProcessingDuration();
                    startDurationTicker();
                } else {
                    stopDurationTicker();
                    if (processingDuration) processingDuration.textContent = '-';
                }
                if (task.eta && processingEta) processingEta.textContent = task.eta;
                else if (processingEta) processingEta.textContent = '-';
                processingTask.hidden = false;
                if (processingEmpty) processingEmpty.hidden = true;
            } else {
                if (processingTask) processingTask.hidden = true;
                if (processingEmpty) processingEmpty.hidden = false;
                processingStartTime = null;
                stopDurationTicker();
            }

            // Show pending queue
            if (pendingTasks.length === 0) {
                if (queueEmpty) queueEmpty.hidden = false;
                queueList.hidden = true;
                queueCount.textContent = '0';
                return;
            }

            queueCount.textContent = pendingTasks.length;
            if (queueEmpty) queueEmpty.hidden = true;
            queueList.hidden = false;
            var queueCounters = { A: 0, B: 0 };
            queueList.innerHTML = pendingTasks.slice(0, 10).map(function(task) {
                var dateSource = task.createdAt || task.timestamp;
                var date = dateSource ? new Date(dateSource) : null;
                var dateText = date && Number.isFinite(date.getTime())
                    ? new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit' }).format(date).replace(/-/g, '/')
                    : '--/--';
                var queuePrefix = String(task.taskType || '').includes('视频') ? 'B' : 'A';
                queueCounters[queuePrefix] += 1;
                var queueNumber = queuePrefix + String(queueCounters[queuePrefix]).padStart(2, '0');
                var submitter = task.submitter && task.submitter.name ? String(task.submitter.name).trim() : '匿名';
                var avatar = task.submitter && task.submitter.avatar ? String(task.submitter.avatar).trim() : '';
                var taskName = (task.data && task.data.basicInfo && task.data.basicInfo['\u578b\u53f7']) || task.taskType || '未命名任务';
                var taskTypes = String(task.taskType || '未分类').split(/\s*-\s*/).filter(Boolean);
                var typeHtml = taskTypes.map(function(type, typeIndex) {
                    return '<span class="queue-item-type' + (typeIndex === 0 ? ' is-primary' : '') + '">' + queueEscape(type) + '</span>';
                }).join('');
                var initial = Array.from(submitter).slice(-2).join('') || '用户';
                var avatarHtml = avatar
                    ? '<img class="queue-item-avatar" src="' + queueEscape(avatar) + '" alt="' + queueEscape(submitter) + '的头像" loading="lazy">'
                    : '<span class="queue-item-avatar queue-item-avatar-fallback" aria-label="' + queueEscape(submitter) + '">' + queueEscape(initial) + '</span>';
                var etaText = task.eta ? '预计 ' + String(task.eta) : '排队中';
                return '<div class="queue-item">'
                    + '<time class="queue-item-time">' + queueEscape(dateText) + '</time>'
                    + avatarHtml
                    + '<div class="queue-item-body">'
                    + '<div class="queue-item-task" title="' + queueEscape(taskName) + '">' + queueEscape(taskName) + '</div>'
                    + '<div class="queue-item-meta"><span class="queue-item-types">' + typeHtml + '</span><span class="queue-item-submitter">' + queueEscape(submitter) + '</span></div>'
                    + '</div>'
                    + '<div class="queue-item-ticket"><strong>' + queueNumber + '</strong><small>' + queueEscape(etaText) + '</small></div>'
                    + '<span class="queue-item-chevron" aria-hidden="true">›</span>'
                    + '</div>';
            }).join('');
        } catch (err) {
            console.error('Queue load failed:', err);
            if (queueEmpty) queueEmpty.hidden = false;
            queueList.hidden = true;
            if (processingEmpty) processingEmpty.hidden = false;
            if (processingTask) processingTask.hidden = true;
        }
    }

    function queueEscape(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Load once on page load, no auto-refresh
    // Initial load
    loadTaskQueue();

    // Manual refresh button
    const refreshBtn = document.getElementById('queueRefreshBtn');
    if (refreshBtn) {
        refreshBtn.onclick = function() {
            refreshBtn.disabled = true;
            const original = refreshBtn.innerHTML;
            refreshBtn.innerHTML = '...';
            loadTaskQueue().finally(function() {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = original;
            });
        };
    }

    // Auto refresh every 30s, only Mon-Sat 8:00-18:00
    let lastKnownTs = '0';
    function isWorkingHours() {
        const now = new Date();
        const day = now.getDay();
        const hour = now.getHours();
        if (day === 0) return false;
        return hour >= 8 && hour < 18;
    }
    async function checkForUpdates() {
        if (!isWorkingHours()) return;
        try {
            const res = await fetch('/api/check-update');
            const json = await res.json();
            if (json.ts !== '0' && json.ts !== lastKnownTs && lastKnownTs !== '0') {
                loadTaskQueue();
            }
            lastKnownTs = json.ts;
        } catch(e) {}
    }
    checkForUpdates();
    setInterval(checkForUpdates, 1200000);
})();
