import { defineConfig } from '@playwright/test'

const realFiles = process.env.WORKLANE_REAL_FILES === '1'
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: realFiles ? '**/*.manual.mjs' : '**/*.spec.mjs',
  workers: 1,
  retries: 0,
  timeout: realFiles ? 300000 : 45000,
  expect: { timeout: 8000 },
  reporter: [['list'], ['json', { outputFile: realFiles ? 'test-results/real-files.json' : 'test-results/acceptance.json' }]],
  outputDir: 'test-results',
  use: {
    actionTimeout: 8000,
    channel: 'chrome',
    headless: !realFiles,
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
    launchOptions: { chromiumSandbox: true },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-local.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 15000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
})
