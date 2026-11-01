// @ts-check
// Coverage added in the deep-scrub pass: dark theme, browser Forward, Standings and Guts values against the published
// data, and keyboard use of the Division menu. Finished seasons (2025) are pinned; nothing here depends on the latest season.
const { test, expect } = require('@playwright/test');
const { trackErrors, openSite, hash, leaderRows, tableRows } = require('./helpers');

/** rgb()/rgba() string -> [r, g, b] @param {string} c */
const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const luma = (c) => { const [r, g, b] = rgb(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

test.describe('Dark theme', () => {
  test('dark OS theme: dark page, and Matt\'s gold row keeps its ★ and a distinct background', async ({ page }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await openSite(page, 'leaders?season=2026');
    const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(luma(body)).toBeLessThan(0.3);

    const first = leaderRows(page).first();
    await expect(first).not.toHaveClass(/\bme\b/);
    const plain = await first.locator('td').first().evaluate((td) => getComputedStyle(td).backgroundColor);

    await page.locator('#lb-q').fill('bereiter');
    const me = page.locator('#lb-table tbody tr.me').first();
    await expect(me).toBeVisible();
    const gold = await me.locator('td').first().evaluate((td) => getComputedStyle(td).backgroundColor);
    expect(gold).not.toBe(plain);
    expect(gold).not.toBe(body);
    expect(luma(gold)).toBeLessThan(0.5); // a dark-theme gold, not the light theme's pale one
    expect(await me.locator('td.name a').evaluate((a) => getComputedStyle(a, '::after').content)).toContain('★');
    expect(errors).toEqual([]);
  });
});

test.describe('Browser history', () => {
  test('Back then Forward lands on the player again', async ({ page }) => {
    await openSite(page);
    const link = page.locator('#lb-table tbody tr td.name a').first();
    const pid = await link.getAttribute('data-pid');
    const name = (await link.textContent()) || '';
    await link.click();
    await expect(page.locator('#p-name')).toHaveText(name);

    await page.goBack();
    await expect(page.locator('#pg-leaders')).toBeVisible();
    await expect(leaderRows(page).first()).toBeVisible();

    await page.goForward();
    await expect(page.locator('#pg-players')).toBeVisible();
    await expect(page.locator('#p-name')).toHaveText(name);
    expect(await hash(page)).toBe(`#players/${pid}`);
  });
});

test.describe('Standings values', () => {
  test('a finished season\'s W-L, games and run differential match standings.json', async ({ page, request }) => {
    const errors = trackErrors(page);
    const all = await (await request.get('data/standings.json')).json();
    const div = all.filter((r) => r.Season === 2025 && r.Division === 'Adams').sort((a, b) => a.Rank - b.Rank);
    expect(div.length).toBeGreaterThan(1);
    await openSite(page, 'standings?season=2025');
    await expect(page.locator('#st-title')).toHaveText('Standings · 2025');
    const rows = await tableRows(page.locator('#div-Adams table'));
    expect(rows.length).toBe(div.length);
    for (const t of div) {
      const row = rows.find((r) => r.Team.replace('🏆', '').trim() === t.Team);
      expect(row, t.Team).toBeTruthy();
      expect(row).toMatchObject({ GP: String(t.GP), W: String(t.W), L: String(t.L) });
      expect(Number(row.Diff.replace('−', '-').replace('+', ''))).toBe(t.Diff);
    }
    // best record first, and its team is the one the data ranks first
    expect(rows[0].Team.replace('🏆', '').trim()).toBe(div[0].Team);
    expect(errors).toEqual([]);
  });
});

test.describe('Guts values', () => {
  test('a finished season has a sane row for every division', async ({ page, request }) => {
    const errors = trackErrors(page);
    const guts = (await (await request.get('data/guts.json')).json()).filter((r) => r.Season === 2025);
    expect(guts.length).toBeGreaterThan(5);
    await openSite(page, 'guts?season=2025');
    await expect(page.locator('#gu-season')).toHaveValue('2025');
    const rows = await tableRows(page.locator('#gu-table'));
    expect(rows.map((r) => r.Division).sort()).toEqual(guts.map((r) => r.Division).sort());
    for (const r of rows) {
      expect(r.Season, r.Division).toBe('2025');
      const scale = Number(r['wOBA scale']), woba = Number(r.wOBA), cfip = Number(r.cFIP), rpw = Number(r['R/W']);
      expect(scale, `${r.Division} wOBA scale`).toBeGreaterThan(1);
      expect(scale, `${r.Division} wOBA scale`).toBeLessThan(2);
      expect(woba, `${r.Division} wOBA`).toBeGreaterThan(0.25);
      expect(woba, `${r.Division} wOBA`).toBeLessThan(0.5);
      expect(cfip, `${r.Division} cFIP`).toBeGreaterThan(1);
      expect(cfip, `${r.Division} cFIP`).toBeLessThan(8);
      expect(rpw, `${r.Division} R/W`).toBeGreaterThan(5);
      expect(rpw, `${r.Division} R/W`).toBeLessThan(30);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('Keyboard menus', () => {
  const btn = (page) => page.locator('#lb-div');
  const list = (page) => page.locator('#lb-div-list');

  for (const key of ['Enter', 'Space']) {
    test(`Division menu opens with ${key}, Tab walks into the list, Escape closes and returns focus`, async ({ page, isMobile }) => {
      test.skip(!!isMobile, 'keyboard navigation');
      await openSite(page);
      await btn(page).focus();
      await expect(list(page)).toBeHidden();
      await page.keyboard.press(key);
      await expect(list(page)).toBeVisible();
      await expect(btn(page)).toHaveAttribute('aria-expanded', 'true');

      // the list follows the button in tab order: the "All" reset, the Only / All except switch, then the checkboxes
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#lb-div-list'))).toBe(true);
      await page.keyboard.press('Tab');
      await expect(list(page).locator('button[data-mode="only"]')).toBeFocused();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(list(page).locator('input').first()).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(list(page)).toBeHidden();
      await expect(btn(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(btn(page)).toBeFocused();
    });
  }

  test('Space on a focused checkbox picks that division', async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'keyboard navigation');
    await openSite(page);
    await btn(page).focus();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab'); // All, Only, All except, first checkbox
    const value = await list(page).locator('input').first().getAttribute('value');
    await page.keyboard.press('Space');
    await expect(btn(page)).toHaveAttribute('data-value', String(value));
    await page.keyboard.press('Escape');
    await expect(btn(page)).toBeFocused();
  });
});
