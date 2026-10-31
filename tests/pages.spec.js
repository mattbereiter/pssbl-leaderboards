// @ts-check
const { test, expect } = require('@playwright/test');
const { MATT, trackErrors, openSite, goTab } = require('./helpers');

test.describe('Players', () => {
  test('My page opens Matt with his 2026 Beavers line', async ({ page }) => {
    const errors = trackErrors(page);
    await openSite(page);
    await goTab(page, 'me');
    await expect(page.locator('#p-name')).toHaveText('Matt Bereiter');
    await expect(page.locator('#p-name')).toHaveClass(/\bme\b/);
    await expect(page.locator('#p-sub a')).toHaveAttribute('href', `https://pssbl.com/#!/player/${MATT}`);
    await expect(page.locator('#p-bat-chart svg circle').first()).toBeVisible();

    // PROJECT.md spot check: Matt 2026 Beavers (Adams) .292/.390/.333, 82 wRC+
    const line = await page.locator('#p-bat-tables tr', { hasText: 'Beavers' }).filter({ hasText: '2026' }).evaluate((tr) => {
      const t = tr.closest('table');
      const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      const o = {}; [...tr.cells].forEach((td, i) => { o[heads[i]] = td.textContent.trim(); }); return o;
    });
    expect(line).toMatchObject({ Season: '2026', Team: 'Beavers', Div: 'Adams', AVG: '.292', OBP: '.390', SLG: '.333', 'wRC+': '82' });

    await expect(page.locator('#p-bat-tables tr.career')).toHaveCount(1);
    await expect(page.locator('#p-pit')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('search finds a player and opens their page', async ({ page }) => {
    await openSite(page, 'players');
    await page.locator('#p-q').fill('hansen');
    const first = page.locator('#p-sugg button').first();
    await expect(first).toBeVisible();
    const name = ((await first.textContent()) || '').split(' · ')[0].trim();
    await first.click();
    await expect(page.locator('#p-name')).toHaveText(name);
    await expect(page.locator('#p-sugg')).toBeHidden();
  });

  test('search typed before the player list loads fills in once it arrives', async ({ page }) => {
    let release = () => {};
    const gate = new Promise((r) => { release = r; });
    await page.route('**/data/*_career.csv*', async (route) => { await gate; await route.continue(); });
    await page.goto('/#players');
    await page.locator('#p-q').fill('hansen');
    await expect(page.locator('#p-sugg')).toHaveText('Loading players…');
    release();
    await expect(page.locator('#p-sugg button').first()).toBeVisible();
  });
});

test.describe('Standings', () => {
  test('shows every division with teams, and a team click filters Leaders', async ({ page }) => {
    const errors = trackErrors(page);
    await openSite(page, 'standings');
    const cards = page.locator('#st-grid .pg-card');
    await expect(cards).toHaveCount(10);
    for (const c of await cards.all()) expect(await c.locator('tbody tr').count()).toBeGreaterThan(1);

    const link = page.locator('#div-Adams tbody tr a[data-tid]').first();
    const tid = await link.getAttribute('data-tid');
    await link.click();
    await expect(page.locator('#pg-leaders')).toBeVisible();
    await expect(page.locator('#lb-div')).toHaveAttribute('data-value', 'Adams');
    await expect(page.locator('#lb-team')).toHaveValue(String(tid));
    expect(errors).toEqual([]);
  });
});

test.describe('Guts', () => {
  test('lists the league constants and the glossary', async ({ page }) => {
    const errors = trackErrors(page);
    await openSite(page, 'guts');
    await expect(page.locator('#gu-table tbody tr')).toHaveCount(10);
    await expect(page.locator('#gu-table thead')).toContainText('cFIP');
    await page.locator('#gu-season').selectOption('All');
    expect(await page.locator('#gu-table tbody tr').count()).toBeGreaterThan(90);
    await expect(page.locator('#glossary dt', { hasText: 'wRC / wRC+' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
