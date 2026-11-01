// @ts-check
const { test, expect } = require('@playwright/test');
const { trackErrors, openSite, leaderRows, leaderTable, pickDivs } = require('./helpers');

// Same numbers as the Players card (tests/projection.spec.js) and analysis/project_to_adams.py.
test.describe('Leaders: Projected → Adams / Sierra', () => {
  test('ranks other-division players by projected wRC+ in Adams', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#leaders?season=ProjAdams');
    await expect(leaderRows(page).first()).toBeVisible();
    await expect(page.locator('#lb-title')).toContainText('projected in Adams');
    await expect(page.locator('#lb-note')).toContainText(/self-selected/i);
    await expect(page.locator('#lb-range-ctrl')).toBeHidden();
    await expect(page.locator('#lb-group button').first()).toBeHidden();

    const rows = await leaderTable(page);
    expect(rows.length).toBeGreaterThan(20);
    const wrc = rows.map((r) => Number(r['wRC+']));
    expect(wrc[0]).toBeGreaterThanOrEqual(wrc[1]);
    for (const r of rows) expect(r.From).not.toBe('');
    for (const r of rows) expect(r.From).not.toBe('Adams'); // Adams-only players have nothing to translate into Adams

    await page.locator('#lb-q').fill('aj hansen');
    await expect(leaderRows(page)).toHaveCount(1);
    const [aj] = await leaderTable(page);
    expect(aj).toMatchObject({ AVG: '.329', OBP: '.456', SLG: '.450', wOBA: '.404', 'wRC+': '123', 'Eff PA': '307', 'Own%': '84' });
    expect(aj.From).toContain('Rocky');
    await expect(page.locator('#lb-cards')).toContainText('AJ Hansen');
    expect(errors).toEqual([]);
  });

  test('pitchers sort by projected FIP- (low first)', async ({ page }) => {
    await page.goto('/#leaders?type=pit&season=ProjAdams');
    await expect(leaderRows(page).first()).toBeVisible();
    const rows = await leaderTable(page);
    expect(Number(rows[0]['FIP-'])).toBeLessThanOrEqual(Number(rows[1]['FIP-']));
    await page.locator('#lb-q').fill('cameron lobb');
    await expect(leaderRows(page)).toHaveCount(1);
    expect((await leaderTable(page))[0]).toMatchObject({ 'FIP-': '81', FIP: '4.14', 'K%': '21.9 %', 'BB%': '6.7 %' });
  });

  test('the division filter means "came from", and Sierra is in the season menu', async ({ page }) => {
    await page.goto('/#leaders?season=ProjAdams&div=Rocky');
    await expect(leaderRows(page).first()).toBeVisible();
    for (const r of await leaderTable(page)) expect(r.From).toContain('Rocky');

    await page.locator('#lb-season').selectOption({ label: 'Projected → Sierra' });
    await expect(page).toHaveURL(/season=ProjSierra/);
    await page.locator('#lb-q').fill('aj hansen');
    await expect(leaderRows(page)).toHaveCount(1);
    expect((await leaderTable(page))[0]).toMatchObject({ 'wRC+': '120' });
  });

  test('the division menu takes several divisions at once', async ({ page }) => {
    await page.goto('/#leaders?season=ProjAdams');
    await expect(leaderRows(page).first()).toBeVisible();
    const count = async () => Number((await page.locator('#lb-count').textContent()).match(/^[\d,]+/)[0].replace(',', ''));
    const all = await count();
    await pickDivs(page, 'Sierra', 'Rocky', 'Denali');
    await expect(page).toHaveURL(/div=(Denali|Rocky|Sierra)(%2C|,)/);
    await expect(page.locator('#lb-div')).toContainText('3 divisions');
    const rows = await leaderTable(page);
    expect(rows.length).toBeGreaterThan(10);
    expect(await count()).toBeLessThan(all);
    for (const r of rows) expect(r.From.split(', ').some((d) => ['Sierra', 'Rocky', 'Denali'].includes(d))).toBe(true);

    await page.goto('/?5#leaders?season=ProjSierra&div=Adams,Rocky&q=aj%20hansen'); // survives a reload, works for Sierra
    await expect(leaderRows(page)).toHaveCount(1);
    await expect(page.locator('#lb-div')).toHaveAttribute('data-value', 'Adams,Rocky');
    await expect(page.locator('#lb-div')).toContainText('Adams, Rocky');
  });

  test('several divisions on a normal season too', async ({ page }) => {
    await page.goto('/#leaders?season=2026');
    await expect(leaderRows(page).first()).toBeVisible();
    await pickDivs(page, 'Adams', 'Sierra');
    await page.locator('#lb-min').selectOption('0');
    await expect.poll(async () => [...new Set((await leaderTable(page)).map((r) => r.Div))].sort()).toEqual(['Adams', 'Sierra']);
    await pickDivs(page);
    await expect(page.locator('#lb-div')).toContainText('All divisions');
  });

  test('Adams players show up projected to Sierra, Sierra players to Adams, Matt in both', async ({ page }) => {
    await page.goto('/#leaders?season=ProjSierra&q=noah%20zwiren');
    await expect(leaderRows(page)).toHaveCount(1);
    expect((await leaderTable(page))[0]).toMatchObject({ From: 'Adams', 'wRC+': '105' });

    await page.goto('/?2#leaders?season=ProjAdams&q=noah%20zwiren'); // ?n: a real load each time, not a hash change
    await expect(page.locator('#lb-table caption')).toContainText(/No player/);

    await page.goto('/?3#leaders?season=ProjAdams&q=paul%20fisher');
    await expect(leaderRows(page)).toHaveCount(1);
    expect((await leaderTable(page))[0]).toMatchObject({ From: 'Sierra', 'wRC+': '132' });

    await page.goto('/?4#leaders?season=ProjSierra&q=bereiter');
    await expect(page.locator('#lb-table tbody tr.me')).toHaveCount(1);
    expect((await leaderTable(page))[0]).toMatchObject({ 'wRC+': '79' });
  });

  for (const T of ['Adams', 'Sierra', 'Cascade']) {
    test(`every line projected to ${T} holds together: SLG and OBP at least AVG, nothing near zero`, async ({ page }) => {
      test.slow(); // pages through the whole 500+ row board
      await openSite(page, `leaders?season=Proj${T}&min=0&size=250`, { fresh: true });
      const rows = [];
      for (;;) { // every page of the board
        const info = await page.locator('#lb-pageinfo').textContent();
        rows.push(...await leaderTable(page));
        const next = page.locator('#lb-pager button[data-p="next"]');
        if (await next.isDisabled()) break;
        await next.click();
        await expect(page.locator('#lb-pageinfo')).not.toHaveText(info);
      }
      expect(rows.length).toBeGreaterThan(500);
      const bad = [];
      for (const r of rows) {
        const [avg, obp, slg] = [r.AVG, r.OBP, r.SLG].map(Number);
        if (!(slg >= avg)) bad.push(`${r.Name}: SLG ${r.SLG} < AVG ${r.AVG}`);
        if (!(obp >= avg - 0.005)) bad.push(`${r.Name}: OBP ${r.OBP} < AVG ${r.AVG}`);
        if (!(avg > 0.1)) bad.push(`${r.Name}: AVG ${r.AVG}`);
      }
      expect(bad).toEqual([]);
    });
  }

  test('Projected → Cascade is in the season menu and leaves out Cascade-only players', async ({ page }) => {
    const errors = trackErrors(page);
    await openSite(page);
    await page.locator('#lb-season').selectOption('ProjCascade');
    await expect(page.locator('#lb-title')).toContainText('projected in Cascade');
    await expect(leaderRows(page).first()).toBeVisible();
    const rows = await leaderTable(page);
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) expect(r.From).not.toBe('Cascade');
    // Cascade is the strongest division, so the same hitters project lower there than in Adams
    await page.goto('/?c#leaders?season=ProjCascade&q=aj%20hansen');
    await expect(leaderRows(page)).toHaveCount(1);
    expect(Number((await leaderTable(page))[0]['wRC+'])).toBeLessThan(123);
    expect(errors).toEqual([]);
  });

  test('Projected → Sierra leaves out anyone under league age 29', async ({ page }) => {
    const errors = trackErrors(page);
    await openSite(page, 'leaders?season=ProjSierra&min=0&size=250&sort=Age&dir=1', { fresh: true });
    const rows = await leaderTable(page);
    const ages = rows.map((r) => r.Age).filter((a) => a !== '' && a !== '—').map(Number);
    expect(ages.length).toBeGreaterThan(50);
    expect(Math.min(...ages)).toBeGreaterThanOrEqual(29);
    await expect(page.locator('#lb-note')).toContainText('29');
    // the same young (Adams-only) player still projects to Cascade, and his card skips Sierra
    await page.goto('/?y#leaders?season=ProjCascade&min=0&q=lewis%20fromberg');
    await expect(leaderRows(page)).toHaveCount(1);
    await page.goto('/?y#leaders?season=ProjSierra&min=0&q=lewis%20fromberg');
    await expect(page.locator('#lb-table caption')).toContainText('No player');
    await page.goto('/#players/5683'); // Lewis Fromberg, 27, Adams
    await expect(page.locator('#p-proj')).toBeVisible();
    await expect(page.locator('#p-proj-bat tbody tr')).toHaveText([/^Cascade/]);
    expect(errors).toEqual([]);
  });

  test('Division → All except leaves out players from those divisions', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/#leaders?season=ProjAdams&min=0&size=250');
    await expect(leaderRows(page).first()).toBeVisible();
    await page.locator('#lb-div').click();
    await page.locator('#lb-div-list button[data-mode="except"]').click();
    await page.locator('#lb-div-list input[value="Sierra"]').check();
    await page.locator('#lb-div-list input[value="Cascade"]').check();
    await page.keyboard.press('Escape');
    await expect(page.locator('#lb-div')).toHaveAttribute('data-value', '!Cascade,Sierra');
    await expect(page.locator('#lb-div')).toHaveText('All but Cascade, Sierra');
    await expect(page.locator('#lb-chips')).toContainText('All but Cascade, Sierra');
    const rows = await leaderTable(page);
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) expect(r.From).not.toMatch(/Sierra|Cascade/);
    await expect(page.locator('#lb-table tbody tr.me')).toHaveCount(0); // Matt has Sierra time
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('div=!Cascade,Sierra');

    // the link survives a reload, and "Only" flips the same picks back to an include
    await page.reload();
    await expect(page.locator('#lb-div')).toHaveText('All but Cascade, Sierra');
    await page.locator('#lb-div').click();
    await page.locator('#lb-div-list button[data-mode="only"]').click();
    await expect(page.locator('#lb-div')).toHaveAttribute('data-value', 'Cascade,Sierra');
    await page.keyboard.press('Escape');
    for (const r of await leaderTable(page)) expect(r.From).toMatch(/Sierra|Cascade/);
    expect(errors).toEqual([]);
  });

  test('Carl Gleason (Adirondack/Rainier/Teton) projects to a sane line', async ({ page }) => {
    await page.goto('/#players/843');
    await page.locator('#p-proj summary').click(); // collapsed at the foot of the page
    await expect(page.locator('#p-proj-bat')).toBeVisible();
    const cells = await page.locator('#p-proj-bat tbody tr').first().locator('td').allTextContents();
    const [avg, obp, slg] = cells.slice(1, 4).map(Number);
    expect(slg).toBeGreaterThanOrEqual(avg);
    expect(avg).toBeGreaterThan(0.15); // a weak Adams hitter, but a real line (was .119/.316/.028)
    expect(obp).toBeGreaterThan(avg);
  });

  test('going back to a normal season restores the usual table', async ({ page }) => {
    await page.goto('/#leaders?season=ProjAdams');
    await expect(leaderRows(page).first()).toBeVisible();
    await page.locator('#lb-season').selectOption('2026');
    await expect(page.locator('#lb-group button').first()).toBeVisible();
    await expect(page.locator('#lb-title')).toContainText('2026');
    await expect(page.locator('#lb-table thead')).toContainText('oWAR');
  });
});
