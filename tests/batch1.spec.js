// @ts-check
// Batch 1 of the Nov 2026 roadmap: Retry on failed loads, small bug fixes, Last 14/30 days, Projected columns, Standings
const { test, expect } = require('@playwright/test');
const { MATT, trackErrors, openSite, leaderRows, leaderTable, pickDivs, pickTeams, tableRows } = require('./helpers');

test.describe('Retry on failed loads', () => {
  test('a failed file shows Retry, and Retry loads it', async ({ page }) => {
    let fail = true;
    await page.route('**/data/standings.json*', (r) => (fail ? r.abort() : r.continue()));
    await page.goto('/#standings');
    const retry = page.locator('#st-grid .pg-retry');
    await expect(retry).toBeVisible();
    fail = false;
    await retry.click();
    await expect(page.locator('#st-grid table').first()).toBeVisible();
  });

  test('a failed manifest is asked for again instead of breaking the session', async ({ page }) => {
    let fail = true;
    await page.route('**/data/manifest.json*', (r) => (fail ? r.fulfill({ status: 503, body: 'down' }) : r.continue()));
    await page.goto('/#leaders');
    await expect(page.locator('#lb-wrap .pg-retry')).toBeVisible();
    fail = false;
    await page.locator('#lb-wrap .pg-retry').click();
    await expect(leaderRows(page).first()).toBeVisible();
  });

  test('coming back online retries on its own', async ({ page }) => {
    let fail = true;
    await page.route('**/data/standings.json*', (r) => (fail ? r.abort() : r.continue()));
    await page.goto('/#standings');
    await expect(page.locator('#st-grid .pg-retry')).toBeVisible();
    fail = false;
    await page.evaluate(() => dispatchEvent(new Event('online')));
    await expect(page.locator('#st-grid table').first()).toBeVisible();
  });
});

test.describe('Small fixes', () => {
  test('a team with no player stats shows — for team WAR, not 0.0', async ({ page }) => {
    await page.goto('/#standings?season=2026');
    const nuts = page.locator('#div-Rocky tbody tr', { hasText: 'Nuts' });
    await expect(nuts).toBeVisible();
    const row = (await tableRows(page.locator('#div-Rocky table'))).find((r) => r.Team.startsWith('Nuts'));
    expect(row.oWAR).toBe('—');
    expect(row.pWAR).toBe('—');
  });

  test('Projected → Adams doesn\'t offer Adams as a "from" division (but All except still can)', async ({ page }) => {
    await openSite(page, 'leaders?season=ProjAdams');
    await page.locator('#lb-div').click();
    await expect(page.locator('#lb-div-list input[value="Rocky"]')).toBeVisible();
    await expect(page.locator('#lb-div-list input[value="Adams"]')).toHaveCount(0);
    await page.locator('#lb-div-list button[data-mode="except"]').click();
    await expect(page.locator('#lb-div-list input[value="Adams"]')).toHaveCount(1);
  });

  test('leader cards name the division when teams from several divisions mix, not within one', async ({ page }) => {
    await openSite(page, 'leaders?season=2026');
    await expect(page.locator('#lb-cards .pg-lcard li .t').first()).toContainText(/ · (Adams|Sierra|Cascade|Denali|Rocky|Smoky|Everest|Teton|Rainier|Adirondack)$/);
    await pickDivs(page, 'Cascade');
    await expect(page.locator('#lb-cards .pg-lcard li .t').first()).not.toContainText('·');
  });

  test('the box score tab title never reads "— —" while loading', async ({ page }) => {
    await page.route('**/data/games.csv*', async (r) => { await new Promise((ok) => setTimeout(ok, 1200)); await r.continue(); });
    await page.goto('/#game/22658');
    await page.waitForTimeout(400);
    expect(await page.title()).toMatch(/^Box score — PSSBL/);
    await expect(page).toHaveTitle(/Box score: Pirates 13 · Beavers 8/);
  });

  test('opening another player by link clears the search box', async ({ page }) => {
    await page.goto(`/#players/${MATT}`);
    await expect(page.locator('#p-name')).toHaveText('Matt Bereiter');
    await page.locator('#p-q').fill('varnier');
    await page.locator('#p-name').click(); // focus leaves the box
    await page.evaluate(() => { location.hash = '#players/2127'; });
    await expect(page.locator('#p-name')).toHaveText('Richard Shaw');
    await expect(page.locator('#p-q')).toHaveValue('');
  });

  test('the header mini table fits a phone, last column included', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#players/${MATT}`);
    for (const id of ['#p-ql-bat', '#p-ql-pit']) {
      const t = page.locator(id);
      await expect(t).toBeVisible();
      const fits = await t.evaluate((el) => { const s = el.closest('.pg-stack'); return s.scrollWidth <= s.clientWidth + 1 && el.getBoundingClientRect().right <= document.documentElement.clientWidth; });
      expect(fits).toBe(true);
    }
  });
});

