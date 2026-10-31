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

/**
 * Open the site (optionally at a #tab) and wait until the leaderboard has rows.
 * @param {import('@playwright/test').Page} page
 * @param {string} [hash]
 */
async function openSite(page, hash = '') {
  await page.goto('/' + (hash ? '#' + hash : ''));
  if (!hash || hash === 'leaders') await expect(leaderRows(page).first()).toBeVisible();
}

/** @param {import('@playwright/test').Page} page */
const leaderRows = (page) => page.locator('#lb-table tbody tr');

/**
 * Read the leaderboard as objects keyed by column header (Name, Team, PA, …).
 * @param {import('@playwright/test').Page} page
 */
async function leaderTable(page) {
  return page.locator('#lb-table').evaluate((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    return [...t.querySelectorAll('tbody tr')].map((tr) => {
      const o = {};
      [...tr.cells].forEach((td, i) => { o[heads[i]] = td.textContent.trim(); });
      return o;
    });
  });
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

module.exports = { MATT, trackErrors, openSite, leaderRows, leaderTable, goTab, pickDivs };
