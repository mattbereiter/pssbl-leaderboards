"""Division translations for the Players page's "Projected in Adams / Sierra" card -> public/data/translations.json.

A stdlib port of analysis/project_to_adams.py (keep the two in step):
1) Translations: same player, same season, two divisions (hitters 20 PA in each, pitchers 10 IP), pooled over every
   season, relative to Adams. Rates are translated by multiplicative factors (Poisson fixed effects), so a translated
   line can't go negative. Hitting goes through AVG, ISO (SLG - AVG) and xOB = (OBP - AVG) / (1 - AVG), the share of
   non-hit PAs that still reach base, so SLG >= AVG and AVG <= OBP < 1 always hold.
   FIP- and ERA- (indexes around 100) use additive offsets (weighted least squares within player-season).
2) Regression constants from split-half reliability (odd vs even games in the box scores, Spearman-Brown).
3) Targets: Adams and Sierra baselines over the last three seasons (league constants from guts, BB%/K% from player lines).
The page weights a player's last three seasons 5/4/3 x PA (or IP), translates them and regresses toward the target.
Reads only public/data, so update.py runs it after publishing the CSVs; it registers itself in manifest.json.
"""
import csv, datetime, glob, json, math, os, statistics, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get('PSSBL_DATA') or os.path.join(ROOT, 'public', 'data')  # update.py points it at its staging folder
REF, TARGETS = 'Adams', ('Adams', 'Sierra')
BAT_COLS, PIT_COLS = ['AVG', 'OBP', 'SLG', 'wOBA', 'BB%', 'K%'], ['FIP-', 'K%', 'BB%', 'ERA-']
BAT_FAC, PIT_FAC, PIT_OFF = ['AVG', 'ISO', 'xOB', 'wOBA', 'BB%', 'K%'], ['K%', 'BB%'], ['FIP-', 'ERA-']


def read(name):
    with open(os.path.join(DATA, name), encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f))


def num(v):
    return float(v) if v not in ('', None) else 0.0


def lines(rows, wcol, cols, scale=1.0):
    """One line per (Season, pid, Division): summed weight and weight-averaged rate columns (as the CSVs round them)."""
    acc = {}
    for r in rows:
        w = num(r[wcol])
        if w <= 0:
            continue
        a = acc.setdefault((int(r['Season']), r['pid'], r['Division']), {'w': 0.0, **{c: 0.0 for c in cols}})
        a['w'] += w
        for c in cols:
            a[c] += num(r[c]) * w
    out = []
    for (s, pid, d), a in acc.items():
        out.append({'Season': s, 'pid': pid, 'Division': d, 'w': a['w'] / scale, **{c: a[c] / a['w'] for c in cols}})
    return out


def solve(A, b):
    """Gaussian elimination with partial pivoting."""
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for i in range(n):
        p = max(range(i, n), key=lambda k: abs(M[k][i]))
        M[i], M[p] = M[p], M[i]
        for k in range(i + 1, n):
            f = M[k][i] / M[i][i]
            for j in range(i, n + 1):
                M[k][j] -= f * M[i][j]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (M[i][n] - sum(M[i][j] * x[j] for j in range(i + 1, n))) / M[i][i]
    return x


def pairs(ls, minw):
    """Player-seasons with at least two divisions of >= minw each."""
    groups = {}
    for l in ls:
        if l['w'] >= minw:
            groups.setdefault((l['Season'], l['pid']), []).append(l)
    return [g for g in groups.values() if len({l['Division'] for l in g}) >= 2]


def factors(groups, cols, iters=500):
    """Multiplicative fixed effects, rate ~ player-season level x division factor, fit by weighted Poisson likelihood
    (alternating closed-form updates); factors are relative to REF. Zeros are fine and nothing can go negative."""
    divs = sorted({l['Division'] for g in groups for l in g})
    out = {d: {} for d in divs}
    for c in cols:
        f = {d: 1.0 for d in divs}
        for _ in range(iters):
            mu = [sum(l['w'] * l[c] for l in g) / sum(l['w'] * f[l['Division']] for l in g) for g in groups]
            num, den = dict.fromkeys(divs, 0.0), dict.fromkeys(divs, 0.0)
            for m, g in zip(mu, groups):
                for l in g:
                    num[l['Division']] += l['w'] * l[c]
                    den[l['Division']] += l['w'] * m
            f = {d: num[d] / den[d] for d in divs}
            f = {d: v / f[REF] for d, v in f.items()}
        for d in divs:
            out[d][c] = f[d]
    return out


