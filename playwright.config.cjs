const fs = require('fs');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const signalServerPath = process.env.SIGNAL_SERVER_PATH || path.resolve(__dirname, '..', 'MetronomeSignalServer', 'server.js');
const signalServerDir = path.dirname(signalServerPath);
const signalServerAvailable = fs.existsSync(signalServerPath);
const webServers = [
  {
    command: 'python -m http.server 4173',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
];
if (signalServerAvailable) {
  webServers.push({
    command: 'npm start',
    cwd: signalServerDir,
    url: 'http://127.0.0.1:10000',
    reuseExistingServer: true,
    timeout: 30_000,
  });
}

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
  webServer: webServers,
  metadata: {
    signalServerAvailable,
    signalServerPath,
  },
});
