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
    'rejects server-only policy values',
    mint({
      setup: () => ({
        response: {
          oidc: true,
          policy: { mode: 'claim', claim: 'groups', match: 'any', values: ['viewers'] },
        },
      }),
      exercise: ({ response }) => securityDetailsResponseSchema.safeParse(response),
      verify: (result) => {
        if (result.success) throw new Error('Expected server-only policy values to be rejected.')
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ['policy'], code: 'unrecognized_keys' }),
          ]),
        )
      },
    }),
  )

  test(
    'rejects raw claims from the browser-visible response',
    mint({
      setup: () => ({
        response: {
          oidc: true,
          policy: { mode: 'claim', claim: 'groups', match: 'any' },
          claims: { groups: ['viewers'] },
        },
      }),
      exercise: ({ response }) => securityDetailsResponseSchema.safeParse(response),
      verify: (result) => {
        if (result.success) throw new Error('Expected raw claims to be rejected.')
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: [], code: 'unrecognized_keys' }),
          ]),
        )
      },
    }),
  )
})
