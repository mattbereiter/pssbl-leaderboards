"""Does hitting well in one PSSBL division carry over to another?
Same player, same season, two divisions. wRC+ = relative to that division's own average (100 = avg)."""
import pandas as pd, numpy as np, itertools, glob
from scipy import stats
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]          # repo root
DATA, BUILD, OUT = ROOT / 'public' / 'data', ROOT / 'build', ROOT / 'analysis' / 'output'
OUT.mkdir(exist_ok=True)

b = pd.read_csv(BUILD / 'pssbl_batting.csv', dtype={'pid': str})
b = b[b.PA > 0]
def comb(g):
    pa = g.PA.sum(); w = g.PA / pa
    return pd.Series({'PA': pa, 'wOBA': (g.wOBA.fillna(0) * w).sum(), 'wRCp': (g['wRC+'].fillna(0) * w).sum(), 'Name': g.Name.iloc[0]})
d = b.groupby(['Season', 'pid', 'Division']).apply(comb, include_groups=False).reset_index()

def pairs(minpa):
    rows = []
    for (s, p), g in d[d.PA >= minpa].groupby(['Season', 'pid']):
        if len(g) < 2: continue
        for (_, x), (_, y) in itertools.combinations(g.iterrows(), 2):
            rows.append({'Season': s, 'pid': p, 'Name': x.Name, 'd1': x.Division, 'd2': y.Division, 'pa1': x.PA, 'pa2': y.PA,
                         'wrc1': x.wRCp, 'wrc2': y.wRCp, 'woba1': x.wOBA, 'woba2': y.wOBA})
    return pd.DataFrame(rows)

def orient(df, a, others):
    """rows pairing division a with any division in `others`, oriented so A is first"""
    m1 = (df.d1 == a) & df.d2.isin(others); m2 = (df.d2 == a) & df.d1.isin(others)
    x = df[m1].copy(); y = df[m2].copy()
    y[['d1', 'd2', 'pa1', 'pa2', 'wrc1', 'wrc2', 'woba1', 'woba2']] = y[['d2', 'd1', 'pa2', 'pa1', 'wrc2', 'wrc1', 'woba2', 'woba1']].values
    out = pd.concat([x, y])
    for c in ['pa1', 'pa2', 'wrc1', 'wrc2', 'woba1', 'woba2']: out[c] = out[c].astype(float)
    return out

def report(df, label):
    n = len(df)
    if n < 8: print(f'{label}: n={n} (too few)'); return None
    r, p = stats.pearsonr(df.wrc1, df.wrc2); rho, ps = stats.spearmanr(df.wrc1, df.wrc2)
    z, se = np.arctanh(r), 1 / np.sqrt(n - 3); lo, hi = np.tanh(z - 1.96 * se), np.tanh(z + 1.96 * se)
    _, pt = stats.ttest_rel(df.wrc1, df.wrc2); _, pw = stats.ttest_rel(df.woba1, df.woba2)
    print(f'{label:34s} n={n:4d} medPA {df.pa1.median():3.0f}/{df.pa2.median():3.0f} | r={r:+.2f} [{lo:+.2f},{hi:+.2f}] p={p:.2g} rho={rho:+.2f} '
          f'| wRC+ 1st-2nd {(df.wrc1-df.wrc2).mean():+5.0f} (p={pt:.2g}) | wOBA 1st-2nd {(df.woba1-df.woba2).mean():+.3f} (p={pw:.2g})')
    return dict(label=label, n=n, r=r, lo=lo, hi=hi, p=p)

P = pairs(30)
print('=== Same season, 30+ PA in both divisions ===')
res = []
res.append(report(orient(P, 'Rocky', ['Sierra']), 'Rocky -> Sierra'))
res.append(report(orient(P, 'Rocky', ['Cascade']), 'Rocky -> Cascade'))
rcs = orient(P, 'Rocky', ['Sierra', 'Cascade']); res.append(report(rcs, 'Rocky -> Cascade or Sierra'))
res.append(report(orient(P, 'Rocky', [x for x in d.Division.unique() if x != 'Rocky']), 'Rocky -> any other division'))
res.append(report(orient(P, 'Cascade', ['Sierra']), 'Cascade -> Sierra'))
P2 = P.copy()
for c in ['pa1', 'pa2', 'wrc1', 'wrc2', 'woba1', 'woba2']: P2[c] = P2[c].astype(float)
res.append(report(P2, 'All cross-division pairs'))
for m in (20, 50):
    report(orient(pairs(m), 'Rocky', ['Sierra', 'Cascade']), f'Rocky -> Cascade/Sierra ({m}+ PA)')

