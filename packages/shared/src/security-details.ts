import { z } from 'zod'

/** Browser-safe OIDC policy metadata for an identity the server has already admitted. */
export const securityDetailsResponseSchema = z.strictObject({
  oidc: z.literal(true),
  policy: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('authenticated') }),
    z.strictObject({ mode: z.literal('subjects') }),
    z.strictObject({
      mode: z.literal('claim'),
      claim: z.string().min(1),
      match: z.enum(['any', 'all']),
    }),
  ]),
})

export type SecurityDetailsResponse = z.infer<typeof securityDetailsResponseSchema>
