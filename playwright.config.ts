import { defineConfig } from '@playwright/test';
const webPort = process.env.E2E_WEB_PORT ?? '5273';
const apiPort = process.env.E2E_API_PORT ?? '3101';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? 'chromium' : 'msedge'),
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    // Vite can be ready while the API is still booting. Wait through its proxy.
    url: `http://127.0.0.1:${webPort}/api/health`,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      MODEL_MODE: 'demo',
      DEMO_DELAY_MS: '150',
      DATABASE_PATH: './data/e2e.sqlite',
      PORT: apiPort,
      WEB_PORT: webPort,
    },
  },
});
