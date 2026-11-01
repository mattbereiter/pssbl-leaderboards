// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, openSite, leaderRows, leaderTable } = require('./helpers');

const sum = (rows, c) => rows.reduce((a, r) => a + Number(r[c] || 0), 0);

test.describe('Date range (rebuilt from box scores)', () => {
  test('regular season and playoffs split the full season', async ({ page }) => {
    const errors = trackErrors(page);
    await openSite(page, 'leaders?season=2026'); // a new season has no playoffs yet
    await page.locator('#lb-min').selectOption('0');
    await page.locator('#lb-size').selectOption('250');

    await page.locator('#lb-range').selectOption('reg');
    await expect(page.locator('#lb-title')).toHaveText(/· Regular season$/);
    await expect(page.locator('#lb-note')).toContainText('box scores in this range');
    await expect(leaderRows(page).first()).toBeVisible();
    const reg = await leaderTable(page);

    await page.locator('#lb-range').selectOption('post');
    await expect(page.locator('#lb-title')).toHaveText(/· Playoffs$/);
    await expect(leaderRows(page).first()).toBeVisible();
    const post = await leaderTable(page);

    // top 250 by oWAR in each: the regular season has far more PA than the playoffs
    expect(sum(reg, 'PA')).toBeGreaterThan(sum(post, 'PA'));
    expect(errors).toEqual([]);
  });

  test('a month fills From/To with that month', async ({ page }) => {
    await openSite(page);
    const season = await page.locator('#lb-season').inputValue();
    await page.locator('#lb-range').selectOption('m6');
    await expect(page.locator('#lb-title')).toHaveText(/· June$/);
    await expect(page.locator('#lb-from')).toHaveValue(`${season}-06-01`);
    await expect(page.locator('#lb-to')).toHaveValue(`${season}-06-30`);
  });

  test('custom dates switch the range to Custom', async ({ page }) => {
    await openSite(page);
    const season = await page.locator('#lb-season').inputValue();
    await expect(page.locator('#lb-from')).toBeHidden(); // From/To stay out of the way until a range is picked
    await page.locator('#lb-range').selectOption('custom');
    await page.locator('#lb-from').fill(`${season}-05-01`);
    await page.locator('#lb-from').dispatchEvent('change');
    await page.locator('#lb-to').fill(`${season}-05-31`);
    await page.locator('#lb-to').dispatchEvent('change');
    await expect(page.locator('#lb-range')).toHaveValue('custom');
    await expect(page.locator('#lb-title')).toHaveText(/· May 1 – May 31$/);
    await expect(leaderRows(page).first()).toBeVisible();
  });

  test('changing season resets the range to full season', async ({ page }) => {
    await openSite(page);
    await page.locator('#lb-range').selectOption('reg');
    await expect(page.locator('#lb-title')).toHaveText(/Regular season/);
    const prev = await page.locator('#lb-season option').nth(1).getAttribute('value');
    await page.locator('#lb-season').selectOption(String(prev));
    await expect(page.locator('#lb-range')).toHaveValue('full');
    await expect(page.locator('#lb-title')).toHaveText(`Batting leaders · ${prev}`);
  });
});
