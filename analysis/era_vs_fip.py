"""How pitchers' ERA- compares with their FIP- in Adams, Sierra and Cascade.

ERA- and FIP- are each against the pitcher's own division-season (100 = league average, lower is better),
so seasons and divisions can be pooled. Questions:
  1. How closely does ERA- track FIP- in each division?
  2. Is beating FIP (ERA- below FIP-) a repeatable skill, or noise?
  3. Next year, what predicts ERA- better: this year's ERA- or this year's FIP-?
  4. Who beats or trails their FIP over a career?

Run: python analysis/era_vs_fip.py   (reads public/data, writes analysis/output/era_vs_fip.png)
"""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DIVS = ['Adams', 'Sierra', 'Cascade']
MIN_IP = 20  # a season counts at 20+ IP
MATT = 8048

p = pd.concat([pd.read_csv(ROOT / 'public/data' / f) for f in ('pitching_history.csv', 'pitching_current.csv')])
p = p[p.Division.isin(DIVS) & p['ERA-'].notna() & p['FIP-'].notna()].copy()
p['gap'] = p['ERA-'] - p['FIP-']  # negative = ERA better than FIP said
s = p[p.IP >= MIN_IP].copy()


def wavg(x, w):
    return float(np.average(x, weights=w))


print(f'Pitcher-seasons with {MIN_IP}+ IP, 2015-2026 (no 2020)\n')
print(f"{'Div':8} {'n':>4} {'r(ERA-,FIP-)':>13} {'typ miss':>9} {'SD gap':>7} {'beat by 25+':>12} {'trail by 25+':>13}")
summary = {}
for d in DIVS:
    x = s[s.Division == d]
    r = x['ERA-'].corr(x['FIP-'])
    mad = (x.gap.abs()).median()
    summary[d] = dict(n=len(x), r=r, mad=mad, sd=x.gap.std(),
                      beat=(x.gap <= -25).mean(), trail=(x.gap >= 25).mean())
    print(f"{d:8} {len(x):4d} {r:13.2f} {mad:9.0f} {x.gap.std():7.0f} {(x.gap <= -25).mean():12.0%} {(x.gap >= 25).mean():13.0%}")

# good pitchers beat FIP, bad ones trail it? slope of ERA- on FIP-, and the IP-weighted gap by FIP- tier
print('\nERA- per point of FIP- (slope), and the IP-weighted gap (ERA- minus FIP-) by FIP- tier')
tiers = pd.cut(s['FIP-'], [0, 80, 95, 105, 120, 999], labels=['<80', '80-95', '95-105', '105-120', '120+'])
print(f"{'Div':8} {'slope':>6}  " + '  '.join(f'{t:>7}' for t in tiers.cat.categories))
for d in DIVS + ['All']:
    m = s.Division == d if d != 'All' else s.Division.notna()
    x = s[m]
    slope = np.polyfit(x['FIP-'], x['ERA-'], 1, w=np.sqrt(x.IP))[0]
    by = x.groupby(tiers[m], observed=False).apply(lambda g: wavg(g.gap, g.IP) if len(g) else np.nan, include_groups=False)
    print(f"{d:8} {slope:6.2f}  " + '  '.join(f'{v:+7.0f}' for v in by))

# 2. persistence: same pitcher, same division, consecutive seasons (2019 -> 2021 counts as consecutive)
order = sorted(s.Season.unique())
nxt = {a: b for a, b in zip(order, order[1:])}
s['NextSeason'] = s.Season.map(nxt)
pairs = s.merge(s, left_on=['pid', 'Division', 'NextSeason'], right_on=['pid', 'Division', 'Season'], suffixes=('', '_n'))
print(f'\nYear to year, same division (pairs of {MIN_IP}+ IP seasons)')
print(f"{'Div':8} {'pairs':>5} {'gap r':>6} {'FIP- r':>7} {'ERA- r':>7} {'ERA- next ~ ERA-':>17} {'ERA- next ~ FIP-':>17}")
for d in DIVS + ['All']:
    x = pairs if d == 'All' else pairs[pairs.Division == d]
    g = x.gap.corr(x.gap_n)
    fr = x['FIP-'].corr(x['FIP-_n'])
    er = x['ERA-'].corr(x['ERA-_n'])
    e_e = x['ERA-'].corr(x['ERA-_n'])
    e_f = x['FIP-'].corr(x['ERA-_n'])
    summary.setdefault(d, {}).update(pairs=len(x), gap_r=g, fip_r=fr, era_r=er, e_e=e_e, e_f=e_f)
    print(f"{d:8} {len(x):5d} {g:6.2f} {fr:7.2f} {er:7.2f} {e_e:17.2f} {e_f:17.2f}")

