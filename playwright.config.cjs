const { defineConfig } = require('@playwright/test');

const externalBaseURL = process.env.E2E_BASE_URL;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: externalBaseURL || 'http://127.0.0.1:4173',
    headless: true,
  },
  webServer: externalBaseURL ? undefined : [
    {
      command: 'python -m http.server 4173 --bind 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'node ../MetronomeSignalServer/server.js',
      url: 'http://127.0.0.1:10000',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
