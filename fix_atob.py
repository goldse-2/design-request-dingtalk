with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\app.js', 'r', encoding='utf-8') as f:
    js = f.read()

old = "            const user = JSON.parse(atob(session));"
new = "            const user = JSON.parse(decodeURIComponent(escape(atob(session))));"
js = js.replace(old, new)

with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\app.js', 'w', encoding='utf-8') as f:
    f.write(js)

print('fixed:', 'decodeURIComponent(escape(atob' in js)
