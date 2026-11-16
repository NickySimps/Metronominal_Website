const { test: base } = require('@playwright/test');

const test = base.extend({
  browser: async ({ browser }, use, testInfo) => {
    const endpoint = testInfo.config.metadata?.testSignalURL;
    if (!endpoint) return use(browser);

    const originalNewContext = browser.newContext;
    browser.newContext = async function (...args) {
      const context = await originalNewContext.apply(this, args);
      try {
        await context.addInitScript(url => {
          const Native = window.WebSocket;
          window.WebSocket = class extends Native {
            constructor(target, ...protocols) {
              const mapped = String(target).replace(/^ws:\/\/(?:127\.0\.0\.1|localhost):10000\/?$/, url);
              super(mapped, ...protocols);
            }
          };
        }, endpoint);
        return context;
      } catch (error) {
        await context.close();
        throw error;
      }
    };
    try {
      await use(browser);
    } finally {
      browser.newContext = originalNewContext;
    }
  },
});

module.exports = { test };
