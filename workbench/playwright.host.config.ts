import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/host',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3012',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
});
