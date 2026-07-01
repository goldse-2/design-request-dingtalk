import re

with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\app.js', 'r', encoding='utf-8') as f:
    js = f.read()

# Fix 1: Remove loginBtn const declaration
js = js.replace("const loginBtn    = document.getElementById('loginBtn');\n", "")

# Fix 2: In setUser, don't reference loginBtn
js = js.replace("    loginBtn.hidden = true;\n", "")

# Fix 3: In clearUser, don't reference loginBtn  
js = js.replace("    loginBtn.hidden = false;\n", "")

# Fix 4: close the dangling }); on doSubmit - the old listener's closing brace
# The doSubmit function ends properly, but the old submitBtn listener left an extra });
js = js.replace(
    "        submitBtn.disabled = false;\n    }\n});\n\nfunction setStatus",
    "        submitBtn.disabled = false;\n    }\n}\n\nfunction setStatus"
)

with open(r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\app.js', 'w', encoding='utf-8') as f:
    f.write(js)

print("loginBtn removed:", "loginBtn" not in js)
print("doSubmit closes properly:", "}\n\nfunction setStatus" in js)
