import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173/__ASSET_PATH__/',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command:
      'npm run preview --workspace @continuous-excellence/ze-great-dashboard-client -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/__ASSET_PATH__/',
    reuseExistingServer: !process.env.CI,
  },
})
