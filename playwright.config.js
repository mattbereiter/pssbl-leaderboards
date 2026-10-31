// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// The page fetches data/*.csv, so it needs a real HTTP server (file:// won't do).
const PORT = Number(process.env.PW_PORT) || 8123; // PW_PORT: run beside another checkout's server

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `python tests/serve.py ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
