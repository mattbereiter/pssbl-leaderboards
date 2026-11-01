// @ts-check
const { test, expect } = require('@playwright/test');
const { openSite, settled, leaderRows } = require('./helpers');

test.describe('UX review fixes', () => {
  test('the header line is league news, not addressed to the visitor', async ({ page }) => {
    await openSite(page);
    await expect(page.locator('#lede')).toContainText('led every PSSBL hitter');
    await expect(page.locator('#lede')).not.toContainText('Your');
    await expect(page.locator('#tab-me')).toHaveText('★ Matt');
  });

  test('every nav tab fits on screen without scrolling the bar', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openSite(page);
    const nav = await page.locator('.pg-nav').evaluate((n) => ({
      overflow: n.scrollWidth - n.clientWidth,
      right: Math.max(...[...n.querySelectorAll('button')].map((b) => b.getBoundingClientRect().right)),
      vw: innerWidth,
    }));
    expect(nav.overflow).toBeLessThanOrEqual(0);
    expect(nav.right).toBeLessThanOrEqual(nav.vw);
  });

  test('leader cards follow the player search', async ({ page }) => {
    await openSite(page);
    await page.locator('#lb-q').fill('zzqxx');
    await expect(leaderRows(page)).toHaveCount(0);
    await expect(page.locator('#lb-cards li .n')).toHaveCount(0);

    await page.locator('#lb-q').fill('bereiter');
    await expect(leaderRows(page)).toHaveCount(2);
    const names = await page.locator('#lb-cards li .n a').allTextContents();
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toBe('Matt Bereiter');
  });

  test('the page barely moves while data loads', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'layout-shift entries are Chromium-only');
    await page.addInitScript(() => {
      // @ts-ignore
      window.__cls = 0;
      new PerformanceObserver((l) => {
        // @ts-ignore
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await openSite(page);
    await settled(page);
    // @ts-ignore
    const cls = await page.evaluate(() => window.__cls);
    expect(cls).toBeLessThan(0.1); // Google's "good" threshold
  });
});
