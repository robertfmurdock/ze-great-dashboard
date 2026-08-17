import { z } from 'zod'

/**
 * Durations are written the way a board author would write them: `30s`, `5m`, `1h`.
 * Parsing them here rather than at each use site means a bad value fails config
 * validation at boot instead of silently becoming NaN in a polling loop.
 */
const DURATION_PATTERN = /^(\d+)(ms|s|m|h)$/

const UNIT_MILLIS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
} as const

export function parseDuration(value: string): number | null {
  const match = DURATION_PATTERN.exec(value)
  if (!match) return null

  const [, rawAmount, rawUnit] = match
  // The pattern guarantees both groups, but noUncheckedIndexedAccess doesn't know that.
  if (rawAmount === undefined || rawUnit === undefined) return null

  const amount = Number(rawAmount)
  if (amount <= 0) return null

  return amount * UNIT_MILLIS[rawUnit as keyof typeof UNIT_MILLIS]
}

export const durationSchema = z
  .string()
  .refine((value) => parseDuration(value) !== null, {
    message: 'must be a positive duration like "30s", "5m", or "1h"',
  })
  .brand<'Duration'>()

export type Duration = z.infer<typeof durationSchema>
