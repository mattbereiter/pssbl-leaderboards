"""Rebuild the site's data from pssbl.com.

    python scripts/update.py            refresh the latest season (re-downloads it), rebuild everything
    python scripts/update.py --all      first run on a new computer: download every season 2015-now (~10 min)
    python scripts/update.py --offline  rebuild from what's already in raw/ without downloading

Then commit and push; Netlify redeploys the site automatically.
"""
import csv, datetime, glob, json, os, runpy, shutil, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import fetch  # noqa: E402

RAW, BUILD, DATA = (os.path.join(ROOT, d) for d in ('raw', 'build', os.path.join('public', 'data')))
FIRST = 2015
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
        if target != this_year:
            fetch.season(target, refresh=True)

os.makedirs(BUILD, exist_ok=True)
print('computing stats...')
runpy.run_path(os.path.join(ROOT, 'scripts', 'compute.py'), run_name='__main__')
print('building box-score files...')
runpy.run_path(os.path.join(ROOT, 'scripts', 'build_box.py'), run_name='__main__')

# publish into public/data: the latest season and the history are separate files so the
# default view loads fast; older seasons, careers and box scores load only when asked for.
guts = json.load(open(f'{BUILD}/pssbl_guts.json'))
latest = max(g['Season'] for g in guts)
os.makedirs(DATA, exist_ok=True)
for old in glob.glob(f'{DATA}/*'):
    os.remove(old)
manifest = {'updated': datetime.date.today().isoformat(), 'latest': latest, 'datasets': {}}
for kind, src in (('batting', 'pssbl_batting.csv'), ('pitching', 'pssbl_pitching.csv')):
    rows = list(csv.DictReader(open(f'{BUILD}/{src}')))
    cols = list(rows[0].keys())
    for suffix, keep in (('current', lambda r: r['Season'] == str(latest)), ('history', lambda r: r['Season'] != str(latest))):
        name = f'{kind}_{suffix}.csv'
        with open(f'{DATA}/{name}', 'w', newline='') as f:
            w = csv.DictWriter(f, cols); w.writeheader(); w.writerows(r for r in rows if keep(r))
        manifest['datasets'][kind + ('' if suffix == 'current' else '_hist')] = name
for ds, src, name in (('bat_career', 'pssbl_batting_career.csv', 'batting_career.csv'),
                      ('pit_career', 'pssbl_pitching_career.csv', 'pitching_career.csv'),
                      ('standings', 'pssbl_standings.json', 'standings.json'),
                      ('guts', 'pssbl_guts.json', 'guts.json')):
    shutil.copy(f'{BUILD}/{src}', f'{DATA}/{name}')
    manifest['datasets'][ds] = name
for f in sorted(glob.glob(f'{BUILD}/pssbl_box_*.csv')):
    y = f[-8:-4]
    shutil.copy(f, f'{DATA}/box_{y}.csv')
    manifest['datasets'][f'box_{y}'] = f'box_{y}.csv'
json.dump(manifest, open(f'{DATA}/manifest.json', 'w'), indent=1)
runpy.run_path(os.path.join(ROOT, 'scripts', 'build_page.py'), run_name='__main__')
print(f'done: {len(manifest["datasets"])} data files, latest season {latest}. Now commit and push.')
