import { z } from 'zod'

/**
 * The signal envelope.
 *
 * Three things are true of every panel regardless of what signal it shows: could the reading be
 * taken, when was it observed, and where is the authority. Those live here rather than in each
 * signal payload so that no adapter can forget them — the age disclosure and the error state are
 * both universal requirements of an honest radiator.
 *
 * `signal` is deliberately unconstrained: adding a signal type means adding a payload shape,
 * not touching the envelope.
 */

/**
 * A small closed set, because each wants a different visual treatment. The free-text `message`
 * is for humans to read, never for code to branch on.
 */
export const errorKindSchema = z.enum([
  'unreachable',
  'unauthorized',
  'not-found',
  'upstream-error',
])

export type ErrorKind = z.infer<typeof errorKindSchema>

export const envelopeErrorSchema = z.object({
  kind: errorKindSchema,
  message: z.string(),
})

export const envelopeSchema = z.discriminatedUnion('state', [
  z.object({
    panelId: z.string().min(1),
    state: z.literal('ok'),
    /** From the upstream response `Date`. A cached value must never be shown without its age. */
    observedAt: z.iso.datetime(),
    /** Adapter-derived. The authority for this panel; the dashboard itself asserts nothing. */
    link: z.url().nullable(),
    signal: z.unknown(),
  }),
  z.object({
    panelId: z.string().min(1),
    state: z.literal('error'),
    /**
     * Populated even on error: knowing *when* a failure was observed is the difference between
     * "broken just now" and "broken all morning", and a panel that can't reach its source is
     * exactly when a viewer most wants to click through.
     */
    observedAt: z.iso.datetime(),
    link: z.url().nullable(),
    error: envelopeErrorSchema,
  }),
])

export type Envelope = z.infer<typeof envelopeSchema>
export type OkEnvelope = Extract<Envelope, { state: 'ok' }>
export type ErrorEnvelope = Extract<Envelope, { state: 'error' }>

/** The normalized vocabulary used by every CI adapter. */
export const pipelineStatusSchema = z.object({
  type: z.literal('pipeline-status'),
  status: z.enum(['passed', 'failed', 'running', 'cancelled', 'unknown']),
  /** The source's unmodified status/result vocabulary, for an honest display. */
  rawStatus: z.string(),
  name: z.string().min(1),
})

export type PipelineStatus = z.infer<typeof pipelineStatusSchema>
