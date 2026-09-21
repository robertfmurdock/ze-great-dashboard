import { describe, expect, it } from 'vitest'
import { consumeOidcTestBootstrap } from '../src/oidc-manager.ts'

describe('OIDC test bootstrap', () => {
  it('consumes a valid browser seed once and deletes its global boundary', () => {
    const source = {
      __DASHBOARD_OIDC_TEST_BOOTSTRAP__: {
        accessToken: 'test-token',
        expiresAt: 1_800_000_000,
        scope: 'openid profile read:dashboard',
        tokenType: 'Bearer',
      },
    } as unknown as Window

    expect(consumeOidcTestBootstrap(source)).toEqual({
      accessToken: 'test-token',
      expiresAt: 1_800_000_000,
      scope: 'openid profile read:dashboard',
      tokenType: 'Bearer',
    })
    expect(source.__DASHBOARD_OIDC_TEST_BOOTSTRAP__).toBeUndefined()
    expect(consumeOidcTestBootstrap(source)).toBeUndefined()
  })

  it('leaves normal authentication untouched when no bootstrap exists', () => {
    expect(consumeOidcTestBootstrap({} as Window)).toBeUndefined()
  })
})
