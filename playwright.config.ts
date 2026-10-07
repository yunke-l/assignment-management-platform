import { defineConfig, devices } from '@playwright/test';
// Playwright propagates FORCE_COLOR to workers. Keep an inherited no-color
// preference without passing the contradictory pair that makes Node warn.
if (process.env.NO_COLOR !== undefined) {
  process.env.FORCE_COLOR = '0';
  delete process.env.NO_COLOR;
}
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'on',
    ...(process.env.PLAYWRIGHT_CHROME_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } }
      : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://127.0.0.1:5175/api/health',
    reuseExistingServer: false,
    timeout: 120000,
    env: { API_PROXY_TARGET: 'http://127.0.0.1:3111', WEB_ORIGIN: 'http://127.0.0.1:5175' },
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
