import re

with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace the entire modal content
old_modal = '''    <div id="loginModal" class="modal" hidden>
        <div class="modal-content">
            <button class="modal-close" id="modalClose">×</button>
            <h3>登录</h3>
            <a href="/api/dingtalk-auth" class="btn-dingtalk-qr">
                <svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect width="64" height="64" rx="14" fill="white"/>
                    <path d="M32 8C18.745 8 8 18.745 8 32C8 45.255 18.745 56 32 56C45.255 56 56 45.255 56 32C56 18.745 45.255 8 32 8ZM42.5 36.5C41.2 38.8 38.5 40 35.5 40H28.5C25.5 40 22.8 38.8 21.5 36.5C20.5 34.8 20.5 32.5 21.5 30.8L27.5 20.5C28.2 19.2 29.6 18.5 31 18.5C32.4 18.5 33.8 19.2 34.5 20.5L38 26.5H35.5L32 20.5L26 30.5H38C38.8 30.5 39.5 31.2 39.5 32C39.5 32.8 38.8 33.5 38 33.5H24.5L23.5 35.5C24.5 36.8 26.3 37.5 28.2 37.5H35.5C37.5 37.5 39.3 36.8 40.2 35.5L42.5 36.5Z" fill="#0089FF"/>
                </svg>
                使用钉钉登录
            </a>
            <div class="login-or">或</div>
            <button id="skipLoginBtn" class="btn-skip-login">跳过，直接使用</button>
            <p class="login-hint">登录后可记录提交人信息</p>
        </div>
    </div>'''

new_modal = '''    <div id="loginModal" class="modal" hidden>
        <div class="modal-content">
            <button class="modal-close" id="modalClose">×</button>
            <h3>需要登录</h3>
            <p style="color:#6b7280;font-size:0.9rem;margin-bottom:20px;text-align:center">提交需求前请先登录钉钉</p>
            <a href="/api/dingtalk-auth" class="btn-dingtalk-qr">
                <svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect width="64" height="64" rx="14" fill="white"/>
                    <path d="M32 8C18.745 8 8 18.745 8 32C8 45.255 18.745 56 32 56C45.255 56 56 45.255 56 32C56 18.745 45.255 8 32 8ZM42.5 36.5C41.2 38.8 38.5 40 35.5 40H28.5C25.5 40 22.8 38.8 21.5 36.5C20.5 34.8 20.5 32.5 21.5 30.8L27.5 20.5C28.2 19.2 29.6 18.5 31 18.5C32.4 18.5 33.8 19.2 34.5 20.5L38 26.5H35.5L32 20.5L26 30.5H38C38.8 30.5 39.5 31.2 39.5 32C39.5 32.8 38.8 33.5 38 33.5H24.5L23.5 35.5C24.5 36.8 26.3 37.5 28.2 37.5H35.5C37.5 37.5 39.3 36.8 40.2 35.5L42.5 36.5Z" fill="#0089FF"/>
                </svg>
                使用钉钉登录
            </a>
        </div>
    </div>'''

html = html.replace(old_modal, new_modal)

with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('HTML updated - removed skip button')
