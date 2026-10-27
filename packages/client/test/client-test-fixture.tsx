import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { cleanup } from '@testing-library/react'
import type { ClientEnv } from '@ze-great-dashboard/shared/browser'
import { vi } from 'vitest'

export const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  assetPathId: 'sha256:3f454a601d3791a603e550652cec7ca1fb4359489df99605e72e051dd5b02731',
  proxyPath: '/api',
  board: 'ze-great-team',
}

export function clientTestFixture(scope: ResourceScope) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  )
  try {
    window.localStorage.clear()
  } catch {
    // Browser storage is an optional application optimization.
  }
  scope.defer('client test cleanup', () => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
}
