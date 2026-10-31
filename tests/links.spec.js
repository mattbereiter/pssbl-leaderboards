// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, openSite, leaderRows, goTab, pickDivs } = require('./helpers');

const hash = (page) => page.evaluate(() => decodeURIComponent(location.hash));

test.describe('Shareable links and Back', () => {
  test('opening a player puts them in the URL, and a reload keeps them', async ({ page }) => {
    await openSite(page);
    const link = page.locator('#lb-table tbody tr td.name a').first();
    const pid = await link.getAttribute('data-pid');
    const name = (await link.textContent()) || '';
    await link.click();
    await expect(page.locator('#p-name')).toHaveText(name);
    expect(await hash(page)).toBe(`#players/${pid}`);
    await page.reload();
    await expect(page.locator('#p-name')).toHaveText(name);
  });

  test('leaderboard filters live in the URL and survive a reload', async ({ page }) => {
    await openSite(page);
    await page.locator('#lb-type button[data-v="pit"]').click();
    const prev = String(await page.locator('#lb-season option').nth(1).getAttribute('value'));
    await page.locator('#lb-season').selectOption(prev);
    await pickDivs(page, 'Cascade');
    await page.locator('#lb-table thead th[data-col="FIP"] button').click();
    await expect(page.locator('#lb-table thead th[data-col="FIP"]')).toHaveAttribute('aria-sort', 'ascending');

    const h = await hash(page);
    expect(h).toMatch(/^#leaders\?/);
    for (const part of ['type=pit', `season=${prev}`, 'div=Cascade', 'sort=FIP']) expect(h).toContain(part);

    await page.reload();
    await expect(page.locator('#lb-title')).toHaveText(`Pitching leaders · ${prev}`);
    await expect(page.locator('#lb-div')).toHaveAttribute('data-value', 'Cascade');
    await expect(page.locator('#lb-table thead th[data-col="FIP"]')).toHaveAttribute('aria-sort', 'ascending');
  });

  test('a shared link opens straight to that view', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#leaders?type=pit&season=2023&div=Cascade&range=reg');
    await expect(page.locator('#lb-title')).toHaveText('Pitching leaders · 2023 · Regular season');
    await expect(leaderRows(page).first()).toBeVisible();
    await expect(page.locator('#lb-div')).toHaveAttribute('data-value', 'Cascade');
    await page.goto('/#standings?season=2024');
    await expect(page.locator('#st-season')).toHaveValue('2024');
    expect(errors).toEqual([]);
  });

  test('Back steps through tabs and players, not every filter tweak', async ({ page }) => {
    await openSite(page);
    await goTab(page, 'standings');
    await expect(page.locator('#st-grid .pg-card').first()).toBeVisible();
    const team = page.locator('#div-Adams tbody tr a[data-tid]').first();
    const tid = String(await team.getAttribute('data-tid'));
    await team.click();
    await expect(page.locator('#lb-team')).toHaveValue(tid);
    await page.locator('#lb-group button[data-v="std"]').click(); // a tweak: replaces, doesn't push
    await page.locator('#lb-table tbody tr td.name a').first().click();
    await expect(page.locator('#pg-players')).toBeVisible();

    await page.goBack();
    await expect(page.locator('#pg-leaders')).toBeVisible();
    await expect(page.locator('#lb-team')).toHaveValue(tid);
    await expect(page.locator('#lb-group button[data-v="std"]')).toHaveAttribute('aria-pressed', 'true');
    await page.goBack();
    await expect(page.locator('#pg-standings')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#pg-leaders')).toBeVisible();
    await expect(page.locator('#lb-team')).toHaveValue('All');
  });

  test('changing the hash on an open page switches the view', async ({ page }) => {
    await openSite(page);
    await page.evaluate(() => { location.hash = '#guts'; });
    await expect(page.locator('#pg-guts')).toBeVisible();
  });

  test('player and team links are real links that open in a new tab', async ({ page, context, isMobile }) => {
    test.skip(!!isMobile, 'no modifier-click on phones');
    await openSite(page);
    const link = page.locator('#lb-table tbody tr td.name a').first();
    const pid = await link.getAttribute('data-pid');
    await expect(link).toHaveAttribute('href', `#players/${pid}`);
    const team = page.locator('#lb-table tbody tr td a[data-tid]').first();
    await expect(team).toHaveAttribute('href', new RegExp(`^#leaders\\?.*team=${await team.getAttribute('data-tid')}`));

    const [tab] = await Promise.all([context.waitForEvent('page'), link.click({ modifiers: ['ControlOrMeta'] })]);
    await expect(tab.locator('#p-name')).toHaveText((await link.textContent()) || '');
    await expect(page.locator('#pg-leaders')).toBeVisible(); // the original tab stays put
  });

  test('the West Coast Pilots view is shareable too', async ({ page }) => {
    await openSite(page);
    await pickDivs(page, 'Adams');
    await page.locator('#lb-team').selectOption('wcp');
    await expect.poll(() => hash(page)).toContain('team=wcp');
    const url = page.url();
    await page.goto('about:blank');
    await page.goto(url);
    await expect(page.locator('#lb-team')).toHaveValue('wcp');
    await expect(page.locator('#lb-note')).toContainText('Every Pilot');
  });

  test('opening a link to a tab starts at the top of the page', async ({ page }) => {
    for (const h of ['#leaders', '#standings', '#guts']) {
      await page.goto('/' + h);
      await expect(page.locator(`.pg-nav button[data-tab="${h.slice(1)}"]`)).toHaveAttribute('aria-selected', 'true');
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => scrollY), h).toBe(0);
    }
  });

  test('a bad link falls back to the leaderboard', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#nonsense?season=1999&min=abc&group=zzz');
    await expect(leaderRows(page).first()).toBeVisible();
    await expect(page.locator('#lb-title')).toHaveText(/^Batting leaders · \d{4}$/);
    await expect(page.locator('#lb-min')).toHaveValue('q');
    expect(await hash(page)).toBe('#leaders');
    expect(errors).toEqual([]);
  });
});
