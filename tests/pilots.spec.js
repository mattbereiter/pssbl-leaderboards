// @ts-check
const { test, expect } = require('@playwright/test');
const { MATT, openSite, leaderRows } = require('./helpers');

// West Coast Pilots (2026 MSBL Arizona World Series roster), by pssbl id
const WCP = ['8291', '6259', '7061', '7215', '6616', '5238', '6331', '3393', '8048', '8287', '4182', '4778', '6642', '7623', '7525', '4506'];
const LABEL = 'West Coast Pilots (all divisions)';

/** @param {import('@playwright/test').Page} page */
const rowPids = (page) => page.locator('#lb-table tbody td.name a').evaluateAll((as) => as.map((a) => a.getAttribute('data-pid')));
/** @param {import('@playwright/test').Page} page */
const rowDivs = (page) => page.locator('#lb-table tbody td.col-div').evaluateAll((tds) => [...new Set(tds.map((td) => td.textContent.trim()))].sort());

/** @param {import('@playwright/test').Page} page */
async function openPilots(page) {
  await openSite(page);
  await page.locator('#lb-div').selectOption('Adams');
  await page.locator('#lb-team').selectOption({ label: LABEL });
  await page.locator('#lb-min').selectOption('0');
}

test.describe('West Coast Pilots team option', () => {
  test('is offered under Adams only', async ({ page }) => {
    await openSite(page);
    await expect(page.locator('#lb-team option', { hasText: 'West Coast Pilots' })).toHaveCount(0);
    await page.locator('#lb-div').selectOption('Adams');
    await expect(page.locator('#lb-team option', { hasText: 'West Coast Pilots' })).toHaveCount(1);
    await page.locator('#lb-div').selectOption('Rocky');
    await expect(page.locator('#lb-team option', { hasText: 'West Coast Pilots' })).toHaveCount(0);
  });

  test('lists Pilots players from every division, Matt in gold, with a note', async ({ page }) => {
    await openPilots(page);
    await expect(leaderRows(page).first()).toBeVisible();
    const pids = await rowPids(page);
    expect(pids.every((p) => WCP.includes(String(p)))).toBe(true);
    expect(new Set(pids).size).toBeGreaterThan(8);
    expect((await rowDivs(page)).length).toBeGreaterThan(2);
    await expect(page.locator(`#lb-table tbody tr.me a[data-pid="${MATT}"]`)).toHaveCount(2);
    await expect(page.locator('#lb-note')).toContainText('wRC+');
    await expect(page.locator('#lb-team')).toHaveValue('wcp');
  });

  test('stays on through pitching, qualified, date range and career', async ({ page }) => {
    await openPilots(page);
    await page.locator('#lb-type button[data-v="pit"]').click();
    await expect(page.locator('#lb-team')).toHaveValue('wcp');
    await expect(leaderRows(page).first()).toBeVisible();
    expect((await rowPids(page)).every((p) => WCP.includes(String(p)))).toBe(true);

    await page.locator('#lb-type button[data-v="bat"]').click();
    await page.locator('#lb-min').selectOption('q');
    await expect(page.locator('#lb-team')).toHaveValue('wcp');
    expect((await rowPids(page)).every((p) => WCP.includes(String(p)))).toBe(true);

    await page.locator('#lb-min').selectOption('0');
    const opts = await page.locator('#lb-range option').evaluateAll((os) => os.map((o) => o.value));
    await page.locator('#lb-range').selectOption(opts.find((v) => v !== 'full') || 'full');
    await expect(page.locator('#lb-team')).toHaveValue('wcp');
    await expect(leaderRows(page).first()).toBeVisible();
    expect((await rowPids(page)).every((p) => WCP.includes(String(p)))).toBe(true);

    await page.locator('#lb-season').selectOption('Career');
    await expect(page.locator('#lb-team')).toHaveValue('wcp');
    await expect(leaderRows(page).first()).toBeVisible();
    const career = await rowPids(page);
    expect(career.every((p) => WCP.includes(String(p)))).toBe(true);
    expect(new Set(career).size).toBe(career.length);
  });
});
