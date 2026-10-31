"""Rocky -> Cascade/Sierra: does performance carry over, and how much does it drop? (hitting + pitching)"""
import pandas as pd, numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt, matplotlib.ticker
from scipy import stats
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]          # repo root
DATA, BUILD, OUT = ROOT / 'public' / 'data', ROOT / 'build', ROOT / 'analysis' / 'output'
OUT.mkdir(exist_ok=True)

INK, INK2, MUTED, GRID, SURF = '#0b0b0b', '#52514e', '#9a9893', '#e6e5e1', '#fcfcfb'
SIERRA, CASCADE, FIT = '#2a78d6', '#eb6834', '#0b0b0b'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10.5, 'axes.edgecolor': MUTED, 'axes.labelcolor': INK2,
                     'xtick.color': INK2, 'ytick.color': INK2, 'figure.facecolor': SURF, 'axes.facecolor': SURF})

# ---------- data ----------
hit = pd.read_csv(OUT / 'rocky_cascade_sierra_pairs.csv')          # same hitter, same season, 30+ PA in both
p = pd.read_csv(BUILD / 'pssbl_pitching.csv', dtype={'pid': str}); p = p[p.Outs > 0]
pg = p.groupby(['Season', 'pid', 'Division']).apply(lambda x: pd.Series({'IP': x.Outs.sum() / 3,
        'FIPm': np.average(x['FIP-'], weights=x.Outs), 'Name': x.Name.iloc[0]}), include_groups=False).reset_index()
rows = []
for (s, pid), g in pg[pg.IP >= 10].groupby(['Season', 'pid']):
    rk, cs = g[g.Division == 'Rocky'], g[g.Division.isin(['Cascade', 'Sierra'])]
    for _, a in rk.iterrows():
        for _, c in cs.iterrows():
            rows.append({'Name': a.Name, 'Season': s, 'd2': c.Division, 'f1': a.FIPm, 'f2': c.FIPm, 'ip1': a.IP, 'ip2': c.IP})
pit = pd.DataFrame(rows); pit.to_csv(OUT / 'rocky_cascade_sierra_pitcher_pairs.csv', index=False)

def style(ax):
    for s in ('top', 'right'): ax.spines[s].set_visible(False)
    ax.grid(True, color=GRID, lw=0.8); ax.set_axisbelow(True)

def scatter_panel(ax, x, y, d2, lim, xlabel, ylabel, title, lower_better=False, crossover=None):
    style(ax)
    ax.plot(lim, lim, ls=(0, (5, 4)), color=MUTED, lw=1.2, zorder=1, label='no drop-off (same in both)')
    ax.axhline(100, color=MUTED, lw=1, zorder=1); ax.axvline(100, color=MUTED, lw=1, zorder=1)
    for div, col in (('Sierra', SIERRA), ('Cascade', CASCADE)):
        m = d2 == div
        ax.scatter(x[m], y[m], s=46, color=col, edgecolor=SURF, linewidth=1.5, zorder=3, label=f'{div} ({m.sum()})')
    lr = stats.linregress(x, y); xs = np.array(lim)
    ax.plot(xs, lr.intercept + lr.slope * xs, color=FIT, lw=2, solid_capstyle='round', zorder=2, label='trend (best fit)')
    r, pv = stats.pearsonr(x, y)
    ax.set_xlim(lim); ax.set_ylim(lim); ax.set_aspect('equal')
    ax.set_xlabel(xlabel); ax.set_ylabel(ylabel)
    ax.set_title(title, loc='left', fontsize=12.5, fontweight='bold', color=INK, pad=10)
    ptxt = 'p < 0.001' if pv < 0.001 else f'p = {pv:.2f}'
    ax.text(0.02, 0.98, f'r = {r:.2f}  ({ptxt}, n = {len(x)})', transform=ax.transAxes, va='top', fontsize=10.5, color=INK, fontweight='bold')
    # reference-line labels, at the ends of the lines away from the data
    ax.text(lim[1] - 2, 101, 'Cascade/Sierra avg', fontsize=8.5, color=MUTED, va='bottom', ha='right')
    ax.text(101, lim[0] + 0.72 * (lim[1] - lim[0]), 'Rocky avg', fontsize=8.5, color=MUTED, rotation=90, va='top')
    if crossover:
        ax.annotate(crossover[1], xy=(crossover[0], 100), xytext=crossover[2], fontsize=9.5, color=INK, fontweight='bold',
                    arrowprops=dict(arrowstyle='-', color=INK2, lw=0.9, shrinkB=3))
        ax.scatter([crossover[0]], [100], s=26, color=INK, zorder=4)
    ax.legend(loc='lower right' if lower_better else 'upper left', bbox_to_anchor=None if lower_better else (0.0, 0.94),
              frameon=True, facecolor=SURF, edgecolor=GRID, framealpha=1, fontsize=9)
    return lr, r

