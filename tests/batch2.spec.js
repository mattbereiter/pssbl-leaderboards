// @ts-check
// Batch 2 of the Nov 2026 roadmap: a Scores page, team pages, and player splits
const { test, expect } = require('@playwright/test');
const { MATT, trackErrors, tableRows } = require('./helpers');

test.describe('Scores', () => {
  test('one day at a time, Adams and Sierra first, Matt\'s games gold, each with its box score', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#scores?season=2026&date=2026-08-23');
    await expect(page.locator('#sc-title')).toHaveText('Scores · Sunday, August 23, 2026');
    const divs = page.locator('#sc-list .sc-div h3');
    await expect(divs.nth(0)).toHaveText('Adams');
    await expect(divs.nth(1)).toHaveText('Sierra');
    const mine = page.locator('#sc-list .sc-game.me');
    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText('Pirates');
    await expect(mine).toContainText('Beavers');
    await mine.locator('a[data-game]').click();
    await expect(page.locator('#pg-game')).toBeVisible();
    await expect(page).toHaveTitle(/Box score: Pirates 13 · Beavers 8/);
    expect(errors).toEqual([]);
  });

  test('the arrows step through days with games, and the day is in the link', async ({ page }) => {
    await page.goto('/#scores?season=2026&date=2026-08-23');
    await expect(page.locator('#sc-date')).toHaveValue('2026-08-23');
    await page.locator('#sc-days [data-step="-1"]').click();
    await expect(page.locator('#sc-date')).not.toHaveValue('2026-08-23');
    const prev = await page.locator('#sc-date').inputValue();
    expect(prev < '2026-08-23').toBe(true);
    await expect.poll(() => page.evaluate(() => location.hash)).toContain(`date=${prev}`);
    await page.locator('#sc-days [data-step="1"]').click();
    await expect(page.locator('#sc-date')).toHaveValue('2026-08-23');
  });

  test('a division filter keeps only its games; a team shows its whole season', async ({ page }) => {
    await page.goto('/#scores?season=2026&date=2026-08-23');
    await page.locator('#sc-div').selectOption('Sierra');
    await expect(page.locator('#sc-list .sc-div h3')).toHaveText(['Sierra']);
    await page.locator('#sc-div').selectOption('Adams');
    await page.locator('#sc-team').selectOption('1520');
    await expect(page.locator('#sc-days')).toBeHidden();
    await expect(page.locator('#sc-title')).toHaveText('Beavers · 2026 games');
    await expect(page.locator('#sc-list .sc-game')).toHaveCount(25); // 22 regular season + 3 playoff games
    await expect(page.locator('#sc-list .sc-game .po')).toHaveCount(3);
    await page.reload();
    await expect(page.locator('#sc-list .sc-game')).toHaveCount(25);
  });
});