def fixed_effects(groups, cols):
    """Within-player-season weighted least squares on division dummies; offsets are relative to REF."""
    divs = sorted({l['Division'] for g in groups for l in g})
    free = [d for d in divs if d != REF]
    idx = {d: i for i, d in enumerate(free)}
    n = len(free)
    out = {d: {} for d in divs}
    for c in cols:
        A = [[0.0] * n for _ in range(n)]
        b = [0.0] * n
        for g in groups:
            W = sum(l['w'] for l in g)
            xbar = [0.0] * n
            for l in g:
                if l['Division'] in idx:
                    xbar[idx[l['Division']]] += l['w'] / W
            ybar = sum(l['w'] * l[c] for l in g) / W
            for l in g:
                x = [-v for v in xbar]
                if l['Division'] in idx:
                    x[idx[l['Division']]] += 1
                yd = l[c] - ybar
                for i in range(n):
                    if x[i]:
                        b[i] += l['w'] * x[i] * yd
                        for j in range(n):
                            A[i][j] += l['w'] * x[i] * x[j]
        beta = solve(A, b)
        for d in divs:
            out[d][c] = 0.0 if d == REF else beta[idx[d]]
    return out


def players(groups):
    divs = sorted({l['Division'] for g in groups for l in g})
    return {d: len({g[0]['pid'] for g in groups if any(l['Division'] == d for l in g)}) for d in divs}