# HR era: 2015-16 FIP has an HR term, 2017+ doesn't (pssbl.com stopped recording pitcher HR)
print('\nBy FIP era (all three divisions)')
for lab, m in [('2015-16 (with HR)', s.Season <= 2016), ('2017+ (no HR)', s.Season >= 2017)]:
    x = s[m]
    print(f"  {lab:18} n={len(x):4d}  r={x['ERA-'].corr(x['FIP-']):.2f}  typical miss={x.gap.abs().median():.0f}")

# 4. careers: IP-weighted gap over all seasons in these divisions, 100+ IP
c = p.groupby(['pid', 'Name']).apply(lambda g: pd.Series({
    'IP': g.IP.sum(), 'ERA-': wavg(g['ERA-'], g.IP), 'FIP-': wavg(g['FIP-'], g.IP),
    'Divs': '/'.join(sorted(g.Division.unique())), 'Seasons': g.Season.nunique()}), include_groups=False).reset_index()
c['gap'] = c['ERA-'] - c['FIP-']
c = c[c.IP >= 100].sort_values('gap')
# how much of the career spread is more than chance? compare with shuffled seasons
print(f'\nCareers with 100+ IP: {len(c)}; SD of career gap {c.gap.std():.0f}')
# is a career gap real? split each pitcher's 20+ IP seasons into alternating halves and correlate the halves
h = s.sort_values('Season').copy(); h['half'] = h.groupby('pid').cumcount() % 2
hh = h.groupby(['pid', 'half']).apply(lambda g: wavg(g.gap, g.IP), include_groups=False).unstack().dropna()
hf = h.groupby(['pid', 'half']).apply(lambda g: wavg(g['FIP-'], g.IP), include_groups=False).unstack().dropna()
print(f'  split-half r, pitchers with 2+ qualifying seasons (n={len(hh)}): gap {hh[0].corr(hh[1]):.2f}, FIP- {hf[0].corr(hf[1]):.2f}')
fmt = lambda r: f"  {r['Name']:22} {r['IP']:6.0f} IP  ERA- {r['ERA-']:4.0f}  FIP- {r['FIP-']:4.0f}  gap {r['gap']:+4.0f}  {r['Divs']}"
print('Beat their FIP most:'); [print(fmt(r)) for _, r in c.head(8).iterrows()]
print('Trailed their FIP most:'); [print(fmt(r)) for _, r in c.tail(8).iloc[::-1].iterrows()]
m = c[c.pid == MATT]
if len(m): print('Matt:'); print(fmt(m.iloc[0]))
else:
    mm = p[p.pid == MATT]
    print(f"Matt: {mm.IP.sum():.0f} IP in these divisions, ERA- {wavg(mm['ERA-'], mm.IP):.0f}, FIP- {wavg(mm['FIP-'], mm.IP):.0f}")

# chart: ERA- vs FIP- per division, and the year-to-year gap
try:
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 4, figsize=(17, 4.4))
    col = {'Adams': '#378029', 'Sierra': '#2f6fb0', 'Cascade': '#b0602f'}
    for a, d in zip(ax, DIVS):
        x = s[s.Division == d]
        a.scatter(x['FIP-'], x['ERA-'], s=x.IP / 3, alpha=.35, color=col[d], edgecolor='none')
        a.plot([20, 250], [20, 250], color='#888', lw=1)
        a.set(xlim=(20, 250), ylim=(0, 300), title=f"{d}: r = {summary[d]['r']:.2f}", xlabel='FIP-', ylabel='ERA-' if d == 'Adams' else None)
    a = ax[3]
    for d in DIVS:
        x = pairs[pairs.Division == d]
        a.scatter(x.gap, x.gap_n, s=12, alpha=.45, color=col[d], label=d, edgecolor='none')
    a.axhline(0, color='#888', lw=1); a.axvline(0, color='#888', lw=1)
    a.set(title=f"ERA- minus FIP-, year to year: r = {summary['All']['gap_r']:.2f}", xlabel='this year', ylabel='next year', xlim=(-120, 160), ylim=(-120, 160))
    a.legend(frameon=False, fontsize=8)
    fig.suptitle(f'ERA- vs FIP- for pitcher-seasons with {MIN_IP}+ IP (dot size = IP; below the line = beat FIP)', fontsize=11)
    fig.tight_layout()
    out = ROOT / 'analysis/output'; out.mkdir(exist_ok=True)
    fig.savefig(out / 'era_vs_fip.png', dpi=110)
    print(f"\nwrote {out / 'era_vs_fip.png'}")
except ImportError:
    pass
