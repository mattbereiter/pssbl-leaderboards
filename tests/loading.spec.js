// @ts-check
const { test, expect } = require('@playwright/test');
const { openSite, leaderRows } = require('./helpers');

test.describe('Loading', () => {
  test('renders in a hidden tab, where requestAnimationFrame never fires', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, 'hidden', { get: () => true });
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' });
      window.requestAnimationFrame = () => 0;
    });
    await page.goto('/');
    await expect(leaderRows(page).first()).toBeVisible();
  });

  test('data requests carry the manifest version', async ({ page }) => {
    const urls = [];
    page.on('request', (r) => { if (r.url().includes('/data/') && !r.url().endsWith('manifest.json')) urls.push(r.url()); });
    await openSite(page);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/\?v=\d{14}$/);
  });

  test('history and box scores load only when a view needs them', async ({ page }) => {
    const files = [];
    page.on('request', (r) => { const m = r.url().match(/\/data\/([^?]+)/); if (m) files.push(m[1]); });
    await openSite(page);
    expect(files).not.toContain('batting_history.csv');
    expect(files.some((f) => f.startsWith('box_'))).toBe(false);
  });

  test('the page has no sideways scroll', async ({ page }) => {
    await openSite(page);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over).toBeLessThanOrEqual(0);
  });

  test('a bad data file shows "Failed to load" instead of hanging', async ({ page }) => {
    await page.route('**/data/batting_current.csv*', (r) => r.fulfill({ status: 500, body: '' }));
    page.on('console', () => {}); // the loader logs the failure; that's expected here
    await page.goto('/');
    await expect(page.locator('#lb-wrap .pg-failed')).toHaveText('Failed to load');
  });
});
