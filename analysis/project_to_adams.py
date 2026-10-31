"""Project a player's next season in Adams from his last three seasons in any division.
1) Division translations: same player, same season, two divisions -> PA/IP-weighted fixed-effects offsets (to Adams).
2) Weight seasons 5/4/3 (2026/2025/2024) x playing time, translated to Adams terms.
3) Regress toward the Adams average with a regression constant estimated from this league's own split-half reliability.
"""
import pandas as pd, numpy as np, glob, sys
from scipy import stats
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]          # repo root
DATA, BUILD, OUT = ROOT / 'public' / 'data', ROOT / 'build', ROOT / 'analysis' / 'output'
OUT.mkdir(exist_ok=True)
D = str(DATA) + '/'
b = pd.concat([pd.read_csv(D + 'batting_history.csv', dtype={'pid': str}), pd.read_csv(D + 'batting_current.csv', dtype={'pid': str})])
p = pd.concat([pd.read_csv(D + 'pitching_history.csv', dtype={'pid': str}), pd.read_csv(D + 'pitching_current.csv', dtype={'pid': str})])
guts = pd.read_json(D + 'guts.json')
b = b[b.PA > 0]; p = p[p.Outs > 0]

# ---------- per player-season-division lines ----------
def agg_b(g):
    pa = g.PA.sum(); w = g.PA / pa
    return pd.Series({'PA': pa, **{c: (g[c].fillna(0) * w).sum() for c in ['AVG', 'OBP', 'SLG', 'wOBA', 'BB%', 'K%']}})
def agg_p(g):
    ip = g.Outs.sum() / 3; w = g.Outs / g.Outs.sum()
    return pd.Series({'IP': ip, **{c: (g[c].fillna(0) * w).sum() for c in ['FIP-', 'K%', 'BB%', 'ERA-']}})
bd = b.groupby(['Season', 'pid', 'Division']).apply(agg_b, include_groups=False).reset_index()
pdv = p.groupby(['Season', 'pid', 'Division']).apply(agg_p, include_groups=False).reset_index()

def fixed_effects(df, cols, wcol, minw, ref='Adams'):
    m = df[df[wcol] >= minw].copy()
    m = m[m.groupby(['Season', 'pid']).Division.transform('nunique') >= 2].reset_index(drop=True)
    g = m.groupby(['Season', 'pid']).ngroup().values; wts = m[wcol].values.astype(float)
    divs = sorted(m.Division.unique())
    X = pd.get_dummies(m.Division).reindex(columns=divs, fill_value=0).astype(float)
    W = pd.Series(wts).groupby(g).transform('sum').values
    Xd = X.values - X.mul(wts, axis=0).groupby(g).transform('sum').values / W[:, None]
    out = {}
    for c in cols:
        y = m[c].astype(float)
        yd = y.values - (y * wts).groupby(g).transform('sum').values / W
        beta = np.linalg.lstsq(Xd * np.sqrt(wts)[:, None], yd * np.sqrt(wts), rcond=None)[0]
        s = pd.Series(beta, index=divs); out[c] = s - s[ref]
    return pd.DataFrame(out), m.groupby('Division').pid.nunique()
FEb, nb = fixed_effects(bd, ['AVG', 'OBP', 'SLG', 'wOBA', 'BB%', 'K%'], 'PA', 20)
FEp, npit = fixed_effects(pdv, ['FIP-', 'K%', 'BB%', 'ERA-'], 'IP', 10)

# ---------- regression constants from split-half reliability (odd vs even games, box scores) ----------
box = pd.concat([pd.read_csv(f, dtype={'pid': str}) for f in glob.glob(D + 'box_*.csv')])
def k_from_split(r, n):  # Spearman-Brown: reliability of n units is r -> per-unit c -> k = (1-c)/c
    c = r / (n - (n - 1) * r); return (1 - c) / c
