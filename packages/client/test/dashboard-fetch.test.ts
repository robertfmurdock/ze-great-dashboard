import { mintTest } from '@continuous-excellence/testmints-js/vitest'
import type { ClientEnv } from '@ze-great-dashboard/shared/browser'
import { describe, expect, vi } from 'vitest'
import { dashboardFetch } from '../src/dashboard-fetch.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.test/dashboard',
  assetPathId: 'sha256:3f454a601d3791a603e550652cec7ca1fb4359489df99605e72e051dd5b02731',
  proxyPath: '/api',
  board: 'ops',
}

describe('authenticated dashboard requests', () => {
  mintTest('takes an access token from the explicit request capability, not browser storage', {
    setup: () => {
      const accessToken = 'capability-owned-access-token'
      const observed: { headers?: Headers } = {}
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        observed.headers = new Headers(init?.headers)
        return new Response(null, { status: 200 })
      })

      return { accessToken, fetcher, observed }
    },
    exercise: ({ accessToken, fetcher }) =>
      dashboardFetch(env, '/api/boards/ops', undefined, fetcher, {
        accessToken,
      }),
    verify: (_response, { accessToken, observed }) => {
      expect(observed.headers?.get('authorization')).toBe(`Bearer ${accessToken}`)
    },
  })

  mintTest('reports authorization failures to the owning auth boundary', {
    setup: () => ({
      failed: vi.fn(),
      fetcher: async () => new Response(null, { status: 403 }),
    }),
    exercise: ({ failed, fetcher }) =>
      dashboardFetch(env, '/api/boards/ops', undefined, fetcher, {
        onAuthenticationFailure: failed,
      }),
    verify: (_response, { failed }) => {
      expect(failed).toHaveBeenCalledWith(403)
    },
  })
})