test.describe('Team pages', () => {
  test('record, finish, one-run games, results and box links', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#team/1520');
    await expect(page.locator('#tm-name')).toHaveText('Beavers');
    await expect(page.locator('#tm-name')).toHaveClass(/me/);
    await expect(page.locator('#tm-sub')).toContainText('Adams · 2026');
    const strip = page.locator('#tm-strip');
    await expect(strip).toContainText('Record7-14-1');
    await expect(strip).toContainText('Finish7th of 9');
    await expect(strip).toContainText('1-run1-2');
    await expect(strip).toContainText('Playoffs2-1');
    await expect(page.locator('#tm-results .tm-res')).toHaveCount(25);
    await expect(page.locator('#tm-margin svg rect')).toHaveCount(25);
    const sched = await tableRows(page.locator('#tm-sched'));
    expect(sched).toHaveLength(25);
    expect(sched[21].Record).toBe('7-14-1');
    await expect(page).toHaveTitle(/^Beavers · Adams 2026 — PSSBL/);
    await page.locator('#tm-sched tbody tr', { hasText: 'Aug 23' }).locator('a[data-game]').click();
    await expect(page).toHaveTitle(/Box score: Pirates 13 · Beavers 8/);
    expect(errors).toEqual([]);
  });

  test('players, with Matt gold, a pitching tab in the link, and Open in Leaders', async ({ page }) => {
    await page.goto('/#team/1520');
    await expect(page.locator('#tm-roster-table tbody tr.me')).toContainText('Matt Bereiter');
    await page.locator('#tm-type button[data-v="pit"]').click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#team/1520?stats=pit');
    await expect(page.locator('#tm-roster-table thead th[data-field="FIP"]')).toBeVisible();
    await page.locator('#tm-lb').click();
    await expect(page.locator('#pg-leaders')).toBeVisible();
    await expect(page.locator('#lb-team')).toHaveAttribute('data-value', '1520');
  });

  test('head-to-head and history by team name', async ({ page }) => {
    await page.goto('/#team/1520');
    await expect(page.locator('#tm-h2h-table tbody tr', { hasText: 'Surf Dawgs' })).toBeVisible();
    const h2h = await tableRows(page.locator('#tm-h2h-table'));
    expect(h2h.find((r) => r.Opponent.startsWith('Surf Dawgs'))['2026']).toBe('3-0');
    await page.goto('/#team/1451'); // Pirates, Adams: on file since 2015
    await expect(page.locator('#tm-name')).toHaveText('Pirates');
    await expect(page.locator('#tm-hist-table a[data-team="646"]')).toBeVisible();
    const hist = await tableRows(page.locator('#tm-hist-table'));
    expect(hist.length).toBeGreaterThan(5);
    expect(hist[0].Season).toMatch(/^2026/);
    await page.locator('#tm-hist-table a[data-team="646"]').click();
    await expect(page.locator('#tm-sub')).toContainText('Adams · 2015');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#team/646');
  });

  test('team names elsewhere open the team page', async ({ page }) => {
    await page.goto('/#standings?season=2026');
    await page.locator('#div-Adams tbody tr.me a[data-team]').click();
    await expect(page.locator('#tm-name')).toHaveText('Beavers');
    await page.goto('/#game/22658');
    await expect(page.locator('#gm-teams h3 a[data-team]').first()).toBeVisible();
    await page.locator('#gm-teams h3 a[data-team="1520"]').click();
    await expect(page.locator('#tm-name')).toHaveText('Beavers');
    await page.goto('/#team/999999');
    await expect(page.locator('#tm-name')).toHaveText('Team not found');
  });
});

test.describe('Player splits', () => {
  test('a combined line across teams, each from its own division\'s constants', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`/#players/${MATT}`);
    const card = page.locator('#p-splits');
    await expect(card).toBeVisible();
    await card.locator('summary').click();
    await expect(page.locator('#p-sp-season')).toHaveValue('2026');
    await expect(page.locator('#p-sp-table tr.tot')).toBeVisible();
    const rows = await tableRows(page.locator('#p-sp-table'));
    const total = rows.find((r) => r.Split === 'Total');
    expect(total.PA).toBe('98'); // 59 for the Beavers (Adams) + 39 for the Brewers (Sierra)
    expect(Math.abs(Number(total['wRC+']) - 72)).toBeLessThanOrEqual(1);
    for (const s of ['Regular season', 'Playoffs', '1st half', '2nd half', 'Home', 'Away', 'May', 'Batting 7th']) expect(rows.some((r) => r.Split === s)).toBe(true);
    const halves = rows.filter((r) => /half$/.test(r.Split)).reduce((n, r) => n + Number(r.PA), 0);
    const reg = rows.find((r) => r.Split === 'Regular season');
    expect(halves).toBe(Number(reg.PA));
    for (const g of ['Season', 'Half', 'Month', 'Home / away', 'Lineup slot', 'Opponent', 'Field']) await expect(page.locator('#p-sp-table tr.grp', { hasText: g })).toHaveCount(1);
    // small samples are greyed
    await expect(page.locator('#p-sp-table tr.small', { hasText: 'Playoffs' })).toHaveCount(1);
    await expect(page.locator('#p-sp-table tr.small', { hasText: 'Regular season' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('career and pitching', async ({ page }) => {
    await page.goto(`/#players/${MATT}`);
    await expect(page.locator('#p-splits')).toBeVisible();
    await page.locator('#p-splits summary').click();
    await page.locator('#p-sp-season').selectOption('Career');
    await expect(page.locator('#p-sp-note')).toContainText('Every season with box scores');
    const career = Number((await tableRows(page.locator('#p-sp-table'))).find((r) => r.Split === 'Total').PA);
    expect(career).toBeGreaterThan(98);
    await page.locator('#p-sp-type button[data-v="pit"]').click();
    await expect(page.locator('#p-sp-table thead th[data-field="FIP-"]')).toBeVisible();
    await expect(page.locator('#p-sp-table tr.grp', { hasText: 'Role' })).toHaveCount(1);
  });
});