bb = box[box.kind == 'bat'].fillna(0).sort_values(['Season', 'pid', 'Division', 'Date'])
bb['half'] = bb.groupby(['Season', 'pid', 'Division']).cumcount() % 2
bb['s1'] = bb.H - bb['2B'] - bb['3B'] - bb.HR
bb['num'] = .69 * bb.BB + .72 * bb.HBP + .89 * bb.s1 + 1.27 * bb['2B'] + 1.62 * bb['3B'] + 2.1 * bb.HR
bb['den'] = bb.AB + bb.BB + bb.SF + bb.HBP; bb['pa'] = bb.den + bb.SH
hb = bb.groupby(['Season', 'pid', 'Division', 'half'])[['num', 'den', 'pa']].sum().reset_index()
hb['w'] = hb.num / hb.den
wb = hb.pivot_table(index=['Season', 'pid', 'Division'], columns='half', values=['w', 'pa']).dropna()
wb = wb[(wb['pa'][0] >= 25) & (wb['pa'][1] >= 25)]
# remove division-season means so reliability is about the player, not the league
key = wb.index.get_level_values(0).astype(str) + wb.index.get_level_values(2)
for h in (0, 1): wb[('w', h)] = wb[('w', h)] - wb[('w', h)].groupby(key).transform('mean')
r_b = stats.pearsonr(wb[('w', 0)], wb[('w', 1)])[0]; n_b = np.median(wb['pa'].values)
K_PA = k_from_split(r_b, n_b)
pp = box[box.kind == 'pit'].fillna(0).sort_values(['Season', 'pid', 'Division', 'Date'])
pp['half'] = pp.groupby(['Season', 'pid', 'Division']).cumcount() % 2
hp = pp.groupby(['Season', 'pid', 'Division', 'half'])[['Outs', 'HR', 'BB', 'HBP', 'SO']].sum().reset_index()
hp['fipraw'] = (13 * hp.HR + 3 * (hp.BB + hp.HBP) - 2 * hp.SO) / (hp.Outs / 3)
wp = hp.pivot_table(index=['Season', 'pid', 'Division'], columns='half', values=['fipraw', 'Outs']).dropna()
wp = wp[(wp['Outs'][0] >= 30) & (wp['Outs'][1] >= 30)]
keyp = wp.index.get_level_values(0).astype(str) + wp.index.get_level_values(2)
for h in (0, 1): wp[('fipraw', h)] = wp[('fipraw', h)] - wp[('fipraw', h)].groupby(keyp).transform('mean')
r_p = stats.pearsonr(wp[('fipraw', 0)], wp[('fipraw', 1)])[0]; n_p = np.median(wp['Outs'].values) / 3
K_IP = k_from_split(r_p, n_p)
print(f'Reliability: hitters r={r_b:.2f} at {n_b:.0f} PA/half -> regress with {K_PA:.0f} PA of average | pitchers r={r_p:.2f} at {n_p:.0f} IP/half -> {K_IP:.0f} IP of average')

# ---------- Adams baseline (2024-26 average) ----------
ga = guts[(guts.Division == 'Adams') & (guts.Season >= 2024)]
LG = {'wOBA': ga.wOBA.mean(), 'RPA': ga['R/PA'].mean(), 'ERA': ga.ERA.mean(), 'cFIP': ga.cFIP.mean(), 'RW': ga['R/W'].mean(), 'rep': ga['repR/PA'].mean(),
      'AVG': ga.AVG.mean(), 'OBP': ga.OBP.mean(), 'SLG': ga.SLG.mean()}
adams_b = bd[(bd.Division == 'Adams') & (bd.Season >= 2024)]
adams_p = pdv[(pdv.Division == 'Adams') & (pdv.Season >= 2024)]
MEAN_B = {c: np.average(adams_b[c], weights=adams_b.PA) for c in ['BB%', 'K%']}
MEAN_P = {c: np.average(adams_p[c], weights=adams_p.IP) for c in ['K%', 'BB%']}
WEIGHTS = {2026: 5, 2025: 4, 2024: 3}

