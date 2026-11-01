"""Rebuild the site's data from pssbl.com.

    python scripts/update.py            refresh the latest season (re-downloads it), rebuild everything
    python scripts/update.py --all      first run on a new computer: download every season 2015-now (~10 min)
    python scripts/update.py --offline  rebuild from what's already in raw/ without downloading

Online runs finish with scripts/verify.py (spot-check against pssbl.com) and stop if it finds a mismatch.
Then commit and push; GitHub Pages redeploys the site from main automatically.
"""
import collections, csv, datetime, glob, json, os, runpy, shutil, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch  # noqa: E402
from common import ROOT, RAW, BUILD, DATA, FIRST  # noqa: E402
args = set(sys.argv[1:])
this_year = time.localtime().tm_year

if '--offline' not in args:
    if '--all' in args:
        for y in range(FIRST, this_year + 1):
            fetch.season(y, refresh=(y >= this_year - 1))
    else:
        have = sorted({int(f[-9:-5]) for f in glob.glob(f'{RAW}/TeamNames_*.json')})
        if len(have) < 3:
            sys.exit('raw/ is empty or partial - run:  python scripts/update.py --all')
        # refresh the newest season that has games (this year if it has started, else last year)
        target = this_year if fetch.season(this_year, refresh=True) else this_year - 1
        if target != this_year and not fetch.FAILED:
            fetch.season(target, refresh=True)
    if fetch.FAILED:  # a failed TeamNames would even pick the wrong season; don't publish stale or partial data
        sys.exit(f'{len(fetch.FAILED)} pssbl.com requests failed (first: {fetch.FAILED[0]}) - nothing published; run it again')

os.makedirs(BUILD, exist_ok=True)
print('computing stats...')
runpy.run_path(os.path.join(ROOT, 'scripts', 'compute.py'), run_name='__main__')
print('building box-score files...')
runpy.run_path(os.path.join(ROOT, 'scripts', 'build_box.py'), run_name='__main__')

# publish into public/data: the latest season and the history are separate files so the
# default view loads fast; older seasons, careers and box scores load only when asked for.
# Everything is written to build/publish first and swapped in only once it's all there, so a crash part-way never
# leaves public/data with a manifest that names missing files.
with open(f'{BUILD}/pssbl_guts.json', encoding='utf-8') as f:
    guts = json.load(f)
latest = max(g['Season'] for g in guts)
lede = []
STAGE = os.path.join(BUILD, 'publish')
shutil.rmtree(STAGE, ignore_errors=True)
os.makedirs(STAGE)
manifest = {'updated': datetime.date.today().isoformat(), 'version': datetime.datetime.now().strftime('%Y%m%d%H%M%S'),
            'latest': latest, 'datasets': {}}
for kind, src in (('batting', 'pssbl_batting.csv'), ('pitching', 'pssbl_pitching.csv')):
    with open(f'{BUILD}/{src}', encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    cols = list(rows[0].keys())
    # the front page's one line of news: the latest season's top hitter by oWAR and pitcher by WAR (first in file order
    # on a tie, like the page), so the default view doesn't need every pitching line
    stat, top = ('oWAR' if kind == 'batting' else 'WAR'), None
    for r in rows:
        if r['Season'] == str(latest) and r[stat] != '' and (top is None or float(r[stat]) > float(top[stat])): top = r
    if top:
        lede.append({'key': kind[:3], 'Season': latest, 'pid': top['pid'], 'Name': top['Name'], 'Team': top['Team'],
                     'Division': top['Division'], stat: float(top[stat])})
    for suffix, keep in (('current', lambda r: r['Season'] == str(latest)), ('history', lambda r: r['Season'] != str(latest))):
        name = f'{kind}_{suffix}.csv'
        with open(f'{STAGE}/{name}', 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, cols); w.writeheader(); w.writerows(r for r in rows if keep(r))
        manifest['datasets'][kind + ('' if suffix == 'current' else '_hist')] = name
with open(f'{STAGE}/lede.json', 'w', encoding='utf-8') as f:
    json.dump(lede, f, separators=(',', ':'))
manifest['datasets']['lede'] = 'lede.json'
for ds, src, name in (('bat_career', 'pssbl_batting_career.csv', 'batting_career.csv'),
                      ('pit_career', 'pssbl_pitching_career.csv', 'pitching_career.csv'),
                      ('standings', 'pssbl_standings.json', 'standings.json'),
                      ('games', 'pssbl_games.csv', 'games.csv')):
    shutil.copy(f'{BUILD}/{src}', f'{STAGE}/{name}')
    manifest['datasets'][ds] = name
# box scores by month (box_2026_05 = May 2026): a box score or a date range loads a month or two, not the season.
# Each season's guts rows list its months (BoxMonths) so the page knows which files exist.
months = collections.defaultdict(list)
for f in sorted(glob.glob(f'{BUILD}/pssbl_box_*.csv')):
    y = int(f[-8:-4])
    with open(f, encoding='utf-8', newline='') as src:
        rd = csv.DictReader(src)
        by = collections.defaultdict(list)
        for r in rd: by[int(r['Date'][5:7])].append(r)
    for m, rows in sorted(by.items()):
        name = f'box_{y}_{m:02d}'
        with open(f'{STAGE}/{name}.csv', 'w', newline='', encoding='utf-8') as out:
            w = csv.DictWriter(out, rd.fieldnames); w.writeheader(); w.writerows(rows)
        manifest['datasets'][name] = name + '.csv'
        months[y].append(m)
for g in guts:
    g['BoxMonths'] = months.get(g['Season'], [])
with open(f'{STAGE}/guts.json', 'w', encoding='utf-8') as f:
    json.dump(guts, f, separators=(',', ':'))
manifest['datasets']['guts'] = 'guts.json'

# The Players page reads one player at a time, so each player's lines also go in two small files shared with the
# players whose id ends in the same two digits: player_07 (every pid ending in 07) has the finished seasons, so it stays
# the same all season long; playernow_07 has the latest season and the career rows, the part each update changes.
# Rows: season lines ('bat', 'pit'; history then current, as in those files), career rows ('bc', 'pc') and box-score
# lines ('log') with the game's teams and score joined on. Empty cells and the columns the game log never shows are
# left out. players.csv is the slim index the player search reads.
def bucket(pid):
    return f"{int(pid) % 100 if pid.isdigit() else 0:02d}"
def read_csv(path):
    with open(path, encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f))
