// @ts-check
// Journey-review polish: filters that explain themselves, honest search ranks, empty states and small feel fixes
const { test, expect } = require('@playwright/test');
const { MATT, trackErrors, openSite, leaderRows, leaderTable, goTab, pickDivs, pickTeams } = require('./helpers');

test.describe('Journey polish: filters', () => {
  test('changing season keeps the team by name, and says so when it can\'t', async ({ page }) => {
    await openSite(page);
    await pickDivs(page, 'Adams');
    await pickTeams(page, '1450'); // 2026 Mets
    await expect(page.locator('#lb-chips')).toContainText('Mets');
    await page.locator('#lb-season').selectOption('2025');
    await expect(page.locator('#lb-team')).toHaveAttribute('data-value', '1378'); // 2025 Mets
    await expect(page.locator('#lb-notice')).toBeHidden();

    await page.locator('#lb-season').selectOption('2026');
    await pickTeams(page, '1520'); // Beavers, new in 2026
    await page.locator('#lb-season').selectOption('2025');
    await expect(page.locator('#lb-team')).toHaveAttribute('data-value', 'All');
    await expect(page.locator('#lb-notice')).toContainText('No Beavers');
  });

  test('a team view shows everyone, drops the Div column, and the chip clears it', async ({ page }) => {
    await openSite(page);
    await pickDivs(page, 'Adams');
    await pickTeams(page, '1450');
    await expect(page.locator('#lb-min')).toHaveValue('0');
    await expect(page.locator('#lb-table thead th.col-div')).toBeHidden();
    await page.locator('#lb-chips button[data-clear="team:1450"]').click();
    await expect(page.locator('#lb-team')).toHaveAttribute('data-value', 'All');
    await expect(page.locator('#lb-min')).toHaveValue('q');
    await page.locator('#lb-chips button[data-clear="div"]').click();
    await expect(page.locator('#lb-div')).toHaveAttribute('data-value', 'All');
  });

  test('Team is a multi-select like Division: several teams, a chip each, kept across seasons and in the link', async ({ page }) => {
    await page.goto('/#leaders?season=2026');
    await expect(leaderRows(page).first()).toBeVisible();
    await pickTeams(page, '1450', '1452'); // Mets, Saints (both Adams)
    await expect(page.locator('#lb-team')).toHaveAttribute('data-value', '1450,1452');
    await expect(page.locator('#lb-team')).toHaveText('Mets, Saints');
    await expect.poll(async () => [...new Set((await leaderTable(page)).map((r) => r.Team))].sort()).toEqual(['Mets', 'Saints']);
    await expect(page.locator('#lb-table thead th.col-div')).toBeHidden(); // one division
    await expect(page.locator('#lb-chips button[data-clear^="team:"]')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('team=1450,1452');

    await page.locator('#lb-team').click();
    await page.locator('#lb-team-list input[value="1498"]').check(); // Sierra Ravens
    await page.keyboard.press('Escape');
    await expect(page.locator('#lb-team')).toHaveText('3 teams');
    await expect(page.locator('#lb-table thead th.col-div')).toBeVisible(); // now two divisions

    await page.locator('#lb-chips button[data-clear="team:1498"]').click();
    await expect(page.locator('#lb-team')).toHaveAttribute('data-value', '1450,1452');
    await page.locator('#lb-season').selectOption('2025');
    await expect(page.locator('#lb-team')).toHaveText('Mets, Saints'); // the 2025 teams of those names
    await expect(page.locator('#lb-team')).not.toHaveAttribute('data-value', '1450,1452');

    await page.reload();
    await expect(page.locator('#lb-team')).toHaveText('Mets, Saints');
  });

  test('a range with no games keeps Division and Team and says why it is empty', async ({ page }) => {
    await openSite(page);
    const season = await page.locator('#lb-season').inputValue();
    await pickDivs(page, 'Adams');
    await page.locator('#lb-range').selectOption('custom');
    await page.locator('#lb-from').fill(`${season}-01-02`);
    await page.locator('#lb-from').dispatchEvent('change');
    await page.locator('#lb-to').fill(`${season}-01-20`);
    await page.locator('#lb-to').dispatchEvent('change');
    await expect(page.locator('#lb-table caption')).toHaveText('No games were played in this range.');
    await expect(page.locator('#lb-cards .pg-empty')).toHaveCount(1);
    await expect(page.locator('#lb-div')).toHaveAttribute('data-value', 'Adams');
  });

  test('picking Custom keeps the month you were looking at', async ({ page }) => {
    await openSite(page);
    const season = await page.locator('#lb-season').inputValue();
    await page.locator('#lb-range').selectOption('m7');
    await page.locator('#lb-range').selectOption('custom');
    await expect(page.locator('#lb-from')).toHaveValue(`${season}-07-01`);
    await expect(page.locator('#lb-to')).toHaveValue(`${season}-07-31`);
  });

  test('a link to a season that doesn\'t exist says so', async ({ page }) => {
    await page.goto('/#leaders?season=1999');
    await expect(leaderRows(page).first()).toBeVisible();
    await expect(page.locator('#lb-notice')).toContainText('no 1999 season');
  });
});

test.describe('Journey polish: search and sorting', () => {
  test('a searched player keeps their real rank and the count reads right', async ({ page }) => {
    await page.goto('/#leaders?min=0&q=bereiter');
    await expect(leaderRows(page)).toHaveCount(2);
    await expect(page.locator('#lb-count')).toHaveText('2 players');
    const rank = Number(await page.locator('#lb-table tbody td.rk').first().textContent());
    expect(rank).toBeGreaterThan(1);
    // the same row sits at that rank on the unsearched board
    await page.goto(`/?r#leaders?min=0&size=25&page=${Math.ceil(rank / 25)}`);
    await expect(page.locator(`#lb-table tbody tr:has(td.rk:text-is("${rank}")) a[data-pid]`)).toHaveAttribute('data-pid', MATT);
    await page.locator('#lb-q').fill('bereiter matt'); // any word order
    await expect(leaderRows(page)).toHaveCount(2);
  });

  test('the player finder ignores accents and forgives a typo', async ({ page }) => {
    await page.goto('/#players/' + MATT);
    await page.locator('#p-q').fill('felix reyes');
    await expect(page.locator('#p-sugg')).toContainText('Félix Reyes');
    await page.locator('#p-q').fill('bereitr');
    await expect(page.locator('#p-sugg')).toContainText('Matt Bereiter');
  });

  test('the sorted column shows its direction', async ({ page }) => {
    await openSite(page);
    const arrow = () => page.locator('#lb-table thead th[aria-sort] button').evaluate((b) => getComputedStyle(b, '::after').content);
    expect(await arrow()).toContain('▼');
    await page.locator('#lb-table thead th[data-col="oWAR"] button').click();
    expect(await arrow()).toContain('▲');
  });

  test('switching to Pitching starts the table at the left edge', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openSite(page);
    await page.locator('#lb-wrap').evaluate((w) => { w.scrollLeft = 600; });
    await page.locator('#lb-type button[data-v="pit"]').click();
    await expect(page.locator('#lb-title')).toHaveText(/^Pitching/);
    expect(await page.locator('#lb-wrap').evaluate((w) => w.scrollLeft)).toBe(0);
  });
});

