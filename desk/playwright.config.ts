import { defineConfig } from '@playwright/test';

// Playwright-Electron smoke tests live in e2e/ (added in T15). Unit tests in tests/ belong to vitest.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
