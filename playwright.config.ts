import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.PW_TEST_ORIGIN,
    ...devices['Desktop Chrome'],
    ...(process.env.PW_TEST_NATIVE_BROWSER === '1'
      ? {
          launchOptions: {
            args: [
              '--host-resolver-rules=MAP *.dashboard.test 127.0.0.1, MAP local.ze-great-dashboard.test 127.0.0.1, MAP host.docker.internal 127.0.0.1',
            ],
          },
        }
      : {}),
  },
})
