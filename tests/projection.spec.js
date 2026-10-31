// @ts-check
const { test, expect } = require('@playwright/test');
const { MATT, trackErrors } = require('./helpers');

/**
 * Read one projection table (#p-proj-bat / #p-proj-pit) as { Adams: {...}, Sierra: {...} } keyed by header.
 * @param {import('@playwright/test').Page} page
 * @param {string} sel
 */
async function projTable(page, sel) {
  return page.locator(sel).evaluate((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const o = {};
    for (const tr of t.querySelectorAll('tbody tr')) {
      const r = {}; [...tr.cells].forEach((td, i) => { r[heads[i]] = td.textContent.trim(); });
      o[r['In']] = r;
    }
    return o;
  });
}

test.describe('Projected in Adams / Sierra', () => {
  // reference numbers: python analysis/project_to_adams.py "AJ Hansen" "Cameron Lobb" (Sierra: same model, Sierra as target)
  test('AJ Hansen (Rocky + Denali) matches the analysis model', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#players/3393');
    const card = page.locator('#p-proj');
    await expect(card).toBeVisible();
    await expect(card.locator('h3')).toContainText('Projected in Adams / Sierra');

    const bat = await projTable(page, '#p-proj-bat');
    expect(bat.Adams).toMatchObject({ AVG: '.347', OBP: '.467', SLG: '.508', wOBA: '.423', 'wRC+': '132' });
    expect(bat.Sierra).toMatchObject({ AVG: '.357', OBP: '.457', SLG: '.519', wOBA: '.421', 'wRC+': '129' });
    // sample size and how hard it regresses
    await expect(card).toContainText('307 recency-weighted PA');
    await expect(card).toContainText('84%');
    await expect(card).toContainText('Rocky');
    await expect(card).toContainText('Denali');

    const pit = await projTable(page, '#p-proj-pit');
    expect(pit.Adams).toMatchObject({ 'FIP-': '101', FIP: '5.19' });
    expect(pit.Sierra).toMatchObject({ 'FIP-': '105', FIP: '5.88' });
    await expect(card).toContainText('49 recency-weighted IP');
    expect(errors).toEqual([]);
  });

  test('Cameron Lobb (Rocky pitcher) projects to FIP- 81 in Adams', async ({ page }) => {
    await page.goto('/#players/7215');
    await expect(page.locator('#p-proj')).toBeVisible();
    const pit = await projTable(page, '#p-proj-pit');
    expect(pit.Adams).toMatchObject({ 'FIP-': '81', FIP: '4.14', 'K%': '25.9 %', 'BB%': '6.5 %' });
    expect(pit.Sierra).toMatchObject({ 'FIP-': '86', FIP: '4.77' });
    const bat = await projTable(page, '#p-proj-bat');
    expect(bat.Adams).toMatchObject({ AVG: '.243', OBP: '.345', SLG: '.312', 'wRC+': '76' });
  });

  test('says Adams and Sierra are about the same level, and states the caveats', async ({ page }) => {
    await page.goto('/#players/3393');
    const card = page.locator('#p-proj');
    await expect(card).toContainText(/same level/i);
    await expect(card).toContainText(/self-selected/i);
    await expect(card).toContainText(/age/i);
  });

  test('hidden for a player whose recent seasons are all in Adams or Sierra (Matt)', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(`/#players/${MATT}`);
    await expect(page.locator('#p-bat-tables tr.career')).toHaveCount(1);
    await expect(page.locator('#p-proj')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
