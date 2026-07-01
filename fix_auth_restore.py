with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\app.js', 'r', encoding='utf-8') as f:
    js = f.read()

old = """function initAuth() {
    const params = new URLSearchParams(window.location.search);

    const session = params.get('session');
    if (session) {
        try {
            const user = JSON.parse(atob(session));
            setUser(user);
            sessionStorage.setItem('dt_user', JSON.stringify(user));
        } catch {}
        // clean the URL
        const clean = window.location.pathname;
        window.history.replaceState({}, '', clean);
        return;
    }

    const authError = params.get('auth_error');
    if (authError) {
        alert('\\u9489\\u9489\\u767b\\u5f55\\u5931\\u8d25\\uff1a' + decodeURIComponent(authError));
        window.history.replaceState({}, '', window.location.pathname);
    }

    const stored = sessionStorage.getItem('dt_user');
    if (stored) {
        try { setUser(JSON.parse(stored)); } catch {}
    }
}"""

# Find and replace using index
idx = js.find('function initAuth()')
end = js.find('\n}', idx) + 2

old_block = js[idx:end]
print('Found block:')
print(repr(old_block[:100]))

new_block = """function initAuth() {
    const params = new URLSearchParams(window.location.search);

    const session = params.get('session');
    if (session) {
        try {
            const user = JSON.parse(atob(session));
            setUser(user);
            sessionStorage.setItem('dt_user', JSON.stringify(user));
        } catch {}
        window.history.replaceState({}, '', window.location.pathname);
        restorePendingForm();
        return;
    }

    const authError = params.get('auth_error');
    if (authError) {
        alert('\u9489\u9489\u767b\u5f55\u5931\u8d25\uff1a' + decodeURIComponent(authError));
        window.history.replaceState({}, '', window.location.pathname);
        restorePendingForm();
    }

    const stored = sessionStorage.getItem('dt_user');
    if (stored) {
        try { setUser(JSON.parse(stored)); } catch {}
    }
}

function savePendingForm() {
    if (!parsedData) return;
    try {
        const save = {
            parsedData,
            taskType: taskType.value,
            remarks: remarks.value,
            urgent: urgentCheck.checked
        };
        sessionStorage.setItem('pending_form', JSON.stringify(save));
    } catch (e) {
        // parsedData may contain image data too large for sessionStorage; strip images
        try {
            const stripped = JSON.parse(JSON.stringify(parsedData));
            stripped.images = stripped.images.map(img => {
                const { imageData, imageData2, ...rest } = img;
                return rest;
            });
            sessionStorage.setItem('pending_form', JSON.stringify({
                parsedData: stripped,
                taskType: taskType.value,
                remarks: remarks.value,
                urgent: urgentCheck.checked
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
        urgentCheck.checked = !!saved.urgent;
        if (urgentCheck.checked) {
            urgentRow.classList.add('active');
            urgentDesc.textContent = '\u5f00\u542f';
            submitBtn.classList.add('urgent');
            submitBtn.textContent = '\U0001f534 \u52a0\u6025\u63d0\u4ea4';
        }
        if (parsedData) {
            fileNameEl.textContent = parsedData.fileName || '';
            uploadEmpty.hidden = true;
            uploadFilled.hidden = false;
            renderPreview();
            updateSubmitState();
        }
    } catch {}
}"""

js = js[:idx] + new_block + js[end:]

with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\app.js', 'w', encoding='utf-8') as f:
    f.write(js)

print('Done. initAuth replaced, savePendingForm added.')
