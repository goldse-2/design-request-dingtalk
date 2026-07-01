with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\index.html', 'r', encoding='utf-8') as f:
    html = f.read()

old = '<div class="modal-overlay" id="modalOverlay"></div>\n        '
html = html.replace(old, '')

with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('Done. overlay removed:', 'modal-overlay' not in html)
