// @ts-check
const { test, expect } = require('@playwright/test');
const { MATT, trackErrors, openSite, leaderRows, leaderTable, pickDivs } = require('./helpers');

const num = (s) => Number(String(s).replace(/[^\d.-]/g, ''));

test.describe('Leaders', () => {
  test('loads with a full first page and no console errors', async ({ page }) => {
    const errors = trackErrors(page);
    await openSite(page);
    await expect(leaderRows(page)).toHaveCount(50);
    await expect(page.locator('#lb-title')).toHaveText(/^Batting leaders · \d{4}$/);
    await expect(page.locator('#lb-cards .pg-lcard')).toHaveCount(5);
    await expect(page.locator('#lede')).toContainText('led every PSSBL hitter');
    await expect(page.locator('#site-updated')).toHaveText(/^Data updated /);
    expect(errors).toEqual([]);
  });

  test('defaults to oWAR descending and re-sorts on a header click', async ({ page }) => {
    await openSite(page);
    let rows = await leaderTable(page);
    const owar = rows.map((r) => num(r.oWAR));
    expect(owar).toEqual([...owar].sort((a, b) => b - a));

    await page.locator('#lb-table thead th[data-col="wRC+"] button').click();
    await expect(page.locator('#lb-table thead th[data-col="wRC+"]')).toHaveAttribute('aria-sort', 'descending');
    rows = await leaderTable(page);
    const wrc = rows.map((r) => num(r['wRC+']));
    expect(wrc).toEqual([...wrc].sort((a, b) => b - a));

    await page.locator('#lb-table thead th[data-col="wRC+"] button').click();
    await expect(page.locator('#lb-table thead th[data-col="wRC+"]')).toHaveAttribute('aria-sort', 'ascending');
  });

  test('pitching toggle switches columns and cards', async ({ page }) => {
    await openSite(page);
    await page.locator('#lb-type button[data-v="pit"]').click();
    await expect(page.locator('#lb-title')).toHaveText(/^Pitching leaders/);
    await expect(page.locator('#lb-min-label')).toHaveText('Min IP');
    await expect(page.locator('#lb-table thead th[data-col="FIP"]')).toHaveCount(1);
    await expect(page.locator('#lb-cards h4').first()).toHaveText('WAR');
    await expect(leaderRows(page).first()).toBeVisible();
  });

  test('Standard and Advanced groups change the columns', async ({ page }) => {
    await openSite(page);
    await page.locator('#lb-group button[data-v="std"]').click();
    await expect(page.locator('#lb-table thead th[data-col="GDP"]')).toHaveCount(1);
    await page.locator('#lb-group button[data-v="adv"]').click();
    await expect(page.locator('#lb-table thead th[data-col="wRAA"]')).toHaveCount(1);
  });

  test('division and team filters narrow the table', async ({ page }) => {
    await openSite(page);
    await pickDivs(page, 'Adams');
    await expect.poll(async () => [...new Set((await leaderTable(page)).map((r) => r.Div))]).toEqual(['Adams']);

    const team = await page.locator('#lb-team option').nth(1);
    const tid = await team.getAttribute('value');
    const name = (await team.textContent()) || '';
    await page.locator('#lb-team').selectOption(String(tid));
    await expect.poll(async () => [...new Set((await leaderTable(page)).map((r) => r.Team))]).toEqual([name.trim()]);
  });

  test('pager moves through pages', async ({ page }) => {
    await openSite(page);
    await page.locator('#lb-min').selectOption('0');
    await expect(page.locator('#lb-pageinfo')).toHaveText(/^1–50 of /);
    await page.locator('#lb-pager [data-p="next"]').click();
    await expect(page.locator('#lb-pageinfo')).toHaveText(/^51–100 of /);
    await expect(page.locator('#lb-table tbody tr td.rk').first()).toHaveText('51');
    await page.locator('#lb-pager [data-p="first"]').click();
    await expect(page.locator('#lb-pageinfo')).toHaveText(/^1–50 of /);
  });

  test('Matt is always shown and marked gold, even below the qualifying bar', async ({ page }) => {
    await openSite(page);
    await page.locator('#lb-q').fill('bereiter');
    await expect(leaderRows(page)).toHaveCount(2); // Beavers (qualified) + Brewers (not)
    await expect(page.locator(`#lb-table tbody tr.me a[data-pid="${MATT}"]`)).toHaveCount(2);
  });

  test('career view loads', async ({ page }) => {
    await openSite(page);
    await page.locator('#lb-season').selectOption('Career');
    await expect(page.locator('#lb-title')).toHaveText('Batting leaders · career');
    await expect(page.locator('#lb-table thead th[data-col="Seasons"]')).toHaveCount(1);
    await expect(leaderRows(page).first()).toBeVisible();
    await expect(page.locator('#lb-range-ctrl')).toBeHidden();
  });

  test('a name click opens the player page', async ({ page }) => {
    await openSite(page);
    const link = page.locator('#lb-table tbody tr td.name a').first();
    const name = (await link.textContent()) || '';
    await link.click();
    await expect(page.locator('#pg-players')).toBeVisible();
    await expect(page.locator('#p-name')).toHaveText(name);
  });

  test('switching batting and pitching keeps the team', async ({ page }) => {
    await openSite(page);
    await pickDivs(page, 'Adams');
    const tid = String(await page.locator('#lb-team option').nth(1).getAttribute('value'));
    await page.locator('#lb-team').selectOption(tid);
    await page.locator('#lb-type button[data-v="pit"]').click();
    await expect(page.locator('#lb-title')).toHaveText(/^Pitching/);
    await expect(page.locator('#lb-team')).toHaveValue(tid);
    await page.locator('#lb-type button[data-v="bat"]').click();
    await expect(page.locator('#lb-title')).toHaveText(/^Batting/);
    await expect(page.locator('#lb-team')).toHaveValue(tid);
  });
});
