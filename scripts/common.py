"""What the pipeline scripts share: paths, the first season, pssbl.com's number and date formats, and the raw
files read by more than one step. Each loader runs once per process, so update.py (which runs compute.py and
build_box.py in turn) parses the ~18k box-score files once instead of twice."""
import collections, datetime, functools, glob, os
from fetch import load, RAW  # UTF-8 + repairs pssbl.com's double-encoded names

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'build')                  # computed tables, before they're copied into public/data
DATA = os.path.join(ROOT, 'public', 'data')
FIRST = 2015                                         # first season on pssbl.com

def i(x):
    """pssbl.com sends numbers as strings, sometimes blank or junk; those count as 0."""
    try: return int(x or 0)
    except (TypeError, ValueError): return 0

def game_time(g):
    return datetime.datetime.strptime(g['dateTime'], '%b %d %Y, %I:%M %p')

def year_of(path):
    """The season in a raw file name such as Games_Adams_2024.json."""
    return int(path[-9:-5])

@functools.lru_cache(None)
def team_divs():
    """(season, teamId) -> (team name, division)."""
    out = {}
    for f in glob.glob(f'{RAW}/TeamNames_*.json'):
        for t in load(f): out[(year_of(f), t['teamId'])] = (t['teamName'].strip(), t['divisionName'])
    return out

@functools.lru_cache(None)
def finished_games():
    """gameId -> (season, game) for every finished game. A game is listed in both teams' division files."""
    out = {}
    for f in glob.glob(f'{RAW}/Games_*_20*.json'):
        for g in load(f):
            if g['outcome'] == 'finished': out[g['gameId']] = (year_of(f), g)
    return out

BAT = [('ab','AB'),('r','R'),('h','H'),('d','2B'),('t','3B'),('hr','HR'),('rbi','RBI'),('sb','SB'),('cs','CS'),('bb','BB'),('so','SO'),('gdp','GDP'),('hbp','HBP'),('sh','SH'),('sf','SF'),('ci','CI')]
PIT = [('outs','Outs'),('w','W'),('l','L'),('sv','SV'),('cg','CG'),('h','H'),('r','R'),('er','ER'),('hr','HR'),('ibb','IBB'),('bb','BB'),('so','SO'),('hbp','HBP'),('wp','WP')]

BROKEN = set()  # games with a box-score file that's missing or won't parse; build_box lists them as having no box score

def _load_box(typ, gid):
    try: return load(f'{RAW}/box/{typ}_{gid}.json')
    except Exception:
        BROKEN.add(gid); return None

@functools.lru_cache(None)
def box_lines():
    """gameId -> that game's player lines, or None when pssbl.com has no box score for it. A line is one player's
    batting ('b') or pitching ('p') for one team: {(kind, pid, tid): Counter of stats plus '_n' (name) and 'Ord'
    (lineup / pitching slot; subs share the starter's slot and are listed after him)}."""
    out = {}
    for gid in finished_games():
        b, p = ([] if (x := _load_box(typ, gid)) is None else x for typ in ('BattingStats', 'PitchingStats'))
        if not b and not p: out[gid] = None; continue
        agg = {}
        for kind, rows, cols, order in (('b', b, BAT, 'battingOrder'), ('p', p, PIT, 'pitchingOrder')):
            for x in rows:
                r = agg.setdefault((kind, x['playerId'], x['teamId']), collections.Counter())
                for a, c in cols: r[c] += i(x.get(a))
                if kind == 'p' and x.get('pitchingOrder') == '1': r['GS'] = 1
                o = i(x.get(order)); r['Ord'] = min(r['Ord'] or o, o) if o else r['Ord']
                r['_n'] = f"{x['firstName'].strip()} {x['lastName'].strip()}"
        out[gid] = agg
    return out
