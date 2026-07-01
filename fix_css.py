import re

path = r'C:\Users\Administrator\Desktop\ai-image-prompt-gen\style.css'
with open(path, encoding='utf-8') as f:
    content = f.read()

content = content.replace('`n', '\n')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('done')
