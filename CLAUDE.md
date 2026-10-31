# CLAUDE.md

Guidance for Claude Code in this repository.

## Read PROJECT.md first

`PROJECT.md` is the handoff doc: what the site is, where it's hosted, how the data pipeline works, the sabermetric
method and its constants, the known gotchas in pssbl.com's data, and the open ideas. Treat it as required background.
Don't duplicate it here.

## Project shape

A static site with no build server. Netlify publishes `public/` as-is on every push to `main`.

- **Page code** lives in `src/page.html` (markup, styles, the whole app script) and `src/shell.html` (the HTML wrapper,
  theme tokens and the small data loader). `public/index.html` is **generated**. Never edit it by hand.
  After editing `src/`, run `python scripts/build_page.py`.
- **Data** lives in `public/data/` and is **generated** by `python scripts/update.py`. Don't hand-edit CSVs.
- **Pipeline** (`scripts/`) is Python 3, standard library only.
- **Analysis** (`analysis/`) needs pandas, numpy, scipy and matplotlib (`analysis/requirements.txt`).
- **Not committed:** `raw/` (pssbl.com API cache) and `build/` (full computed tables). Recreate them with
  `python scripts/update.py --all`. That's about 18k requests and about 10 minutes, with 6 workers by design, so be gentle.

## Commands

```
python scripts/update.py --all      # first run on a machine: download 2015-now, compute, write public/data
python scripts/update.py            # refresh the latest season and rebuild
python scripts/update.py --offline  # rebuild from raw/ without downloading
python scripts/build_page.py        # src/ -> public/index.html
python scripts/verify.py            # spot-check public/data against pssbl.com (update.py runs it too)
npm test                            # Playwright smoke tests (first time: npm install && npx playwright install chromium webkit)
cd public && python -m http.server 8000   # preview at http://localhost:8000
git add -A && git commit -m "..." && git push   # Netlify deploys in ~20 s
```

## Rules for working here

- **Run `npm test` before pushing.** Playwright specs in `tests/` (desktop Chrome + iPhone WebKit) serve `public/`
  through `tests/serve.py` and cover Leaders, date ranges, Players, Standings, Guts, hidden-tab loading and console
  errors. Add a spec for the view you change, red/green style like the sibling PSSBL Tracker repo.
- **Numbers must reconcile with pssbl.com.** After any pipeline change, run `python scripts/verify.py 80`, which
  compares summed player-seasons with `CareerBatting` / `CareerPitching` (see PROJECT.md, "Verifying the data"). Counting stats should match
  exactly. Only team labels are allowed to differ, and only for the documented reason.
- **Each division-season is its own league.** Never compare raw rates across divisions or average league constants
  across divisions.
- **The page keeps the dashboard's data attributes** (`data-source`, `data-field`, `data-where`, `data-row-key`).
  They're harmless here. Keep them, because the same `src/page.html` is also used by Matt's Claude dashboard version.
- **Bump the data version on every data change.** `update.py` stamps `manifest.json` → `version`, and the loader
  appends `?v=` so browsers never mix a new page with cached old data. Don't remove this.
- **Background tabs:** the loader uses a `setTimeout` fallback when the tab is hidden, because `requestAnimationFrame`
  is paused there. Keep that fallback.

## Working style (Matt)

Matt is terse and casual. He wants to be shown results, not explanations, and prefers no long postambles.
He iterates in passes and likes previews or screenshots before committing to bigger features.
Preserve the current look: FanGraphs-style green header and tabs, compact sortable tables, gold rows with a ★ for
Matt (player id `8048`), and light/dark themes driven by the tokens in `src/shell.html`.
