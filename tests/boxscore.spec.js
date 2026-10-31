// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, MATT } = require('./helpers');

const team = (page, i) => page.locator('#gm-teams > .pg-card').nth(i);
const totals = (card, kind) => card.locator(`table[data-kind="${kind}"]`).evaluate((t) => {
  const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  const o = {};
  [...t.querySelectorAll('tfoot td')].forEach((td, i) => { o[heads[i]] = td.textContent.trim(); });
  return o;
});

test.describe('Box scores', () => {
  test('a game-log row opens that game, and Back returns to the player', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`/#players/${MATT}`);
    await page.locator('#p-log-more').click();
    const may3 = page.locator('#p-log-table tbody tr[data-key="21972"]');
    await may3.scrollIntoViewIfNeeded();
    await may3.locator('a[data-game]').last().click();
    await expect(page).toHaveURL(new RegExp(`#game/21972\\?p=${MATT}$`));
    await expect(page.locator(`#gm-teams tr.hl[data-key="21972-bat-${MATT}"]`)).toBeVisible(); // the player you came from
    await expect(page.locator('#pg-game')).toBeVisible();
    await expect(page.locator('#pg-players')).toBeHidden();
    await expect(page.locator('#gm-score')).toContainText('Beavers');
    await expect(page.locator('#gm-score')).toContainText('Diablos');
    await expect(page.locator('#gm-meta')).toContainText('Sunday, May 3, 2026');

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`#players/${MATT}`));
    await expect(page.locator('#pg-players')).toBeVisible();
    await expect(may3).toBeInViewport();
    expect(errors).toEqual([]);
  });

  test('team run totals match the final score, Matt is starred, the link survives reload', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#game/21972');
    // away first: Beavers 6 @ Diablos 11
    await expect(team(page, 0).locator('h3')).toHaveText('Beavers');
    await expect(team(page, 1).locator('h3')).toHaveText('Diablos');
    await expect(team(page, 0).locator('table[data-kind="bat"]')).toBeVisible();
    expect((await totals(team(page, 0), 'bat')).R).toBe('6');
    expect((await totals(team(page, 1), 'bat')).R).toBe('11');
    expect((await totals(team(page, 0), 'pit')).R).toBe('11');
    expect((await totals(team(page, 1), 'pit')).R).toBe('6');
    // lineup order: Lam leads off for the Beavers; Kover subs into the 2 slot for the Diablos
    await expect(team(page, 0).locator('table[data-kind="bat"] tbody tr').first()).toContainText('Wilbert Lam');
    await expect(team(page, 1).locator('table[data-kind="bat"] tbody tr').nth(2).locator('.sub')).toContainText('Kalei Kover');
    // decisions
    await expect(team(page, 0).locator('table[data-kind="pit"]')).toContainText(/Brandon Nagle L \(\d+–\d+\)/);
    await expect(team(page, 1).locator('table[data-kind="pit"]')).toContainText(/Mario Beavers SV \(\d+\)/);
    const me = team(page, 0).locator(`tr.me a[data-pid="${MATT}"]`);
    await expect(me).toHaveText('Matt Bereiter');

    await page.reload();
    await expect(page.locator('#pg-game')).toBeVisible();
    expect((await totals(team(page, 1), 'bat')).R).toBe('11');

    // player and team links
    await me.click();
    await expect(page).toHaveURL(new RegExp(`#players/${MATT}`));
    await page.goBack();
    await team(page, 1).locator('h3 a').click();
    await expect(page.locator('#pg-leaders')).toBeVisible();
    await expect(page.locator('#lb-team')).toHaveAttribute('data-value', '1448');
    expect(errors).toEqual([]);
  });

  test('a game without a box score says so', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#guts');
    const id = await page.evaluate(async () => {
      // a 2026 game with no lines in box_2026.csv
      const [g, b] = await Promise.all(['games.csv', 'box_2026.csv'].map((f) => fetch('/data/' + f).then((r) => r.text())));
      const have = new Set(b.split('\n').slice(1).map((l) => l.split(',')[3]));
      return g.split('\n').slice(1).map((l) => l.split(',')).find((c) => c[1] === '2026' && !have.has(c[0]))[0];
    });
    await page.goto(`/#game/${id}`);
    await expect(page.locator('#gm-none')).toHaveText('No box score on file for this game.');
    await expect(page.locator('#gm-score')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });

  test('fits a phone screen', async ({ page }) => {
    await page.goto('/#game/21972');
    await expect(team(page, 1).locator('table[data-kind="pit"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
