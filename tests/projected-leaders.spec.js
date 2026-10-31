// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, leaderRows, leaderTable } = require('./helpers');

// Same numbers as the Players card (tests/projection.spec.js) and analysis/project_to_adams.py.
test.describe('Leaders: Projected → Adams / Sierra', () => {
  test('ranks other-division players by projected wRC+ in Adams', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#leaders?season=ProjAdams');
    await expect(leaderRows(page).first()).toBeVisible();
    await expect(page.locator('#lb-title')).toContainText('projected in Adams');
    await expect(page.locator('#lb-note')).toContainText(/self-selected/i);
    await expect(page.locator('#lb-range-ctrl')).toBeHidden();
    await expect(page.locator('#lb-group button').first()).toBeHidden();

    const rows = await leaderTable(page);
    expect(rows.length).toBeGreaterThan(20);
    const wrc = rows.map((r) => Number(r['wRC+']));
    expect(wrc[0]).toBeGreaterThanOrEqual(wrc[1]);
    for (const r of rows) expect(r.From).not.toBe('');
    for (const r of rows) expect(r.From).not.toBe('Adams'); // Adams-only players have nothing to translate into Adams

    await page.locator('#lb-q').fill('aj hansen');
    await expect(leaderRows(page)).toHaveCount(1);
    const [aj] = await leaderTable(page);
    expect(aj).toMatchObject({ AVG: '.347', OBP: '.467', SLG: '.508', wOBA: '.423', 'wRC+': '132', 'Eff PA': '307', 'Own%': '84' });
    expect(aj.From).toContain('Rocky');
    await expect(page.locator('#lb-cards')).toContainText('AJ Hansen');
    expect(errors).toEqual([]);
  });

  test('pitchers sort by projected FIP- (low first)', async ({ page }) => {
    await page.goto('/#leaders?type=pit&season=ProjAdams');
    await expect(leaderRows(page).first()).toBeVisible();
    const rows = await leaderTable(page);
    expect(Number(rows[0]['FIP-'])).toBeLessThanOrEqual(Number(rows[1]['FIP-']));
    await page.locator('#lb-q').fill('cameron lobb');
    await expect(leaderRows(page)).toHaveCount(1);
    expect((await leaderTable(page))[0]).toMatchObject({ 'FIP-': '81', FIP: '4.14', 'K%': '25.9 %', 'BB%': '6.5 %' });
  });

  test('the division filter means "came from", and Sierra is in the season menu', async ({ page }) => {
    await page.goto('/#leaders?season=ProjAdams&div=Rocky');
    await expect(leaderRows(page).first()).toBeVisible();
    for (const r of await leaderTable(page)) expect(r.From).toContain('Rocky');

    await page.locator('#lb-season').selectOption({ label: 'Projected → Sierra' });
    await expect(page).toHaveURL(/season=ProjSierra/);
    await page.locator('#lb-q').fill('aj hansen');
    await expect(leaderRows(page)).toHaveCount(1);
    expect((await leaderTable(page))[0]).toMatchObject({ 'wRC+': '129' });
  });

  test('"Adams, Sierra, Rocky, Denali" keeps only players from those four divisions', async ({ page }) => {
    await page.goto('/#leaders?season=ProjAdams');
    await expect(leaderRows(page).first()).toBeVisible();
    const count = async () => Number((await page.locator('#lb-count').textContent()).match(/^[\d,]+/)[0].replace(',', ''));
    const all = await count();
    await page.locator('#lb-div').selectOption({ label: 'Adams, Sierra, Rocky, Denali' });
    await expect(page).toHaveURL(/div=Top4/);
    const rows = await leaderTable(page);
    expect(rows.length).toBeGreaterThan(10);
    expect(await count()).toBeLessThan(all);
    const top4 = ['Adams', 'Sierra', 'Rocky', 'Denali'];
    for (const r of rows) for (const d of r.From.split(', ')) expect(top4).toContain(d);

    await page.goto('/?5#leaders?season=ProjSierra&div=Top4&q=aj%20hansen'); // survives a reload, works for Sierra
    await expect(leaderRows(page)).toHaveCount(1);
    await expect(page.locator('#lb-div')).toHaveValue('Top4');
  });

  test('Adams players show up projected to Sierra, Sierra players to Adams, Matt in both', async ({ page }) => {
    await page.goto('/#leaders?season=ProjSierra&q=noah%20zwiren');
    await expect(leaderRows(page)).toHaveCount(1);
    expect((await leaderTable(page))[0]).toMatchObject({ From: 'Adams', 'wRC+': '104' });

    await page.goto('/?2#leaders?season=ProjAdams&q=noah%20zwiren'); // ?n: a real load each time, not a hash change
    await expect(page.locator('#lb-table caption')).toContainText('No players match');

    await page.goto('/?3#leaders?season=ProjAdams&q=paul%20fisher');
    await expect(leaderRows(page)).toHaveCount(1);
    expect((await leaderTable(page))[0]).toMatchObject({ From: 'Sierra', 'wRC+': '132' });

    await page.goto('/?4#leaders?season=ProjSierra&q=bereiter');
    await expect(page.locator('#lb-table tbody tr.me')).toHaveCount(1);
    expect((await leaderTable(page))[0]).toMatchObject({ 'wRC+': '79' });
  });

  test('going back to a normal season restores the usual table', async ({ page }) => {
    await page.goto('/#leaders?season=ProjAdams');
    await expect(leaderRows(page).first()).toBeVisible();
    await page.locator('#lb-season').selectOption('2026');
    await expect(page.locator('#lb-group button').first()).toBeVisible();
    await expect(page.locator('#lb-title')).toContainText('2026');
    await expect(page.locator('#lb-table thead')).toContainText('oWAR');
  });
});