def slope_panel(ax, a, b, left, right, title, fmt, lower_better=False, unit=''):
    style(ax); ax.grid(axis='x', visible=False)
    for i in range(len(a)):
        ax.plot([0, 1], [a[i], b[i]], color=MUTED, lw=0.9, alpha=0.55, solid_capstyle='round', zorder=1)
    ma, mb = np.mean(a), np.mean(b)
    ax.plot([0, 1], [ma, mb], color=SIERRA, lw=3, solid_capstyle='round', zorder=3, marker='o', ms=8, mec=SURF, mew=2)
    ax.text(-0.06, ma, fmt(ma), ha='right', va='center', fontsize=11, fontweight='bold', color=INK)
    ax.text(1.06, mb, fmt(mb), ha='left', va='center', fontsize=11, fontweight='bold', color=INK)
    worse = (b > a) if lower_better else (b < a)
    ax.set_xticks([0, 1]); ax.set_xticklabels([left, right], fontsize=10.5, color=INK)
    ax.set_xlim(-0.35, 1.35)
    ax.set_title(title, loc='left', fontsize=12.5, fontweight='bold', color=INK, pad=10)
    ax.text(0.5, 0.02, f'{worse.sum()} of {len(a)} got worse  ·  blue = average', transform=ax.transAxes, ha='center', fontsize=9.5, color=INK2)
    ax.set_ylabel(unit)
    if unit == 'wOBA': ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f'{v:.3f}'.lstrip('0')))
    if lower_better: ax.invert_yaxis()

fig, axes = plt.subplots(2, 2, figsize=(14, 12.4), gridspec_kw={'width_ratios': [1.25, 1], 'hspace': 0.3, 'wspace': 0.28})
fig.suptitle('Rocky → Cascade/Sierra: good players stay good, but everyone gets worse moving up',
             x=0.06, ha='left', fontsize=16, fontweight='bold', color=INK, y=0.982)
fig.text(0.06, 0.948, 'Same player, same season, playing in Rocky and in Cascade or Sierra (PSSBL 2015–2026). '
         'wRC+ and FIP- are measured against each division\'s own average (100 = average).',
         fontsize=10.5, color=INK2)

# hitting
fit = stats.linregress(hit.wrc1, hit.wrc2); cross = (100 - fit.intercept) / fit.slope
lr, r = scatter_panel(axes[0, 0], hit.wrc1.values, hit.wrc2.values, hit.d2.values, [0, 290],
                      'wRC+ in Rocky', 'wRC+ in Cascade / Sierra',
                      'HITTING · Rocky stars are above-average hitters a level up',
                      crossover=(cross, f'Rocky {cross:.0f} ≈ average\nin Cascade/Sierra', (190, 205)))
slope_panel(axes[0, 1], hit.woba1.values, hit.woba2.values, 'Rocky', 'Cascade / Sierra',
            'HITTING · Each hitter\'s wOBA drops ~.114', lambda v: f'{v:.3f}'.lstrip('0'), unit='wOBA')

# pitching (FIP-: lower is better)
scatter_panel(axes[1, 0], pit.f1.values, pit.f2.values, pit.d2.values, [20, 210],
              'FIP- in Rocky  (lower = better)', 'FIP- in Cascade / Sierra  (lower = better)',
              'PITCHING · Good Rocky pitchers stay better than their peers', lower_better=True)
slope_panel(axes[1, 1], pit.f1.values, pit.f2.values, 'Rocky', 'Cascade / Sierra',
            'PITCHING · FIP- rises from ~83 to ~115', lambda v: f'{v:.0f}', lower_better=True, unit='FIP-  (lower = better, axis flipped)')

fig.text(0.06, 0.02, 'Hitters: 58 pairs with 30+ PA in each division. Pitchers: 16 pairs with 10+ IP in each — a small sample, read it as directional. '
         'r = correlation of the player\'s two lines; trend = least-squares fit.\nDashed diagonal = where a player would sit if nothing changed between divisions. '
         'Source: pssbl.com stats; analysis in analysis/ of the pssbl-leaderboards repo.', fontsize=8.8, color=MUTED)
fig.subplots_adjust(top=0.9, bottom=0.1)
plt.savefig(OUT / 'rocky_to_cascade_sierra.png', dpi=150, bbox_inches='tight', facecolor=SURF)
print('hit trend: CS = %.1f + %.2f x Rocky; pitch pairs %d' % (lr.intercept, lr.slope, len(pit)))