test.describe('Last 14 / 30 days', () => {
  test('counts back from each team\'s own last game, with a Δ wRC+ hot/cold column', async ({ page }) => {
    const errors = trackErrors(page);
    await openSite(page, 'leaders?season=2026');
    await page.locator('#lb-range').selectOption('l14');
    await expect(page.locator('#lb-title')).toContainText('Last 14 days');
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('range=l14');
    await expect(page.locator('#lb-note')).toContainText('its own last game');
    await expect(page.locator('#lb-table thead th[data-col="Δ wRC+"]')).toBeVisible();
    // Matt's Beavers ended Sep 13: Sep 1 (1 PA), Sep 11 (3), Sep 13 (2) are in; Aug 23 is out
    await pickTeams(page, '1520');
    const me = (await leaderTable(page)).find((r) => r.Name.startsWith('Matt Bereiter'));
    expect(me.PA).toBe('6');
    // sorting by Δ puts the hottest first
    await page.locator('#lb-table thead th[data-col="Δ wRC+"] button').click();
    const ds = (await leaderTable(page)).map((r) => r['Δ wRC+']).filter(Boolean).map((v) => Number(v.replace('−', '-')));
    expect(ds).toEqual([...ds].sort((a, b) => b - a));
    expect(errors).toEqual([]);
  });

  test('Last 30 days is wider than 14', async ({ page }) => {
    await openSite(page, 'leaders?season=2026&range=l14&min=0');
    await expect(page.locator('#lb-note')).toContainText('box scores');
    const n14 = Number((await page.locator('#lb-note').textContent()).match(/from ([\d,]+) box scores/)[1].replace(',', ''));
    await page.locator('#lb-range').selectOption('l30');
    await expect(page.locator('#lb-title')).toContainText('Last 30 days');
    await expect.poll(async () => Number(((await page.locator('#lb-note').textContent()).match(/from ([\d,]+) box scores/) || [0, '0'])[1].replace(',', ''))).toBeGreaterThan(n14);
  });
});

test.describe('Projected boards for recruiting', () => {
  test('show this season\'s team and the last season\'s line', async ({ page }) => {
    await openSite(page, 'leaders?season=ProjCascade&min=0&size=250');
    await expect(page.locator('#lb-table thead th[data-col="NowTeam"]')).toHaveText('2026 team');
    await expect(page.locator('#lb-table thead th[data-col="Last"]')).toBeVisible();
    await expect(page.locator('#lb-table thead th[data-col="Last wRC+"]')).toBeVisible();
    const rows = await leaderTable(page);
    expect(rows.some((r) => r['2026 team'] === '—' && Number(r.Last) < 2026)).toBe(true);
    await page.locator('#lb-q').fill('bereiter');
    await expect(leaderRows(page)).toHaveCount(1);
    const [me] = await leaderTable(page);
    expect(me['2026 team']).toBe('Beavers'); // more PA there than for the Brewers
    expect(me.Last).toBe('2026');
    expect(Number(me['Last wRC+'])).toBeGreaterThan(50);
  });
});

test.describe('Standings', () => {
  test('headers sort every division, and the sort is in the link', async ({ page }) => {
    await page.goto('/#standings?season=2026');
    await page.locator('#div-Adams thead button[data-sort="Luck"]').click();
    await expect(page.locator('#div-Adams thead th[data-field="Luck"]')).toHaveAttribute('aria-sort', 'descending');
    for (const d of ['Adams', 'Rocky']) {
      const lk = (await tableRows(page.locator(`#div-${d} table`))).map((r) => Number(r.Luck));
      expect(lk).toEqual([...lk].sort((a, b) => b - a));
    }
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('sort=Luck');
    await page.reload();
    await expect(page.locator('#div-Sierra thead th[data-field="Luck"]')).toHaveAttribute('aria-sort', 'descending');
  });

  test('a bar jumps to any division, and Matt\'s teams are gold', async ({ page }) => {
    await page.goto('/#standings?season=2026');
    await expect(page.locator('#st-jump button').first()).toHaveText('Adams');
    await expect(page.locator('#st-jump button').nth(1)).toHaveText('Sierra');
    await page.locator('#st-jump button[data-div="Teton"]').click();
    await expect(page.locator('#div-Teton')).toBeInViewport();
    await expect(page.locator('#div-Adams tbody tr.me')).toHaveText(/Beavers/);
    await expect(page.locator('#div-Sierra tbody tr.me')).toHaveText(/Brewers/);
    await expect(page.locator('#st-grid tbody tr.me')).toHaveCount(2);
  });
});
