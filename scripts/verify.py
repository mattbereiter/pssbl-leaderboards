"""Check public/data against pssbl.com: counting stats must match CareerBatting / CareerPitching exactly.

    python scripts/verify.py           20 random players + Matt, latest season and history
    python scripts/verify.py 80        a bigger sample
    python scripts/verify.py --seed 7  repeatable sample

Each player-season is summed across all of a player's team lines (fill-ins included) and compared with
pssbl.com's per-year totals. Exits 1 on any mismatch, so update.py stops before you push bad data.
"""
import csv, json, os, random, sys, urllib.request, concurrent.futures as cf

from common import DATA
from fetch import API
MATT = '8048'
WORKERS = 4  # be gentle with the league's server

# our column -> pssbl.com field
BAT = {'AB': 'ab', 'R': 'r', 'H': 'h', '2B': 'd', '3B': 't', 'HR': 'hr', 'RBI': 'rbi', 'SB': 'sb', 'CS': 'cs',
       'BB': 'bb', 'SO': 'so', 'GDP': 'gdp', 'HBP': 'hbp', 'SH': 'sh', 'SF': 'sf', 'IBB': 'ibb'}
PIT = {'W': 'w', 'L': 'l', 'SV': 'sv', 'GS': 'gs', 'CG': 'cg', 'Outs': 'outs', 'H': 'h', 'R': 'r', 'ER': 'er',
       'HR': 'hr', 'BB': 'bb', 'IBB': 'ibb', 'SO': 'so', 'HBP': 'hbp', 'WP': 'wp'}


def ours(kind, cols):
    """{pid: {season: {col: total}}} summed over every team line."""
    out = {}
    for suffix in ('current', 'history'):
        with open(os.path.join(DATA, f'{kind}_{suffix}.csv'), encoding='utf-8', newline='') as f:
            for r in csv.DictReader(f):
                s = out.setdefault(r['pid'], {}).setdefault(int(r['Season']), dict.fromkeys(cols, 0))
                for c in cols:
                    s[c] += int(float(r[c] or 0))
    return out


def theirs(kind, pid):
    with urllib.request.urlopen(f'{API}type=Career{kind}&playerId={pid}', timeout=60) as r:
        rows = json.loads(r.read() or b'[]')
    out = {}
    for row in rows:  # one row per year, but sum in case the API ever splits a year
        s = out.setdefault(int(row['year']), {})
        for k, v in row.items():
            if k not in ('playerId', 'firstName', 'lastName', 'year'):
                s[k] = s.get(k, 0) + int(float(v or 0))
    return out


def check(kind, local, cols, pid):
    remote = theirs(kind, pid)
    problems = []
    for season, mine in sorted(local[pid].items()):
        if season not in remote:
            problems.append(f'{kind} {pid} {season}: not on pssbl.com')
            continue
        for c, f in cols.items():
            if mine[c] != remote[season].get(f, 0):
                problems.append(f'{kind} {pid} {season} {c}: ours {mine[c]}, pssbl.com {remote[season].get(f, 0)}')
    return len(local[pid]), problems


def main():
    args = sys.argv[1:]
    seed = None
    if '--seed' in args:
        i = args.index('--seed'); seed = int(args[i + 1]); del args[i:i + 2]
    n = int(args[0]) if args else 20
    rng = random.Random(seed)
    jobs = []
    for kind, cols in (('Batting', BAT), ('Pitching', PIT)):
        local = ours(kind.lower(), list(cols))
        pids = rng.sample(sorted(local), min(n, len(local)))
        if MATT in local and MATT not in pids:
            pids.append(MATT)
        jobs += [(kind, local, cols, p) for p in pids]
    seasons, problems, failed = 0, [], []
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(check, *j): j for j in jobs}
        for fut in cf.as_completed(futs):
            try:
                s, p = fut.result(); seasons += s; problems += p
            except Exception as e:  # network trouble is not a data mismatch; report it separately
                failed.append(f'{futs[fut][0]} {futs[fut][3]}: {e}')
    print(f'verify: {len(jobs) - len(failed)} player checks, {seasons} player-seasons, {len(problems)} mismatches')
    for p in sorted(problems):
        print('  ' + p)
    for f in failed:
        print('  ! could not fetch ' + f, file=sys.stderr)
    if problems:
        sys.exit(1)
    if failed and len(failed) == len(jobs):
        sys.exit('verify: pssbl.com unreachable')


if __name__ == '__main__':
    main()
