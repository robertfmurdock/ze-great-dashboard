import { describe, expect, it } from 'vitest'
import { securityDetailsResponseSchema } from '../src/security-details.ts'

describe('safe security details', () => {
  it('permits only the admitted-viewer policy projection', () => {
    expect(
      securityDetailsResponseSchema.parse({
        oidc: true,
        policy: { mode: 'claim', claim: 'groups', match: 'all' },
      }),
    ).toEqual({ oidc: true, policy: { mode: 'claim', claim: 'groups', match: 'all' } })
  })

  it('rejects server-only policy values and raw claims', () => {
    expect(
      securityDetailsResponseSchema.safeParse({
        oidc: true,
        policy: { mode: 'claim', claim: 'groups', match: 'any', values: ['viewers'] },
        claims: { groups: ['viewers'] },
      }).success,
    ).toBe(false)
  })
})
