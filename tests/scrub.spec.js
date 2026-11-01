// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, openSite, tableRows, leaderRows } = require('./helpers');

// Fixes from the deep-scrub audit (Oct 31, 2026).
test.describe('Deep-scrub fixes', () => {
  test('box score pitching lines show — for HR allowed from 2017 on, like every other view', async ({ page }) => {
    await page.goto('/#game/21972'); // 2026
    const pit = page.locator('#gm-teams > .pg-card').first().locator('table[data-kind="pit"]');
    await expect(pit).toBeVisible();
    const rows = await tableRows(pit, 'tbody tr, tfoot tr');
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(r.HR).toBe('—');
  });

  test('"What the columns mean" rounds counting-stat cut-offs', async ({ page }) => {
    await openSite(page);
    await page.locator('#lb-defs summary').click();
    await expect(page.locator('#lb-defs-list')).toContainText('top quarter');
    expect(await page.locator('#lb-defs-list').textContent()).not.toMatch(/\d\.\d{3,}/);
  });

  test('a fractional page in a link opens a whole page', async ({ page }) => {
    const errors = trackErrors(page);
    await openSite(page, 'leaders?min=0&page=1.5');
    await expect(page.locator('#lb-pageinfo')).toHaveText(/^1–50 of/);
    await expect(leaderRows(page)).toHaveCount(50);
    expect(errors).toEqual([]);
  });

  test('finder roster names are styled links, not browser blue', async ({ page }) => {
    await page.goto('/#players');
    const a = page.locator('#p-find-teams li a').first();
    await expect(a).toBeVisible();
    expect(await a.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
    expect(await a.evaluate((el) => getComputedStyle(el).color)).not.toBe('rgb(0, 0, 238)');
  });

  test('every column-set button fits on the Players stats card', async ({ page }) => {
    await page.goto('/#players/8048');
    const grp = page.locator('#p-group');
    await expect(grp.locator('button').last()).toBeVisible();
    const [box, last] = await Promise.all([grp.boundingBox(), grp.locator('button').last().boundingBox()]);
    expect(last.x + last.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(await grp.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });

  test('standings tables are not cut off on a desktop screen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'phones scroll each table sideways');
    await page.goto('/#standings');
    await expect(page.locator('#st-grid .pg-card table').first()).toBeVisible();
    const clipped = await page.locator('#st-grid .pg-tblwrap').evaluateAll((ws) => ws.filter((w) => w.scrollWidth > w.clientWidth + 1).length);
    expect(clipped).toBe(0);
  });
});
