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
    await expect(page.locator('#lb-wrap .pg-failed')).toContainText('Failed to load');
  });
});

test.describe('Data by month and the precomputed lede', () => {
  test('the front page reads the lede from lede.json, not every pitching line', async ({ page }) => {
    const files = [];
    page.on('request', (r) => { const m = r.url().match(/\/data\/([^?]+)/); if (m) files.push(m[1]); });
    await openSite(page);
    await expect(page.locator('#lede')).toContainText('led pitchers at');
    expect(files).toContain('lede.json');
    expect(files).not.toContain('pitching_current.csv');
  });

  test('a box score loads just its own month', async ({ page }) => {
    const files = [];
    page.on('request', (r) => { const m = r.url().match(/\/data\/(box_[^?]+)/); if (m) files.push(m[1]); });
    await page.goto('/#game/21972');
    await expect(page.locator('#gm-teams table[data-kind="pit"]').first()).toBeVisible();
    const date = await page.evaluate(async () => {
      const g = await fetch('/data/games.csv').then((r) => r.text());
      return g.split('\n').map((l) => l.split(',')).find((c) => c[0] === '21972')[2];
    });
    expect(files).toEqual([`box_${date.slice(0, 4)}_${date.slice(5, 7)}.csv`]);
  });

  test("a player page reads that player's own file, not the league's history or box scores", async ({ page }) => {
    const files = [];
    page.on('request', (r) => { const m = r.url().match(/\/data\/([^?]+)/); if (m) files.push(m[1]); });
    await page.goto('/#players/8048');
    await expect(page.locator('#p-log-table tbody tr').first()).toBeVisible();
    await expect(page.locator('#p-name')).toHaveText('Matt Bereiter');
    expect(files).toContain('player_48.json');
    expect(files).toContain('playernow_48.json');
    for (const f of files) expect(f).not.toMatch(/history|career|^box_|^games/);
  });

  test('a one-month date range loads one box file', async ({ page }) => {
    const files = [];
    page.on('request', (r) => { const m = r.url().match(/\/data\/(box_[^?]+)/); if (m) files.push(m[1]); });
    await openSite(page, 'leaders?season=2025&range=m6');
    await expect(page.locator('#lb-title')).toContainText('June');
    await expect(page.locator('#lb-table tbody tr').first()).toBeVisible();
    expect(files).toEqual(['box_2025_06.csv']);
  });
});

test('a season with box scores for one month only still finds them', async ({ page }) => {
  // the first weeks after a new season starts: guts lists a single month, e.g. BoxMonths [6]
  await page.route('**/data/guts.json*', async (route) => {
    const rows = await (await route.fetch()).json();
    for (const r of rows) if (r.Season === 2025) r.BoxMonths = [6];
    await route.fulfill({ json: rows });
  });
  const files = [];
  page.on('request', (r) => { const m = r.url().match(/\/data\/(box_[^?]+)/); if (m) files.push(m[1]); });
  await openSite(page, 'leaders?season=2025&range=reg');
  await expect(page.locator('#lb-note')).toContainText('box scores in this range');
  await expect(page.locator('#lb-table tbody tr').first()).toBeVisible();
  await expect(page.locator('#lb-note')).not.toContainText('Added up from 0 box scores');
  expect(files).toEqual(['box_2025_06.csv']);
});