test.describe('Journey polish: states and small things', () => {
  test('an unknown player says so instead of loading forever', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#players/999999');
    await expect(page.locator('#p-name')).toHaveText('Player not found');
    await expect(page.locator('#p-strip')).toContainText('No player with id 999999');
    await expect(page.locator('#p-group')).toBeHidden();
    await expect(page.locator('#pg-players .dash-skeleton:visible')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('pitcher home runs show — where pssbl.com has none', async ({ page }) => {
    await page.goto('/#leaders?type=pit&group=std');
    await expect(leaderRows(page).first()).toBeVisible();
    await expect(page.locator('#lb-table tbody tr').first().locator('td').nth(5 + 14)).toHaveText('—'); // # Name Team Div Age, then HR is the 15th stat
    await expect(page.locator('#lb-table thead th[data-col="HR/9"]')).toHaveCount(0);
  });

  test('the league-news line stays on the current Leaders view and the tab title names the view', async ({ page }) => {
    await openSite(page);
    await expect(page.locator('#lede')).toBeVisible();
    await expect(page).toHaveTitle(/^Batting leaders · \d{4} — PSSBL Leaderboards$/);
    await goTab(page, 'standings');
    await expect(page.locator('#lede')).toBeHidden();
    await expect(page).toHaveTitle(/^Standings · \d{4} — PSSBL Leaderboards$/);
    await goTab(page, 'me');
    await expect(page).toHaveTitle('Matt Bereiter — PSSBL Leaderboards');
    await expect(page.locator('#tab-me')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-players')).toHaveAttribute('aria-selected', 'false');
  });

  test('champions explain their trophy, Standings has a heading', async ({ page }) => {
    await page.goto('/#standings?season=2025');
    await expect(page.locator('#st-title')).toHaveText('Standings · 2025');
    await expect(page.locator('#st-grid .champ-i').first()).toHaveAttribute('title', /last playoff game/);
  });

  test('the player page says where the latest season ranks and links the team', async ({ page }) => {
    await page.goto('/#players/' + MATT);
    await expect(page.locator('#p-rank')).toContainText(/\d+(st|nd|rd|th) of \d+ \w+ hitters in oWAR \(\d{4}\)/);
    await expect(page.locator('#p-sub a.pg-chip')).toHaveAttribute('href', /^#leaders\?/);
    await expect(page.locator('#p-bat-chart .pg-legend')).toContainText('Adams');
    await expect(page.locator('#p-bat-chart .pg-legend')).toContainText('Sierra');
  });

  test('column definitions are a tap away, with what counts as good', async ({ page }) => {
    await openSite(page);
    await page.locator('#lb-defs summary').click();
    await expect(page.locator('#lb-defs-list')).toContainText('wRC+');
    await expect(page.locator('#lb-defs-list')).toContainText('top quarter');
  });

  test('an all-seasons board of single-season lines, and bigger career minimums', async ({ page }) => {
    await page.goto('/#leaders?season=All&sort=wRC%2B&div=Adams');
    await expect(leaderRows(page).first()).toBeVisible();
    await expect(page.locator('#lb-table thead th[data-col="Season"]')).toHaveText('Year');
    const years = await page.locator('#lb-table tbody tr td:nth-child(5)').allTextContents();
    expect(new Set(years).size).toBeGreaterThan(3);
    await page.locator('#lb-season').selectOption('Career');
    await expect(page.locator('#lb-min option[value="1000"]')).toHaveCount(1);
  });
});
