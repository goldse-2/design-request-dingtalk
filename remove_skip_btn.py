with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\app.js', 'r', encoding='utf-8') as f:
    js = f.read()

# Remove skipLoginBtn const declaration
js = js.replace("const skipLoginBtn = document.getElementById('skipLoginBtn');\n", '')

# Remove the skipLoginBtn event listener (multiline)
old_listener = """skipLoginBtn.addEventListener('click', () => {
    loginModal.hidden = true;
    doSubmit();
});"""

js = js.replace(old_listener + '\n', '')

with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\app.js', 'w', encoding='utf-8') as f:
    f.write(js)

print('skipLoginBtn removed:', 'skipLoginBtn' not in js)
