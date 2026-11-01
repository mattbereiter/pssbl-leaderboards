// @ts-check
const { test, expect } = require('@playwright/test');
const { MATT, trackErrors, openSite, leaderTable } = require('./helpers');

// League age (season − birth year, as pssbl.com counts it), from the birth dates on pssbl.com team rosters.
const AJ = '3393';      // AJ Hansen, born 1993: 22 in 2015, 33 in 2026
const NO_AGE = '7509';  // Brett Coleman: on no roster, so no birth date

/** Map Season -> Age for every row of a Players season table. */
async function agesIn(page, sel) {
  return page.locator(sel).evaluate((box) => {
    const out = {};
    for (const t of box.querySelectorAll('table')) {
      const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      const si = heads.indexOf('Season'), ai = heads.indexOf('Age');
      for (const tr of t.querySelectorAll('tbody tr:not(.career)')) out[tr.cells[si].textContent.trim()] = tr.cells[ai].textContent.trim();
    }
    return out;
  });
}

test.describe('Age', () => {
  test('Players shows the age for each season and the current age', async ({ page }) => {
    const errors = trackErrors(page);
    await openSite(page, `players/${AJ}`);
    await expect(page.locator('#p-name')).toHaveText('AJ Hansen');
    await expect(page.locator('#p-age')).toHaveText('Age 33');
    // the history table arrives after the current season's, so wait for it
    await expect.poll(() => agesIn(page, '#p-bat-tables')).toMatchObject({ 2015: '22', 2019: '26', 2026: '33' });
    expect(errors).toEqual([]);
  });

  test("Matt's league age counts his August birthday (35 in 2026)", async ({ page }) => {
    await openSite(page, `players/${MATT}`);
    await expect(page.locator('#p-age')).toHaveText('Age 35');
    await expect.poll(() => agesIn(page, '#p-bat-tables')).toMatchObject({ 2025: '34', 2026: '35' });
  });

  test('a player without a birth date shows blanks, not NaN', async ({ page }) => {
    const errors = trackErrors(page);
    await openSite(page, `players/${NO_AGE}`);
    await expect(page.locator('#p-name')).toHaveText('Brett Coleman');
    await expect(page.locator('#p-age')).toHaveCount(0);
    await expect(page.locator('#p-sub')).not.toContainText(/NaN|null|undefined/);
    await expect.poll(async () => Object.keys(await agesIn(page, '#p-bat-tables')).sort()).toEqual(['2024', '2025']);
    const ages = await agesIn(page, '#p-bat-tables');
    for (const a of Object.values(ages)) expect(a).toBe('');
    expect(errors).toEqual([]);
  });

  test('Leaders has a sortable Age column, youngest first, blanks last', async ({ page }) => {
    await openSite(page, 'leaders?min=0');
    const th = page.locator('#lb-table thead th[data-col="Age"]');
    await th.locator('button').click();
    await expect(th).toHaveAttribute('aria-sort', 'ascending');
    let rows = await leaderTable(page);
    const asc = rows.map((r) => r.Age);
    expect(asc.join(' ')).not.toMatch(/NaN|null|undefined/);
    const n = asc.filter(Boolean).map(Number);
    expect(n.length).toBeGreaterThan(40);
    expect(n).toEqual([...n].sort((a, b) => a - b));

    await th.locator('button').click();
    await expect(th).toHaveAttribute('aria-sort', 'descending');
    rows = await leaderTable(page);
    const d = rows.map((r) => Number(r.Age));
    expect(d).toEqual([...d].sort((a, b) => b - a));
    expect(d[0]).toBeGreaterThan(60);
  });

  test('Age shows in career, date-range and projected boards', async ({ page }) => {
    const errors = trackErrors(page);
    for (const hash of ['leaders?season=Career', 'leaders?range=reg', 'leaders?season=ProjAdams']) {
      await openSite(page, hash, { fresh: true }); // a hash-only goto could read the previous board
      const rows = await leaderTable(page);
      expect(rows.filter((r) => /^\d+$/.test(r.Age)).length, hash).toBeGreaterThan(40);
      expect(rows.map((r) => r.Age).join(' '), hash).not.toMatch(/NaN|null|undefined/);
    }
    expect(errors).toEqual([]);
  });
});
