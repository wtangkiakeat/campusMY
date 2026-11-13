import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'member-flows.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: '../../test-results/member-browser',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3001',
    viewport: process.env.MEMBER_BROWSER_VIEWPORT === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    isMobile: process.env.MEMBER_BROWSER_VIEWPORT === 'mobile',
    hasTouch: process.env.MEMBER_BROWSER_VIEWPORT === 'mobile',
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'darwin' ? 'chrome' : undefined),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
