import type { ClientEnv } from '@ze-great-dashboard/shared/browser'
import { describe, expect, it, vi } from 'vitest'
import { dashboardFetch } from '../src/dashboard-fetch.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.test/dashboard',
  assetPathId: 'sha256:3f454a601d3791a603e550652cec7ca1fb4359489df99605e72e051dd5b02731',
  proxyPath: '/api',
  board: 'ops',
}

describe('authenticated dashboard requests', () => {
  it('takes an access token from the explicit request capability, not browser storage', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-token')
      return new Response(null, { status: 200 })
    })

    await dashboardFetch(env, '/api/boards/ops', undefined, fetcher, {
      accessToken: 'access-token',
    })
  })

  it('reports authorization failures to the owning auth boundary', async () => {
    const failed = vi.fn()
    await dashboardFetch(
      env,
      '/api/boards/ops',
      undefined,
      async () => new Response(null, { status: 403 }),
      {
        onAuthenticationFailure: failed,
      },
    )
    expect(failed).toHaveBeenCalledWith(403)
  })
})
