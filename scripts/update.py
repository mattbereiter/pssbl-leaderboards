"""Rebuild the site's data from pssbl.com.

    python scripts/update.py            refresh the latest season (re-downloads it), rebuild everything
    python scripts/update.py --all      first run on a new computer: download every season 2015-now (~10 min)
    python scripts/update.py --offline  rebuild from what's already in raw/ without downloading

Online runs finish with scripts/verify.py (spot-check against pssbl.com) and stop if it finds a mismatch.
Then commit and push; GitHub Pages redeploys the site from main automatically.
"""
import csv, datetime, glob, json, os, runpy, shutil, subprocess, sys, time

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
import common  # noqa: E402
common.box_lines.cache_clear()  # about 180 MB of box lines; nothing after this needs them

# publish into public/data: the latest season and the history are separate files so the
# default view loads fast; older seasons, careers and box scores load only when asked for.
# Everything is written to build/publish first and swapped in only once it's all there, so a crash part-way never
# leaves public/data with a manifest that names missing files.
with open(f'{BUILD}/pssbl_guts.json', encoding='utf-8') as f:
    guts = json.load(f)
latest = max(g['Season'] for g in guts)
STAGE = os.path.join(BUILD, 'publish')
shutil.rmtree(STAGE, ignore_errors=True)
os.makedirs(STAGE)
manifest = {'updated': datetime.date.today().isoformat(), 'version': datetime.datetime.now().strftime('%Y%m%d%H%M%S'),
            'latest': latest, 'datasets': {}}
for kind, src in (('batting', 'pssbl_batting.csv'), ('pitching', 'pssbl_pitching.csv')):
    with open(f'{BUILD}/{src}', encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    cols = list(rows[0].keys())
    for suffix, keep in (('current', lambda r: r['Season'] == str(latest)), ('history', lambda r: r['Season'] != str(latest))):
        name = f'{kind}_{suffix}.csv'
        with open(f'{STAGE}/{name}', 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, cols); w.writeheader(); w.writerows(r for r in rows if keep(r))
        manifest['datasets'][kind + ('' if suffix == 'current' else '_hist')] = name
for ds, src, name in (('bat_career', 'pssbl_batting_career.csv', 'batting_career.csv'),
                      ('pit_career', 'pssbl_pitching_career.csv', 'pitching_career.csv'),
                      ('standings', 'pssbl_standings.json', 'standings.json'),
                      ('guts', 'pssbl_guts.json', 'guts.json'),
                      ('games', 'pssbl_games.csv', 'games.csv')):
    shutil.copy(f'{BUILD}/{src}', f'{STAGE}/{name}')
    manifest['datasets'][ds] = name
for f in sorted(glob.glob(f'{BUILD}/pssbl_box_*.csv')):
    y = f[-8:-4]
    shutil.copy(f, f'{STAGE}/box_{y}.csv')
    manifest['datasets'][f'box_{y}'] = f'box_{y}.csv'
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
