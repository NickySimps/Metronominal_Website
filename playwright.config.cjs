const fs = require('fs');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const signalServerPath = process.env.SIGNAL_SERVER_PATH || path.resolve(__dirname, '..', 'MetronomeSignalServer', 'server.js');
const signalServerAvailable = fs.existsSync(signalServerPath);

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'python -m http.server 4173',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  metadata: {
    signalServerAvailable,
    signalServerPath,
  },
});