def project_hitter(pid):
    rows = bd[(bd.pid == pid) & bd.Season.isin(WEIGHTS)]
    if rows.empty: return None
    w = rows.Season.map(WEIGHTS) * rows.PA; tot = {}
    for c in ['AVG', 'OBP', 'SLG', 'wOBA', 'BB%', 'K%']:
        tr = rows[c] - rows.Division.map(FEb[c])                     # in Adams terms
        tot[c] = (tr * w).sum() / w.sum()
    pa_eff = (rows.Season.map(WEIGHTS) / 5 * rows.PA).sum()           # recency-discounted PA
    shrink = pa_eff / (pa_eff + K_PA)
    proj = {c: shrink * tot[c] + (1 - shrink) * (LG[c] if c in LG else MEAN_B[c]) for c in tot}
    rpa = LG['RPA']; wraa_pa = (proj['wOBA'] - LG['wOBA']) / 1.2
    proj['wRC+'] = 100 * (wraa_pa + rpa) / rpa
    proj['oWAR/80PA'] = (wraa_pa + LG['rep']) * 80 / LG['RW']
    # uncertainty in true talent (wOBA): tau^2 from reliability, posterior sd, plus translation SE
    return proj, rows, pa_eff, shrink

def project_pitcher(pid):
    rows = pdv[(pdv.pid == pid) & pdv.Season.isin(WEIGHTS)]
    if rows.empty: return None
    w = rows.Season.map(WEIGHTS) * rows.IP; tot = {}
    for c in ['FIP-', 'K%', 'BB%']:
        tr = rows[c] - rows.Division.map(FEp[c]); tot[c] = (tr * w).sum() / w.sum()
    ip_eff = (rows.Season.map(WEIGHTS) / 5 * rows.IP).sum(); shrink = ip_eff / (ip_eff + K_IP)
    proj = {'FIP-': shrink * tot['FIP-'] + (1 - shrink) * 100,
            'K%': shrink * tot['K%'] + (1 - shrink) * MEAN_P['K%'], 'BB%': shrink * tot['BB%'] + (1 - shrink) * MEAN_P['BB%']}
    proj['FIP'] = proj['FIP-'] / 100 * LG['ERA']
    proj['ERA (expected)'] = proj['FIP']
    return proj, rows, ip_eff, shrink

print('\nDivision translations into Adams (subtract from a line in that division):')
print(pd.concat([FEb[['wOBA', 'OBP', 'SLG']].round(3), FEp[['FIP-', 'K%']].round(1).add_prefix('pit ')], axis=1).to_string())
print(f"\nAdams 2024-26 average: wOBA {LG['wOBA']:.3f}, AVG/OBP/SLG {LG['AVG']:.3f}/{LG['OBP']:.3f}/{LG['SLG']:.3f}, ERA {LG['ERA']:.2f}")

for name in sys.argv[1:]:
    pid = b.loc[b.Name.str.lower() == name.lower(), 'pid'].iloc[0] if (b.Name.str.lower() == name.lower()).any() else p.loc[p.Name.str.lower() == name.lower(), 'pid'].iloc[0]
    print(f'\n================ {name} (pid {pid}) ================')
    h = project_hitter(pid)
    if h:
        proj, rows, n, s = h
        print('Recent hitting lines used:'); print(rows[['Season', 'Division', 'PA', 'AVG', 'OBP', 'SLG', 'wOBA']].round(3).to_string(index=False))
        print(f"-> ADAMS hitting projection (talent, {n:.0f} recency-weighted PA, {s:.0%} his own numbers / {1-s:.0%} Adams average):")
        print(f"   {proj['AVG']:.3f}/{proj['OBP']:.3f}/{proj['SLG']:.3f}  wOBA {proj['wOBA']:.3f}  wRC+ {proj['wRC+']:.0f}  BB% {proj['BB%']:.1f}  K% {proj['K%']:.1f}  oWAR per 80 PA {proj['oWAR/80PA']:.1f}")
        # talent uncertainty
        tau2 = (K_PA and (0.0)) or None
    pp_ = project_pitcher(pid)
    if pp_:
        proj, rows, n, s = pp_
        print('Recent pitching lines used:'); print(rows[['Season', 'Division', 'IP', 'FIP-', 'K%', 'BB%']].round(1).to_string(index=False))
        print(f"-> ADAMS pitching projection ({n:.0f} recency-weighted IP, {s:.0%} his own / {1-s:.0%} Adams average):")
        print(f"   FIP- {proj['FIP-']:.0f}  FIP/expected ERA {proj['FIP']:.2f}  K% {proj['K%']:.1f}  BB% {proj['BB%']:.1f}")
