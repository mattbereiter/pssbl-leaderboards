// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, MATT } = require('./helpers');

const rows = (page) => page.locator('#p-log-table tbody tr');
// the log opens on the last ten games
const showAll = (page) => page.locator('#p-log-more').click();

test.describe('Players: game log', () => {
  test('lists every game of a season, newest first, with opponent and score', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`/#players/${MATT}?log=2026`); // pinned: the default is his latest season, which moves on
    await expect(page.locator('#p-log-season')).toHaveValue('2026');
    await expect(rows(page)).toHaveCount(10);
    await expect(page.locator('#p-log-more')).toHaveText('Show all 35 games');
    await showAll(page);
    await expect(rows(page)).toHaveCount(35);
    const first = await rows(page).first().locator('td').first().textContent();
    const last = await rows(page).last().locator('td').first().textContent();
    expect(first).toBe('Sep 13PO'); // a playoff game
    expect(last).toBe('May 2');
    // May 3: Beavers at Diablos, lost 11-6
    const may3 = page.locator('#p-log-table tbody tr[data-key="21972"]');
    await expect(may3).toContainText('Beavers');
    await expect(may3).toContainText('@ Diablos');
    await expect(may3).toContainText('L 6–11');
    await expect(page.locator('#p-log-table tfoot')).toContainText('Total');
    expect(errors).toEqual([]);
  });

  test('switches to pitching and to an older season, and the link keeps it', async ({ page }) => {
    await page.goto(`/#players/${MATT}?log=2026`);
    await showAll(page);
    await expect(rows(page)).toHaveCount(35);
    await page.locator('#p-log-type button[data-v="pit"]').click();
    await expect(rows(page)).toHaveCount(19);
    // May 2: Brewers at Aqua Sox, 3.1 IP, lost 5-1
    const may2 = page.locator('#p-log-table tbody tr[data-key="21967"]');
    await expect(may2).toContainText('@ Aqua Sox');
    await expect(may2).toContainText('L 1–5');
    await expect(may2).toContainText('3.1');

    await page.locator('#p-log-type button[data-v="bat"]').click();
    await page.locator('#p-log-season').selectOption('2025');
    await expect(rows(page)).toHaveCount(14);
    expect(decodeURIComponent(await page.evaluate(() => location.hash))).toContain('log=2025');
    await page.reload();
    await expect(page.locator('#p-log-season')).toHaveValue('2025');
    await expect(rows(page)).toHaveCount(14);
  });

  test('another player starts on their own latest season', async ({ page }) => {
    await page.goto(`/#players/${MATT}?log=2025&games=all`);
    await expect(rows(page)).toHaveCount(14);
    await page.goto('/#players/3393');
    await expect(rows(page).first()).toBeVisible();
    expect(await page.evaluate(() => location.hash)).not.toContain('log=');
  });
});
