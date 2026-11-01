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
});
