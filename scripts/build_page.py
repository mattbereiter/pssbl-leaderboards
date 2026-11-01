"""Assemble public/index.html from src/shell.html + src/page.html (the leaderboard page itself)."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def read(*p):
    with open(os.path.join(ROOT, *p), encoding='utf-8') as f:
        return f.read()

with open(os.path.join(ROOT, 'public', 'index.html'), 'w', encoding='utf-8') as f:
    f.write(read('src', 'shell.html').replace('<!--PAGE-->', read('src', 'page.html')))
print('wrote public/index.html')
