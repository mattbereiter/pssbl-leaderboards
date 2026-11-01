// @ts-check
const { test, expect } = require('@playwright/test');
const { MATT, trackErrors, openSite, leaderRows } = require('./helpers');

// The design pass Matt approved from the deep-scrub plan (items 1-8).
test.describe('Design pass', () => {
  test('1. on a phone the sorted stat sits right after Name, with the team under the name', async ({ page, isMobile }) => {
    await openSite(page, 'leaders?min=0');
    const heads = await page.locator('#lb-table thead th').evaluateAll((ths) => ths.filter((t) => getComputedStyle(t).display !== 'none').map((t) => t.dataset.col || t.textContent.trim()));
    if (isMobile) {
      expect(heads.slice(0, 3)).toEqual(['#', 'Name', 'oWAR']);
      await expect(page.locator('#lb-table td.name').first()).toHaveAttribute('data-team', /\S/);
      await page.locator('#lb-table thead th[data-col="wRC+"] button').click();
      await expect.poll(async () => page.locator('#lb-table thead th').nth(2).getAttribute('data-col')).toBe('wRC+');
    } else {
      expect(heads.slice(0, 4)).toEqual(['#', 'Name', 'Team', 'Division']);
    }
  });

  test('2. the board title and filter chips come before the leader cards', async ({ page }) => {
    await openSite(page, 'leaders?div=Adams');
    await expect(page.locator('#lb-chips .pg-x')).toHaveCount(1);
    expect(await page.evaluate(() => !!(document.querySelector('#lb-chips').compareDocumentPosition(document.querySelector('#lb-cards')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  });

  test('3. a search with no hits shows one line instead of five empty cards', async ({ page }) => {
    await openSite(page);
    await page.locator('#lb-q').fill('zzzz');
    await expect(page.locator('#lb-cards .pg-nohits')).toHaveText('No players match “zzzz”.');
    await expect(page.locator('#lb-cards .pg-lcard')).toHaveCount(0);
    await page.locator('#lb-q').fill('');
    await expect(page.locator('#lb-cards .pg-lcard')).toHaveCount(5);
  });

  test('4. the Players column sets are folder tabs, like Leaders', async ({ page }) => {
    await page.goto(`/#players/${MATT}`);
    await expect(page.locator('#p-group')).toHaveClass(/pg-grouptabs/);
    await page.locator('#p-group button[data-v="adv"]').click();
    await expect(page.locator('#p-group button[data-v="adv"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#p-bat-tables thead')).toContainText('wRAA');
  });

  test('5. phone controls share one height', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone layout');
    await openSite(page);
    const h = async (sel) => Math.round((await page.locator(sel).first().boundingBox()).height);
    expect(await h('#lb-season')).toBe(40);
    expect(await h('#lb-div')).toBe(40);
    expect(await h('#lb-group button')).toBe(40);
  });

  test('6. leader card titles keep their stat names as written', async ({ page }) => {
    await openSite(page);
    const h4 = page.locator('#lb-cards h4').first();
    await expect(h4).toContainText('oWAR');
    expect(await h4.evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');
  });

  test('7. a box score opened from a game log links back to it and keeps that tab lit', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`/#players/${MATT}`);
    await page.locator('#p-log-more').click();
    await page.locator('#p-log-table tbody tr[data-key="21972"] a[data-game]').last().click();
    await expect(page.locator('#gm-back')).toHaveText('← Matt Bereiter’s game log');
    await expect(page.locator('.pg-nav button[data-tab="me"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#gm-back').click();
    await expect(page).toHaveURL(new RegExp(`#players/${MATT}(\\?|$)`));
    await expect(page.locator('#p-log-table tbody tr[data-key="21972"]')).toBeInViewport();
    await page.goto('/?b#game/21972'); // opened on its own: no player to go back to
    await expect(page.locator('#gm-score')).toContainText('Beavers');
    await expect(page.locator('#gm-back')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('8. Matt gets his ★ in the leader cards, and the gold chart label is readable', async ({ page }) => {
    await openSite(page, 'leaders?team=1520');
    const me = page.locator('#lb-cards li.me .n a').first();
    await expect(me).toHaveText('Matt Bereiter');
    expect(await me.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('"★"');
    await page.goto(`/#players/${MATT}`);
    const label = page.locator('#p-bat-chart text.cap', { hasText: 'career' });
    await expect(label).toBeVisible();
    expect(await label.evaluate((el) => el.style.fill)).toContain('--fg-star-ink');
  });

  test('9. the theme button flips light and dark, remembers it, and hands back to the OS', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openSite(page);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const btn = page.locator('#theme-btn');
    await expect(btn).toHaveAttribute('aria-label', 'Switch to dark theme');
    const light = await bg();
    await btn.click();
    await expect(btn).toHaveAttribute('aria-label', 'Switch to light theme');
    expect(await bg()).not.toBe(light);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#theme-btn').click(); // back to the OS's light: the override is dropped
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
    expect(await page.evaluate(() => localStorage.getItem('pssbl-theme'))).toBeNull();
    expect(await bg()).toBe(light);
  });
});
