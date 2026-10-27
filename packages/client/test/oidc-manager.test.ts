import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { consumeOidcTestBootstrap } from '../src/oidc-manager.ts'

describe('OIDC test bootstrap', () => {
  test(
    'consumes a valid browser seed once and deletes its global boundary',
    mint({
      setup: () => {
        const bootstrap = {
          accessToken: 'test-token',
          expiresAt: 1_800_000_000,
          scope: 'openid profile read:dashboard',
          tokenType: 'Bearer',
        }
        const source = { __DASHBOARD_OIDC_TEST_BOOTSTRAP__: bootstrap } as unknown as Window

        return { bootstrap, source }
      },
      exercise: ({ source }) => ({
        first: consumeOidcTestBootstrap(source),
        second: consumeOidcTestBootstrap(source),
      }),
      verify: ({ first, second }, { bootstrap, source }) => {
        expect(first).toEqual(bootstrap)
        expect(source.__DASHBOARD_OIDC_TEST_BOOTSTRAP__).toBeUndefined()
        expect(second).toBeUndefined()
      },
    }),
  )

  test(
    'leaves normal authentication untouched when no bootstrap exists',
    mint({
      setup: () => ({ source: {} as Window }),
      exercise: ({ source }) => consumeOidcTestBootstrap(source),
      verify: (result) => expect(result).toBeUndefined(),
    }),
  )
})