buckets = {f'{set_}_{n:02d}': [] for set_ in ('player', 'playernow') for n in range(100)}
def put(t, r, now, extra=None, skip=()):
    o = {'t': t, **{k: v for k, v in r.items() if v != '' and k not in skip}, **(extra or {})}
    buckets[f"{'playernow' if now else 'player'}_{bucket(r['pid'])}"].append(o)
for t, kind in (('bat', 'batting'), ('pit', 'pitching')):
    for suffix in ('history', 'current'):
        for r in read_csv(f'{STAGE}/{kind}_{suffix}.csv'): put(t, r, suffix == 'current')
careers = {t: read_csv(f'{STAGE}/{kind}_career.csv') for t, kind in (('bc', 'batting'), ('pc', 'pitching'))}
for t, rows in careers.items():
    for r in rows: put(t, r, True)
games = {g['gameId']: g for g in read_csv(f'{BUILD}/pssbl_games.csv')}
for f in sorted(glob.glob(f'{BUILD}/pssbl_box_*.csv')):
    for r in read_csv(f):
        g = games.get(r['gameId'])
        put('log', r, int(r['Season']) == latest, {k: g[k] for k in ('home', 'hr', 'ar', 'homeName', 'awayName')} if g else None,
            skip=('Name', 'Division', 'Ord', 'sW', 'sL', 'sSV'))
for name, rows in buckets.items():
    with open(f'{STAGE}/{name}.json', 'w', encoding='utf-8') as f:
        json.dump(rows, f, separators=(',', ':'), ensure_ascii=False)
    manifest['datasets'][name] = name + '.json'
index, first = {}, {}
for r in careers['bc']: index[r['pid']] = r
for r in careers['pc']:
    if r['pid'] not in index or int(r['To']) > int(index[r['pid']]['To']): index[r['pid']] = r
for r in careers['bc'] + careers['pc']: first[r['pid']] = min(first.get(r['pid'], 9999), int(r['From']))
with open(f'{STAGE}/players.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['pid', 'Name', 'Team', 'Division', 'From', 'To'])
    for pid, r in index.items(): w.writerow([pid, r['Name'], r['Team'], r['Division'], first[pid], r['To']])
manifest['datasets']['players'] = 'players.csv'
with open(f'{STAGE}/manifest.json', 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=1)
# division offsets + regression constants for the Players page projection (reads the data, adds itself to the manifest)
# (called, not run as __main__: its sys.exit(main()) used to end update.py right here, before build_page and verify)
os.environ['PSSBL_DATA'] = STAGE
runpy.run_path(os.path.join(ROOT, 'scripts', 'translate.py'), run_name='translate')['main']()
os.makedirs(DATA, exist_ok=True)
for old in glob.glob(f'{DATA}/*'):
    os.remove(old)
for f in os.listdir(STAGE):
    os.replace(os.path.join(STAGE, f), os.path.join(DATA, f))
os.rmdir(STAGE)
runpy.run_path(os.path.join(ROOT, 'scripts', 'build_page.py'), run_name='__main__')
if '--offline' not in args:
    # counting stats must match pssbl.com's own career pages; stop here rather than push bad data
    if subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'verify.py')]).returncode:
        sys.exit('verify.py found mismatches with pssbl.com - fix before pushing')
print(f'done: {len(manifest["datasets"])} data files, latest season {latest}. Now commit and push.')
