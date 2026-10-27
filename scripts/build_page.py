"""Assemble public/index.html from src/shell.html + src/page.html (the leaderboard page itself)."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
shell = open(os.path.join(ROOT, 'src', 'shell.html'), encoding='utf-8').read()
page = open(os.path.join(ROOT, 'src', 'page.html'), encoding='utf-8').read()
open(os.path.join(ROOT, 'public', 'index.html'), 'w', encoding='utf-8').write(shell.replace('<!--PAGE-->', page))
print('wrote public/index.html')
