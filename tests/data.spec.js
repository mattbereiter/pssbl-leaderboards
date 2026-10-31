// @ts-check
const { test, expect } = require('@playwright/test');

// pssbl.com sends some names double-encoded ('JosÃ©'); fetch.load() repairs them. Catch any that slip through.
const GARBLED = /Ã|Â|â€|�/;

test.describe('Published data', () => {
  test('names and teams have no garbled characters', async ({ request }) => {
    const manifest = await (await request.get('data/manifest.json')).json();
    const bad = [];
    for (const file of Object.values(manifest.datasets)) {
      const text = await (await request.get('data/' + file)).text();
      for (const line of text.split('\n')) if (GARBLED.test(line)) bad.push(`${file}: ${line.slice(0, 80)}`);
    }
    expect(bad).toEqual([]);
  });
});
