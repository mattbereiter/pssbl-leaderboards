// @ts-check
// Players page P0 fixes from the Oct 2026 review: rank line, every latest team, career rows that
// match their seasons, tappable chart dots with fixed division colours, and a search that acts on what's typed.
const { test, expect } = require('@playwright/test');
const { MATT, trackErrors } = require('./helpers');

const ONE_SEASON = '5902'; // Austin Beaver: 14 PA in 2026, nothing else
const GLEASON = '843';     // twelve seasons across several divisions, bats and pitches
const GIBSON = '561';      // pitches a lot

test.describe('Players page fixes', () => {
  test('the rank uses wRC+ among real hitters, and a cameo says it is too small to rank', async ({ page }) => {
    await page.goto('/#players/' + MATT);
    await expect(page.locator('#p-rank')).toContainText(/(T-)?\d+(st|nd|rd|th) of \d+ Adams hitters in wRC\+ \(2026, 30\+ PA\)/);
    await expect(page.locator('#p-rank')).toContainText(/pitchers in FIP- \(2026, 15\+ IP\)/);
    await page.goto('/#players/' + ONE_SEASON);
    await expect(page.locator('#p-rank')).toContainText('14 PA in Adams (2026): too few to rank (30+ PA)');
  });

  test('the header names every team from the latest season', async ({ page }) => {
    await page.goto('/#players/' + MATT);
    const chips = page.locator('#p-sub a.pg-chip');
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toHaveText('Brewers'); // more of his 2026 games, batting and pitching
    await expect(chips.nth(1)).toHaveText('Beavers');
    await page.goto('/#players/' + ONE_SEASON);
    await expect(page.locator('#p-sub')).toContainText('on file 2026 only');
  });

  test('a one-season career row matches its season row', async ({ page }) => {
    await page.goto('/#players/' + ONE_SEASON);
    const rows = page.locator('#p-bat-tables tbody tr');
    await expect(rows).toHaveCount(2);
    const cells = async (i) => (await rows.nth(i).locator('td').allInnerTexts()).slice(4);
    expect(await cells(1)).toEqual(await cells(0));
  });

  test('a chart dot opens its tooltip on a tap and closes on a tap elsewhere', async ({ page, isMobile }) => {
    await page.goto('/#players/' + MATT);
    const dot = page.locator('#p-bat-chart circle.dot').first();
    const tip = page.locator('#p-bat-chart .pg-tip');
    if (isMobile) await dot.tap(); else await dot.click();
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('wRC+');
    const box = await page.locator('#p-bat-chart svg').boundingBox();
    if (!box) throw new Error('no chart');
    if (isMobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + 8); else await page.mouse.click(box.x + box.width / 2, box.y + 8);
    await expect(tip).toBeHidden();
  });

  test('a division has the same colour in the batting and pitching charts', async ({ page }) => {
    await page.goto('/#players/' + GLEASON);
    const swatch = (chart, div) => page.locator(`${chart} .pg-legend span`, { hasText: div }).locator('i').evaluate((i) => getComputedStyle(i).backgroundColor);
    await expect(page.locator('#p-pit-chart .pg-legend')).toContainText('Teton');
    expect(await swatch('#p-bat-chart', 'Teton')).toBe(await swatch('#p-pit-chart', 'Teton'));
  });

  test('a one-way player does not keep the last player\'s hidden pitching table', async ({ page }) => {
    await page.goto('/#players/' + GIBSON);
    await expect(page.locator('#p-pit-tables tbody tr').first()).toBeVisible();
    await page.evaluate((pid) => { location.hash = '#players/' + pid; }, ONE_SEASON);
    await expect(page.locator('#p-name')).toHaveText('Austin Beaver');
    await expect(page.locator('#p-pit')).toBeHidden();
    await expect(page.locator('#p-pit-tables tr')).toHaveCount(0);
    await expect(page.locator('#p-pit-chart circle')).toHaveCount(0);
  });

  test('Enter opens the player typed now, not the list from a moment ago', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#players/' + GLEASON);
    await expect(page.locator('#p-name')).toHaveText('Carl Gleason');
    const q = page.locator('#p-q');
    await q.fill('smith');
    await expect(page.locator('#p-sugg button').first()).toBeVisible();
    await q.fill('bereiter');
    await q.press('Enter');
    await expect(page.locator('#p-name')).toHaveText(/Matt Bereiter/);
    expect(errors).toEqual([]);
  });

  test('arrow keys walk the suggestions and Enter picks the highlighted one', async ({ page }) => {
    await page.goto('/#players/' + MATT);
    const q = page.locator('#p-q');
    await q.fill('gleason');
    await expect(page.locator('#p-sugg button').first()).toBeVisible();
    await q.press('ArrowDown');
    await expect(q).toHaveAttribute('aria-expanded', 'true');
    await expect(q).toHaveAttribute('aria-activedescendant', 'p-sugg-0');
    await expect(page.locator('#p-sugg-0')).toHaveAttribute('aria-selected', 'true');
    await q.press('Enter');
    await expect(page.locator('#p-name')).toHaveText(/Gleason/);
  });

  test('search forgives apostrophes and swapped letters, and shows career spans', async ({ page }) => {
    await page.goto('/#players/' + MATT);
    const q = page.locator('#p-q'), sugg = page.locator('#p-sugg');
    await q.fill('obrien');
    await expect(sugg).toContainText("Liam O'Brien");
    await expect(sugg).toContainText('Scott OBrien');
    await q.fill('glaeson');
    await expect(sugg).toContainText('Carl Gleason');
    await expect(sugg).toContainText('2015–2026');
  });
});
