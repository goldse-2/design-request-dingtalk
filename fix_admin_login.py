with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\admin.js', 'r', encoding='utf-8') as f:
    js = f.read()

# Fix: move filterSelect listener inside showAdmin so it's only bound when elements exist
old = """filterSelect.addEventListener('change', loadSubmissions);

checkAuth();"""

new = """checkAuth();"""

js = js.replace(old, new)

# Now add the listener inside showAdmin function
old_show = """function showAdmin() {
    authWall.hidden = true;
    adminMain.hidden = false;
    loadSubmissions();
}"""

new_show = """function showAdmin() {
    authWall.hidden = true;
    adminMain.hidden = false;
    filterSelect.addEventListener('change', loadSubmissions);
    loadSubmissions();
}"""

js = js.replace(old_show, new_show)

with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\admin.js', 'w', encoding='utf-8') as f:
    f.write(js)

print('admin.js fixed')
