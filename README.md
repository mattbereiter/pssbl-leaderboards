# PSSBL Leaderboards

FanGraphs-style stats for the Puget Sound Senior Baseball League: sortable leaderboards with
date ranges, player pages with careers, standings with Pythagorean records, and the league
constants behind wRC+, FIP and WAR. Data comes from [pssbl.com](https://pssbl.com)'s public stats
API; this is an unofficial fan site.

## How it's put together

- `public/` is the whole website (GitHub Pages publishes this folder as-is, no build step).
  - `index.html` — the page (generated from `src/`, don't edit directly)
  - `data/` — the stats files the page loads, listed in `data/manifest.json`
  - `d3.min.js` — charting library (d3 v7.9.0)
- `src/page.html` — the leaderboard page itself (markup, styles, script)
- `src/shell.html` — the surrounding HTML, theme colors and the small data loader
- `scripts/` — the data pipeline (Python 3, standard library only)
  - `fetch.py` downloads from pssbl.com into `raw/` (a local cache, not committed)
  - `compute.py` builds the season, career, standings and league-constant tables
  - `build_box.py` builds per-game lines for the date filter
  - `update.py` runs all of the above and writes `public/data/`
  - `build_page.py` rebuilds `public/index.html` from `src/`

## Updating the stats

```
python scripts/update.py --all   # first time on a computer: downloads 2015-now (~10 min)
python scripts/update.py         # afterwards: re-downloads the latest season and rebuilds
git add -A && git commit -m "Update stats" && git push
```

The Pages workflow sees the push and the site is live again in about a minute.

## Changing the page

Edit `src/page.html` (or `src/shell.html`), run `python scripts/build_page.py`, then commit and push.
To preview locally: `cd public && python -m http.server 8000` and open http://localhost:8000.

## Analysis

`analysis/` holds one-off research on how performance carries across divisions, plus a projection script
(`python analysis/project_to_adams.py "Player Name"`). It needs `pip install -r analysis/requirements.txt` and a
`build/` folder from `scripts/update.py`. See PROJECT.md for findings.

## For Claude Code

`CLAUDE.md` (working rules) and `PROJECT.md` (full handoff: data source, gotchas, method, architecture, open ideas).

## Method notes

- Each division-season is its own league (like the AL and NL): wRC+, FIP, ERA- and WAR compare a
  player to his own division that year. FanGraphs linear weights, wOBA scale 1.20.
- WAR is simplified: hitters get offense + baserunning (oWAR, no fielding or position), pitchers get
  FIP-based WAR.
- Qualifying: 2 PA or 0.5 IP per team game (career: 150 PA / 50 IP).
- pssbl.com's season totals sometimes label a player with a team he only filled in for; each line is
  labelled with the team he played the most games for, from the box scores.
