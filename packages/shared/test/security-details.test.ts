import { mintTest } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect } from 'vitest'
import { securityDetailsResponseSchema } from '../src'

describe('safe security details', () => {
  mintTest('permits only the admitted-viewer policy projection', {
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
  })

  mintTest('rejects server-only policy values and raw claims', {
    setup: () => ({
      response: {
        oidc: true,
        policy: { mode: 'claim', claim: 'groups', match: 'any', values: ['viewers'] },
        claims: { groups: ['viewers'] },
      },
    }),
    exercise: ({ response }) => securityDetailsResponseSchema.safeParse(response),
    verify: (result) => expect(result.success).toBe(false),
  })
})