# ---- ceiling: same player, same division, odd vs even games (how repeatable is a ~half season at all?)
box = pd.concat([pd.read_csv(f, dtype={'pid': str, 'tid': str}) for f in glob.glob(str(DATA / 'box_*.csv'))])
box = box[box.kind == 'bat'].fillna({c: 0 for c in ['AB', 'H', '2B', '3B', 'HR', 'BB', 'HBP', 'SF', 'SH']})
box = box.sort_values(['Season', 'pid', 'Division', 'Date'])
box['half'] = box.groupby(['Season', 'pid', 'Division']).cumcount() % 2
box['s1'] = box.H - box['2B'] - box['3B'] - box.HR
box['num'] = .69 * box.BB + .72 * box.HBP + .89 * box.s1 + 1.27 * box['2B'] + 1.62 * box['3B'] + 2.10 * box.HR
box['den'] = box.AB + box.BB + box.SF + box.HBP
box['pa'] = box.AB + box.BB + box.HBP + box.SF + box.SH
h = box.groupby(['Season', 'pid', 'Division', 'half'])[['num', 'den', 'pa']].sum().reset_index()
gts = pd.read_json(DATA / 'guts.json').set_index('key')
lg = gts.loc[(h.Season.astype(str) + '-' + h.Division).values]
h['wrc'] = 100 * ((h.num / h.den - lg.wOBA.values) / 1.2 + lg['R/PA'].values) / lg['R/PA'].values
w = h.pivot_table(index=['Season', 'pid', 'Division'], columns='half', values=['wrc', 'pa']).dropna()
w.columns = [f'{a}{c}' for a, c in w.columns]
lo_pa, hi_pa = rcs[['pa1', 'pa2']].stack().quantile([.1, .9])
m = w[w.pa0.between(lo_pa, hi_pa) & w.pa1.between(lo_pa, hi_pa)]
r_ceiling = stats.pearsonr(m.wrc0, m.wrc1)[0]
print(f'\n=== Ceiling: same player, SAME division, odd vs even games, halves sized like the pairs ({lo_pa:.0f}-{hi_pa:.0f} PA) ===')
print(f'n={len(m)} | r={r_ceiling:.2f}')
for x in res:
    if x: print(f"  {x['label']:30s} r={x['r']:+.2f} -> {x['r']/r_ceiling:4.0%} of the same-division ceiling")

# ---- division difficulty: same hitter, same season, raw wOBA by division (player-season fixed effects, PA-weighted)
mm = d[d.PA >= 20].copy()
mm = mm[mm.groupby(['Season', 'pid']).Division.transform('nunique') >= 2].reset_index(drop=True)
divs = sorted(mm.Division.unique())
mm['g'] = mm.groupby(['Season', 'pid']).ngroup()
def fe(df):
    """PA-weighted within-player-season regression of wOBA on division dummies."""
    wts = df.PA.values.astype(float); g = df.g.values
    X = pd.get_dummies(df.Division).reindex(columns=divs, fill_value=0).astype(float)
    y = df.wOBA.astype(float)
    W = pd.Series(wts).groupby(g).transform('sum').values
    Xd = X.values - (X.mul(wts, axis=0)).groupby(g).transform('sum').values / W[:, None]
    yd = y.values - (y * wts).groupby(g).transform('sum').values / W
    sw = np.sqrt(wts)
    beta = np.linalg.lstsq(Xd * sw[:, None], yd * sw, rcond=None)[0]
    s = pd.Series(beta, index=divs); return s - s['Sierra']
est = fe(mm)
groups = [g for _, g in mm.groupby('g')]
rng = np.random.default_rng(7); boots = []
for _ in range(400):
    pick = rng.integers(0, len(groups), len(groups))
    bs = pd.concat([groups[i].assign(g=k) for k, i in enumerate(pick)], ignore_index=True)
    boots.append(fe(bs))
bt = pd.DataFrame(boots)
out = pd.DataFrame({'wOBA_vs_Sierra': est, 'lo95': bt.quantile(.025), 'hi95': bt.quantile(.975),
                    'shared_players': mm.groupby('Division').pid.nunique()}).sort_values('wOBA_vs_Sierra')
print('\n=== How hard is each division to hit in? Same hitter\'s wOBA vs his wOBA in Sierra (negative = tougher) ===')
print(out.round(3).to_string())
out.to_csv(OUT / 'division_difficulty.csv')
rcs.to_csv(OUT / 'rocky_cascade_sierra_pairs.csv', index=False)
