import { z } from 'zod'

export const testHistorySampleSchema = z.object({
  id: z.string().min(1),
  attempt: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  total: z.number().int().nonnegative(),
})
export type TestHistorySample = z.infer<typeof testHistorySampleSchema>

/** A bounded inspection, not a claim that every run published a test summary. */
export const testHistorySchema = z.object({
  inspectedAt: z.iso.datetime(),
  inspectedRuns: z.number().int().min(0).max(8),
  complete: z.boolean(),
  samples: z.array(testHistorySampleSchema).max(8),
  retryAt: z.iso.datetime().optional(),
})
export type TestHistory = z.infer<typeof testHistorySchema>
export const testHistoryHeader = 'X-Dashboard-Test-History'

/** Retry-After is either seconds from receipt or an HTTP date. */
export function retryAfterTime(value: string | null, now: number): number | undefined {
  if (!value) return undefined
  const at = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value)
  return Number.isFinite(at) && at > now ? at : undefined
}
