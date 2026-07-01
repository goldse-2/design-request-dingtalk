with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Add onclick to the dingtalk login link to save form data before redirect
html = html.replace(
    '<a href="/api/dingtalk-auth" class="btn-dingtalk-qr">',
    '<a href="/api/dingtalk-auth" class="btn-dingtalk-qr" onclick="savePendingForm()">'
)

with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('Done:', 'savePendingForm' in html)
