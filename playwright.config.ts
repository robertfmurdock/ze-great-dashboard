import { defineConfig, devices } from '@playwright/test'

const browserTestOrigin = process.env.PW_TEST_ORIGIN ?? 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: `${browserTestOrigin}/__ASSET_PATH__/`,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command:
      'npm run preview --workspace @continuous-excellence/ze-great-dashboard-client -- --host 0.0.0.0',
    url: 'http://127.0.0.1:4173/__ASSET_PATH__/',
    reuseExistingServer: !process.env.CI,
  },
})
