import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { securityDetailsResponseSchema } from '../src'

describe('safe security details', () => {
  test(
    'permits only the admitted-viewer policy projection',
    mint({
      setup: () => ({
        response: {
          oidc: true,
          policy: { mode: 'claim', claim: 'groups', match: 'all' },
        },
      }),
      exercise: ({ response }) => securityDetailsResponseSchema.parse(response),
      verify: (result) => {
        expect(result).toEqual({
          oidc: true,
          policy: { mode: 'claim', claim: 'groups', match: 'all' },
        })
      },
    }),
  )

  test(
    'rejects server-only policy values and raw claims',
    mint({
      setup: () => ({
        response: {
          oidc: true,
          policy: { mode: 'claim', claim: 'groups', match: 'any', values: ['viewers'] },
          claims: { groups: ['viewers'] },
        },
      }),
      exercise: ({ response }) => securityDetailsResponseSchema.safeParse(response),
      verify: (result) => expect(result.success).toBe(false),
    }),
  )
})
