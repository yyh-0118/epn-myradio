import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5178', trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5178', reuseExistingServer: true, timeout: 60_000 },
});
