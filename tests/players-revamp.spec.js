// @ts-check
// Players page revamp: quick look, percentiles, one stats card with Batting/Pitching tabs, season totals, the career arc,
// a finder landing page and a collapsed projection
const { test, expect } = require('@playwright/test');
const { MATT, trackErrors } = require('./helpers');

const GIBSON = '561'; // pitches far more than he hits
const GLEASON = '843';

test.describe('Players revamp', () => {
  test('a quick look up top: latest season against career, and the roles he plays', async ({ page }) => {
    await page.goto(`/#players/${MATT}`);
    const ql = page.locator('#p-ql-bat');
    await expect(ql).toBeVisible();
    await expect(ql.locator('tbody tr')).toHaveCount(2);
    await expect(ql.locator('tbody tr').first()).toContainText('2026');
    await expect(ql.locator('tbody tr.career')).toContainText('Career');
    await expect(page.locator('#p-roles .pg-role')).toHaveText(['Hitter', 'Pitcher']);
  });

  test('percentile bars for the latest season, ranked within the division', async ({ page }) => {
    await page.goto(`/#players/${MATT}`);
    const bars = page.locator('#p-pct-body .pg-pbar');
    await expect(bars.first()).toBeVisible();
    await expect(page.locator('#p-pct-body .pg-pbar[data-stat="wRC+"]')).toHaveCount(1);
    const p = Number(await page.locator('#p-pct-body .pg-pbar[data-stat="wRC+"] .p').textContent());
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(100);
  });

  test('the stats card opens on what the player mostly does', async ({ page }) => {
    await page.goto(`/#players/${MATT}`);
    await expect(page.locator('#p-type button').first()).toHaveAttribute('data-v', 'bat');
    await expect(page.locator('#p-bat')).toBeVisible();
    await expect(page.locator('#p-pit')).toBeHidden();

    await page.goto(`/#players/${GIBSON}`);
    await expect(page.locator('#p-type button').first()).toHaveAttribute('data-v', 'pit');
    await expect(page.locator('#p-pit')).toBeVisible();
    await expect(page.locator('#p-bat')).toBeHidden();
  });

  test('the Pitching tab is in the link', async ({ page }) => {
    await page.goto(`/#players/${MATT}`);
    await page.locator('#p-type button[data-v="pit"]').click();
    await expect(page).toHaveURL(/stats=pit/);
    await page.reload();
    await expect(page.locator('#p-type button[data-v="pit"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#p-pit-tables tbody tr').first()).toBeVisible();
  });

  test('a season on two teams gets a Total line with the teams under it, and career sits in the footer', async ({ page }) => {
    await page.goto(`/#players/${MATT}`);
    const tbl = page.locator('#p-bat-tables table');
    const tot = tbl.locator('tbody tr.tot', { hasText: '2026' });
    await expect(tot).toContainText('2 teams');
    await expect(tbl.locator('tbody tr.sub')).not.toHaveCount(0);
    await expect(tbl.locator('tfoot tr.career')).toContainText('Career');
  });

  test('season tables sort by any column, and the header says which way', async ({ page }) => {
    await page.goto(`/#players/${MATT}`);
    const th = page.locator('#p-bat-tables thead th:has(button[data-sort="wRC+"])');
    await th.locator('button').click();
    await expect(th).toHaveAttribute('aria-sort', 'descending');
    const firstTot = Number((await page.locator('#p-bat-tables tbody tr:not(.sub)').first().locator('td').allInnerTexts())[0]);
    expect(firstTot).toBeGreaterThan(2014);
    await th.locator('button').click();
    await expect(th).toHaveAttribute('aria-sort', 'ascending');
  });

  test('the chart is a career arc by season, with a Teams view in the link', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`/#players/${MATT}`);
    await expect(page.locator('#p-bat-chart svg path.arc')).toHaveCount(1);
    await expect(page.locator('#p-bat-chart svg')).toHaveAttribute('role', 'img');
    await page.locator('#p-bat button[data-chart="team"]').click();
    await expect(page).toHaveURL(/chart=team/);
    await expect(page.locator('#p-bat-chart path.arc')).toHaveCount(0);
    await expect(page.locator('#p-bat-chart .pg-legend')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the projection is folded away at the foot, with its headline numbers on the fold', async ({ page }) => {
    await page.goto(`/#players/${GLEASON}`);
    const proj = page.locator('#p-proj');
    await expect(proj).toBeVisible();
    await expect(proj).not.toHaveAttribute('open', '');
    await expect(page.locator('#p-proj-sum')).toHaveText(/wRC\+ \d+/);
    await page.locator('#p-proj summary').click();
    await expect(page.locator('#p-proj-bat')).toBeVisible();
  });

  test('the Players tab opens a finder: search, recent players and this season\'s rosters', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#players');
    await expect(page.locator('#p-name')).toHaveText('Players');
    await expect(page.locator('#p-find')).toBeVisible();
    await expect(page.locator('#p-stats')).toBeHidden();
    await expect(page.locator('#p-find-div')).toHaveValue('Adams');
    await expect(page.locator('#p-find-teams .pg-lcard').first()).toBeVisible();
    await expect(page.locator(`#p-find-teams li.me a[data-pid="${MATT}"]`)).toHaveCount(1);

    await page.locator('#p-find-teams .pg-lcard a[data-pid]').first().click();
    await expect(page).toHaveURL(/#players\/\d+/);
    await expect(page.locator('#p-stats')).toBeVisible();

    await page.locator('#tab-players').click();
    await expect(page).toHaveURL(/#players$/);
    await expect(page.locator('.pg-recent a.pg-chip').first()).not.toHaveAttribute('data-pid', MATT); // the one just opened
    await page.locator('#tab-me').click();
    await expect(page.locator('#p-name')).toContainText('Matt Bereiter');
    expect(errors).toEqual([]);
  });
});
