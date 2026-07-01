with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Remove the login button from header
btn = '                <button id="loginBtn" class="btn-login">钉钉登录</button>\n'
html = html.replace(btn, '')

# Update the modal hint text
html = html.replace(
    '<p class="login-hint">跳过后提交记录不显示提交人信息</p>',
    '<p class="login-hint">登录后可记录提交人信息</p>'
)

with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('loginBtn removed:', 'id="loginBtn"' not in html)
