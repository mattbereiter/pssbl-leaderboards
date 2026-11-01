"""Download PSSBL data from pssbl.com's public stats API into raw/ (a local cache, not committed).

For each season: team list, then per division the cumulative batting, pitching and game results,
then every finished game's box score and every team's roster (birth dates, for ages).
Seasons named in `refresh` are re-downloaded even if cached, since the league keeps correcting box scores and team assignments after games are played.
"""
import json, os, sys, time, urllib.request, concurrent.futures as cf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'raw')
API = 'https://pssbl.com/PHP/fetchData.php?'
WORKERS = 6  # be gentle with the league's server
FAILED = []  # queries that never gave a usable answer this run; update.py stops if there are any

def fix_text(s):
    """Undo pssbl.com's double-encoded UTF-8 (it sends 'JosÃ©' for 'José'). Correct text passes through."""
    if 'Ã' in s or 'Â' in s or 'â€' in s:
        try: return s.encode('cp1252').decode('utf-8')
        except UnicodeError: pass
    return s

def _fix(x):
    if isinstance(x, str): return fix_text(x)
    if isinstance(x, list): return [_fix(v) for v in x]
    if isinstance(x, dict): return {k: _fix(v) for k, v in x.items()}
    return x

def load(path):
    """Read a cached API file. Always UTF-8: Windows' default (cp1252) can't decode what pssbl.com sends."""
    with open(path, encoding='utf-8') as f:
        return _fix(json.load(f))

def get(query, path, force=False):
    """One API answer (a JSON list), from the cache unless `force`. A cached `[]` counts: it's a real empty answer.

    Only a list is cached, and it's written to a temp file first, so a junk answer (`null`, an error object) or an
    interrupted run never leaves a file that every later run would trust. A cache file that won't parse is fetched
    again. If every try fails, the query goes on FAILED and the old cache (if any) is left as it was.
    """
    if not force and os.path.exists(path):
        try:
            data = load(path)
            if isinstance(data, list):
                return data
        except ValueError:
            pass  # cut off mid-write by an older run: download it again
    for attempt in range(4):
        try:
            with urllib.request.urlopen(API + query, timeout=60) as r:
                body = r.read()
            data = json.loads(body or b'[]')
            if not isinstance(data, list):
                raise ValueError(f'unexpected answer {body[:80]!r}')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path + '.tmp', 'wb') as f:
                f.write(body)
            os.replace(path + '.tmp', path)
            return _fix(data)
        except Exception as e:  # network blip or junk answer: retry, then give up on this file
            if attempt == 3:
                print(f'  ! {query}: {e}', file=sys.stderr)
                FAILED.append(query)
                return []
            time.sleep(2 * (attempt + 1))

def season(year, refresh=False):
    teams = get(f'type=TeamNames&year={year}', f'{RAW}/TeamNames_{year}.json', refresh)
    divisions = sorted({t['divisionName'] for t in teams})
    if not divisions:
        print(f'{year}: no teams on pssbl.com yet'); return 0
    jobs = [(f'type={t}&division={d}&year={year}', f'{RAW}/{t}_{d}_{year}.json')
            for d in divisions for t in ('CumulativeBatting', 'CumulativePitching', 'Games')]
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        results = list(ex.map(lambda j: get(*j, force=refresh), jobs))
    games = {g['gameId'] for (q, _), res in zip(jobs, results) if 'type=Games' in q for g in res if g.get('outcome') == 'finished'}
    box = [(f'type={t}&gameId={g}', f'{RAW}/box/{t}_{g}.json') for g in sorted(games) for t in ('BattingStats', 'PitchingStats')]
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(lambda j: get(*j, force=refresh), box))
    rosters(year, teams, refresh)
    print(f'{year}: {len(divisions)} divisions, {len(games)} finished games')
    return len(games)

def rosters(year, teams=None, refresh=False):
    """Each team's roster (team ids are unique per season). Old seasons' rosters still answer, with birth dates."""
    teams = teams if teams is not None else load(f'{RAW}/TeamNames_{year}.json')
    jobs = [(f"type=Roster&teamId={t['teamId']}", f"{RAW}/roster/Roster_{t['teamId']}.json") for t in teams]
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(lambda j: get(*j, force=refresh), jobs))

if __name__ == '__main__':
    if sys.argv[1:2] == ['--rosters']:  # backfill rosters for cached seasons, fetching only what's missing
        for f in sorted(os.listdir(RAW)):
            if f.startswith('TeamNames_'):
                rosters(int(f[-9:-5])); print('rosters', f[-9:-5])
        sys.exit()
    years = [int(a) for a in sys.argv[1:]] or [time.localtime().tm_year]
    for y in years:
        season(y, refresh=True)
