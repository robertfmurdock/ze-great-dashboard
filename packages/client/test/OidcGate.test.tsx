import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ClientEnv } from '@ze-great-dashboard/shared/browser'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

const useAuth = vi.hoisted(() => vi.fn())
vi.mock('react-oidc-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  hasAuthParams: () => false,
  useAuth,
}))
vi.mock('../src/oidc-manager.ts', () => ({ createOidcManager: vi.fn(() => ({})) }))

import { OidcGate } from '../src/OidcGate.tsx'

const env: ClientEnv = {
  assetPath: 'https://assets.example.test/dashboard',
  assetPathId: 'sha256:3f454a601d3791a603e550652cec7ca1fb4359489df99605e72e051dd5b02731',
  proxyPath: '/api',
  board: 'operations',
  auth: { issuer: 'https://issuer.example.test', clientId: 'dashboard', audience: 'dashboard-api' },
}
const auth = {
  issuer: 'https://issuer.example.test',
  clientId: 'dashboard',
  audience: 'dashboard-api',
}

afterEach(() => vi.resetAllMocks())

describe('OIDC denied boundary', () => {
  test(
    'replaces admitted content with the generic denied view when an authenticated request is forbidden',
    mint({
      setup: () => {
        useAuth.mockReturnValue({
          isLoading: false,
          isAuthenticated: true,
          user: { access_token: 'access-token' },
          signoutRedirect: vi.fn(),
        })
        const user = userEvent.setup()
        render(
          <OidcGate env={env} auth={auth}>
            {(_token, denied) => (
              <button type="button" onClick={denied}>
                Request protected details
              </button>
            )}
          </OidcGate>,
        )
        return { user }
      },
      exercise: ({ user }) =>
        user.click(screen.getByRole('button', { name: 'Request protected details' })),
      verify: () => {
        expect(screen.getByRole('heading', { name: 'Access denied' })).not.toBeNull()
        expect(screen.queryByRole('button', { name: 'Request protected details' })).toBeNull()
      },
    }),
  )
})
