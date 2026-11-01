"""Per-game player lines (box scores) for the date-range filter, one CSV per season, plus the game list."""
import collections, csv, json, os
from common import BUILD as OUT, i, game_time, team_divs, finished_games, box_lines

BC = ['kind','Date','Season','gameId','PO','pid','Name','tid','ptid','Team','Division','GS','AB','R','H','2B','3B','HR','RBI','SB','CS','BB','SO','GDP','HBP','SH','SF','CI','Outs','W','L','SV','CG','ER','IBB','WP','Ord','sW','sL','sSV']

def decisions(rows):
    """On each pitching line with a W, L or SV: the pitcher's season W, L and SV through that game (all teams), so the
    box score can tag "W (5–2)" without loading the whole season."""
    by = collections.defaultdict(list)
    for r in rows:
        if r['kind'] == 'pit': by[r['pid']].append(r)
    for lines in by.values():
        lines.sort(key=lambda r: (r['Date'], int(r['gameId'])))
        w = l = sv = start = 0
        for k, r in enumerate(lines):
            w += r['W'] or 0; l += r['L'] or 0; sv += r['SV'] or 0
            # two lines in one game (pitching for both sides) count together
            if k + 1 < len(lines) and lines[k + 1]['gameId'] == r['gameId']: continue
            for x in lines[start:k + 1]:
                if x['W'] or x['L'] or x['SV']: x['sW'], x['sL'], x['sSV'] = w, l, sv
            start = k + 1

def main():
    tdiv = team_divs()
    meta = {}   # gameId -> (season, date, playoff)
    games = {}  # gameId -> scoreline for the Players page game log
    for gid, (y, g) in finished_games().items():
        d = game_time(g).date().isoformat()
        meta[gid] = (y, d, 0 if g['playoffRound'] in ('0', '', None) else 1)
        games[gid] = {'gameId': gid, 'Season': y, 'Date': d, 'PO': meta[gid][2],
            'home': g['homeId'], 'away': g['awayId'], 'homeName': g['homeName'].strip(), 'awayName': g['awayName'].strip(),
            'homeDiv': g['homeDivision'], 'awayDiv': g['awayDivision'], 'hr': i(g['homeRuns']), 'ar': i(g['awayRuns']), 'Field': (g.get('fieldName') or '').strip()}
    # the season lines compute.py wrote: a box line under a team with no season line moves to the player's one other team in that division
    CUM = {'b': set(), 'p': set()}; CUM_BY = {'b': collections.defaultdict(list), 'p': collections.defaultdict(list)}
    for kind, fn in (('b', 'batting'), ('p', 'pitching')):
        with open(f'{OUT}/pssbl_{fn}.csv', encoding='utf-8', newline='') as f:
            for r in csv.DictReader(f):
                k = (int(r['Season']), r['pid'], r['tid']); CUM[kind].add(k); CUM_BY[kind][(k[0], k[1])].append(k)
    per = collections.defaultdict(list); missing = collections.Counter(); total = collections.Counter()
    box = box_lines()
    for gid, (y, d, po) in meta.items():
        total[y] += 1
        if box[gid] is None: missing[y] += 1; continue
        for (kind, pid, tid), r in box[gid].items():
            ptid = ''
            if (y, pid, tid) not in CUM[kind]:
                div0 = tdiv.get((y, tid), ('', ''))[1]
                alt = [t for (yy, pp, t) in CUM_BY[kind].get((y, pid), []) if tdiv.get((y, t), ('', ''))[1] == div0]
                if len(alt) == 1: ptid, tid = tid, alt[0]
            team, div = tdiv.get((y, tid), ('', ''))
            row = {'kind': 'bat' if kind == 'b' else 'pit', 'Date': d, 'Season': y, 'gameId': gid, 'PO': po, 'pid': pid, 'Name': r['_n'], 'tid': tid, 'ptid': ptid, 'Team': team, 'Division': div}
            for c in BC[11:]:
                v = r.get(c, 0)
                row[c] = v if v else ''
            if kind == 'b':
                for c in ['GS', 'Outs', 'W', 'L', 'SV', 'CG', 'ER', 'IBB', 'WP']: row[c] = ''
            per[y].append(row)
    for y in sorted(per):
        decisions(per[y])
        rows = sorted(per[y], key=lambda r: (r['Date'], r['gameId']))
        with open(f'{OUT}/pssbl_box_{y}.csv', 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, BC); w.writeheader(); w.writerows(rows)
        print(y, len(rows), 'games', total[y], 'missing', missing[y], f"{os.path.getsize(f'{OUT}/pssbl_box_{y}.csv')/1e6:.2f}MB")
    with open(f'{OUT}/box_coverage.json', 'w', encoding='utf-8') as f:
        json.dump({y: {'games': total[y], 'missing': missing[y]} for y in total}, f)
    with open(f'{OUT}/pssbl_games.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, ['gameId','Season','Date','PO','home','away','homeName','awayName','homeDiv','awayDiv','hr','ar','Field'])
        w.writeheader(); w.writerows(sorted(games.values(), key=lambda g: (g['Date'], int(g['gameId']))))
    print('games', len(games))

if __name__ == '__main__':
    main()