def pearson(x, y):
    mx, my = sum(x) / len(x), sum(y) / len(y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    return sxy / math.sqrt(sum((a - mx) ** 2 for a in x) * sum((b - my) ** 2 for b in y))


def split_half(box, kind, stat, size, minsize):
    """Odd vs even games within each player-division-season; returns r, median half size, pairs."""
    games = {}
    for r in box:  # files are date-sorted per season; a stable sort keeps doubleheaders in file order
        if r['kind'] == kind:
            games.setdefault((int(r['Season']), r['pid'], r['Division']), []).append(r)
    pairs = []
    for (s, pid, d), g in games.items():
        g.sort(key=lambda r: r['Date'])
        halves = [[r for r in g[h::2]] for h in (0, 1)]
        tot = [{k: sum(num(r[k]) for r in hf) for k in box[0].keys() if k not in ('kind', 'Date', 'Season', 'gameId', 'pid', 'Name', 'tid', 'ptid', 'Team', 'Division')} for hf in halves]
        n = [size(t) for t in tot]
        if min(n) >= minsize:
            pairs.append((f'{s}{d}', [stat(t) for t in tot], n))
    for h in (0, 1):  # take out division-season means: reliability is about the player, not the league
        means = {}
        for k, v, _ in pairs:
            means.setdefault(k, []).append(v[h])
        means = {k: sum(v) / len(v) for k, v in means.items()}
        for k, v, _ in pairs:
            v[h] -= means[k]
    r = pearson([v[0] for _, v, _ in pairs], [v[1] for _, v, _ in pairs])
    return r, statistics.median([x for _, _, n in pairs for x in n]), len(pairs)


def k_from_split(r, n):
    """Spearman-Brown: reliability r at n units per half -> per-unit c -> regress with k = (1-c)/c units of average."""
    c = r / (n - (n - 1) * r)
    return (1 - c) / c


def woba_parts(t):
    s1 = t['H'] - t['2B'] - t['3B'] - t['HR']
    return .69 * t['BB'] + .72 * t['HBP'] + .89 * s1 + 1.27 * t['2B'] + 1.62 * t['3B'] + 2.1 * t['HR'], t['AB'] + t['BB'] + t['SF'] + t['HBP']


def main():
    bat = read('batting_history.csv') + read('batting_current.csv')
    pit = read('pitching_history.csv') + read('pitching_current.csv')
    with open(os.path.join(DATA, 'guts.json'), encoding='utf-8') as f:
        guts = json.load(f)
    box = [r for f in sorted(glob.glob(os.path.join(DATA, 'box_*.csv'))) for r in read(os.path.basename(f))]
    latest = max(g['Season'] for g in guts)
    seasons = [latest, latest - 1, latest - 2]

    bl, pl = lines(bat, 'PA', BAT_COLS), lines(pit, 'Outs', PIT_COLS, scale=3)  # pitching weight = IP
    for l in bl:
        l['ISO'], l['xOB'] = l['SLG'] - l['AVG'], (l['OBP'] - l['AVG']) / (1 - l['AVG']) if l['AVG'] < 1 else 0.0
    gb, gp = pairs(bl, 20), pairs(pl, 10)
    fac_b, fac_p, fe_p = factors(gb, BAT_FAC), factors(gp, PIT_FAC), fixed_effects(gp, PIT_OFF)
    n_b, n_p = players(gb), players(gp)

    rb, hb, pb = split_half(box, 'bat', lambda t: woba_parts(t)[0] / woba_parts(t)[1], lambda t: woba_parts(t)[1] + t['SH'], 25)
    rp, hp, pp = split_half(box, 'pit', lambda t: (13 * t['HR'] + 3 * (t['BB'] + t['HBP']) - 2 * t['SO']) / (t['Outs'] / 3), lambda t: t['Outs'], 30)
    hp /= 3

    targets = {}
    for t in TARGETS:
        g = [x for x in guts if x['Division'] == t and x['Season'] in seasons]
        mean = lambda k: sum(x[k] for x in g) / len(g)
        wavg = lambda ls, c: sum(l[c] * l['w'] for l in ls) / sum(l['w'] for l in ls)
        tb = [l for l in bl if l['Division'] == t and l['Season'] in seasons]
        tp = [l for l in pl if l['Division'] == t and l['Season'] in seasons]
        targets[t] = {'wOBA': mean('wOBA'), 'R/PA': mean('R/PA'), 'ERA': mean('ERA'), 'R/W': mean('R/W'), 'repR/PA': mean('repR/PA'),
                      'AVG': mean('AVG'), 'OBP': mean('OBP'), 'SLG': mean('SLG'),
                      'bat': {c: wavg(tb, c) for c in ('BB%', 'K%')}, 'pit': {c: wavg(tp, c) for c in ('K%', 'BB%')}}

    rnd = lambda o: {k: rnd(v) for k, v in o.items()} if isinstance(o, dict) else round(o, 6) if isinstance(o, float) else o
    out = {'seasons': {str(s): w for s, w in zip(seasons, (5, 4, 3))}, 'ref': REF, 'targets': targets,
           'bat': {'k': k_from_split(rb, hb), 'r': rb, 'half': hb, 'pairs': pb, 'minPA': 20, 'factors': fac_b, 'players': n_b},
           'pit': {'k': k_from_split(rp, hp), 'r': rp, 'half': hp, 'pairs': pp, 'minIP': 10, 'factors': fac_p, 'offsets': fe_p, 'players': n_p}}
    with open(os.path.join(DATA, 'translations.json'), 'w', encoding='utf-8') as f:
        json.dump(rnd(out), f, indent=1)

    mpath = os.path.join(DATA, 'manifest.json')
    if os.path.exists(mpath):  # register the file and bump the version so browsers refetch
        with open(mpath, encoding='utf-8') as f:
            m = json.load(f)
        m['datasets']['translations'] = 'translations.json'
        m['version'] = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
        with open(mpath, 'w', encoding='utf-8') as f:
            json.dump(m, f, indent=1)
    print(f"translations: hitters r={rb:.2f} at {hb:.0f} PA/half -> k={out['bat']['k']:.0f} PA | "
          f"pitchers r={rp:.2f} at {hp:.0f} IP/half -> k={out['pit']['k']:.0f} IP")
    for d in sorted(fac_b):  # x in d is worth x / factor[d] in Adams
        print(f"  {d:<11} AVG x{fac_b[d]['AVG']:.2f}  ISO x{fac_b[d]['ISO']:.2f}  xOB x{fac_b[d]['xOB']:.2f}  wOBA x{fac_b[d]['wOBA']:.2f}"
              + (f"  FIP- {fe_p[d]['FIP-']:+.1f}  K% x{fac_p[d]['K%']:.2f}" if d in fe_p else ''))


if __name__ == '__main__':
    sys.exit(main())
