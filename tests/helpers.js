// @ts-check
const { expect } = require('@playwright/test');

const MATT = '8048';

/**
 * Collect console errors and uncaught page errors for the whole test.
 * @param {import('@playwright/test').Page} page
 */
function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

let loads = 0;

/**
 * Open the site (optionally at a #hash) and, on a Leaders view, wait until the leaderboard has rows.
 * `fresh` forces a real page load (a new ?n), since a goto that only changes the hash keeps the old page.
 * @param {import('@playwright/test').Page} page
 * @param {string} [hash]
 * @param {{ fresh?: boolean }} [opts]
 */
async function openSite(page, hash = '', { fresh = false } = {}) {
  await page.goto('/' + (fresh ? `?${++loads}` : '') + (hash ? '#' + hash : ''));
  // the first paint fetches d3, the manifest and several CSVs, so give it longer than the 10s default under load
  if (!hash || /^leaders(\?|$)/.test(hash)) await expect(leaderRows(page).first()).toBeVisible({ timeout: 15_000 });
}

/** The URL hash, decoded. @param {import('@playwright/test').Page} page */
const hash = (page) => page.evaluate(() => decodeURIComponent(location.hash));

/** Wait until every data file has arrived and no skeleton is left. @param {import('@playwright/test').Page} page */
async function settled(page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.dash-skeleton:visible')).toHaveCount(0);
}

/**
 * Read table rows as objects keyed by column header.
 * @param {import('@playwright/test').Locator} table
 * @param {string} [rows] row selector inside the table
 */
async function tableRows(table, rows = 'tbody tr') {
  return table.evaluate((t, sel) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    return [...t.querySelectorAll(sel)].map((tr) => {
      const o = {};
      [...tr.cells].forEach((td, i) => { o[heads[i]] = td.textContent.trim(); });
      return o;
    });
  }, rows);
}

/** @param {import('@playwright/test').Page} page */
const leaderRows = (page) => page.locator('#lb-table tbody tr');

/**
 * Read the leaderboard as objects keyed by column header (Name, Team, PA, …).
 * @param {import('@playwright/test').Page} page
 */
async function leaderTable(page) {
  // a big page draws its first 50 rows, then the rest a moment later: wait for every row the pager counts
  await expect.poll(async () => {
    const m = ((await page.locator('#lb-pageinfo').textContent()) || '').replace(/,/g, '').match(/^(\d+)–(\d+)/);
    return !m || (await page.locator('#lb-table tbody tr').count()) === Number(m[2]) - Number(m[1]) + 1;
  }).toBe(true);
  return tableRows(page.locator('#lb-table'));
}

/**
 * Click a nav tab by its data-tab value.
 * @param {import('@playwright/test').Page} page
 * @param {string} tab
 */
async function goTab(page, tab) {
  await page.locator(`.pg-nav button[data-tab="${tab}"]`).click();
}

/**
 * Set the Leaders division menu (a checkbox dropdown) to exactly these divisions; none = all divisions.
 * @param {import('@playwright/test').Page} page
 * @param {...string} divs
 */
async function pickDivs(page, ...divs) {
  await page.locator('#lb-div').click();
  await page.locator('#lb-div-list button[data-all]').click();
  for (const d of divs) await page.locator(`#lb-div-list input[value="${d}"]`).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('#lb-div-list')).toBeHidden();
}

/** Pick exactly these team ids (or 'wcp') from the Team checkbox menu. */
async function pickTeams(page, ...tids) {
  await page.locator('#lb-team').click();
  await page.locator('#lb-team-list button[data-all]').click();
  for (const t of tids) await page.locator(`#lb-team-list input[value="${t}"]`).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('#lb-team-list')).toBeHidden();
}

module.exports = { MATT, trackErrors, openSite, hash, settled, tableRows, leaderRows, leaderTable, goTab, pickDivs, pickTeams };
