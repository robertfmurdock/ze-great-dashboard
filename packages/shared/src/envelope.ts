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
  'no-runs',
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

/** Source-agnostic live work detail supplied by an adapter. */
export const pipelineActivitySchema = z.object({
  kind: z.enum(['job', 'stage', 'step']),
  name: z.string().min(1),
  parent: z.string().min(1).optional(),
})

export type PipelineActivity = z.infer<typeof pipelineActivitySchema>

/** The normalized vocabulary used by every CI adapter. */
export const pipelineStatusSchema = z.object({
  type: z.literal('pipeline-status'),
  status: z.enum(['passed', 'failed', 'warning', 'running', 'cancelled', 'unknown']),
  /** The source's unmodified status/result vocabulary, for an honest display. */
  rawStatus: z.string(),
  name: z.string().min(1),
  /** The branch represented by this status, when the upstream supplies or filters by one. */
  branch: z.string().min(1).optional(),
  /** Elapsed execution time, supplied only after the upstream run has completed. */
  durationMs: z.number().int().nonnegative().optional(),
  /** When an active run began, so the client can advance its elapsed display between polls. */
  runStartedAt: z.iso.datetime().optional(),
  /** Stable source-run identity, when the adapter provides one. */
  sourceRunId: z.string().min(1).optional(),
  /** Best-effort live work detail; adapters may describe a job, stage, or step. */
  activity: pipelineActivitySchema.optional(),
  /** Advisory duration from recent completed runs remembered by this browser. */
  estimatedDurationMs: z.number().int().positive().optional(),
  /** When this workflow run was last updated by its source, distinct from our observation time. */
  sourceUpdatedAt: z.iso.datetime().optional(),
})

export type PipelineStatus = z.infer<typeof pipelineStatusSchema>

/** Higher values need more immediate attention in a compact aggregate. */
const pipelineStatusPriorities: Record<PipelineStatus['status'], number> = {
  passed: 0,
  cancelled: 1,
  unknown: 2,
  running: 3,
  warning: 4,
  failed: 5,
}

export function pipelineStatusPriority(status: PipelineStatus['status']): number {
  return pipelineStatusPriorities[status]
}

export const pullRequestHealthItemSchema = z.object({
  label: z.string().min(1),
  status: pipelineStatusSchema.shape.status,
  detail: z.string().min(1),
  link: z.url().nullable(),
})

export const pullRequestHealthSchema = z.object({
  type: z.literal('pull-request-health'),
  status: pipelineStatusSchema.shape.status,
  summary: z.string().min(1),
  workflows: z.array(pullRequestHealthItemSchema),
  pullRequests: z.array(pullRequestHealthItemSchema),
  /** Missing component reads remain visible even when the evidence we did get is reassuring. */
  incompleteObservations: z
    .array(z.object({ label: z.string().min(1), message: z.string().min(1) }))
    .optional(),
  /** The latest component reading, disclosed beside the oldest aggregate evidence. */
  newestObservedAt: z.iso.datetime().optional(),
})

export type PullRequestHealth = z.infer<typeof pullRequestHealthSchema>

/** A public, credential-free candidate returned by the bounded update-PR observation. */
export const pullRequestCandidateSchema = z.object({
  number: z.number().int().positive(),
  branch: z.string().min(1),
  link: z.url(),
})

export type PullRequestCandidate = z.infer<typeof pullRequestCandidateSchema>

export const pullRequestCandidatesSchema = z.object({
  type: z.literal('pull-request-candidates'),
  pullRequests: z.array(pullRequestCandidateSchema),
  /** GitHub's first page is a deliberate bounded observation, not proof that no later PR exists. */
  truncated: z.boolean().optional(),
})

export type PullRequestCandidates = z.infer<typeof pullRequestCandidatesSchema>

export const pullRequestWorkflowObservationSchema = z.object({
  type: z.literal('pull-request-workflow'),
  workflow: z.string().min(1),
  item: pullRequestHealthItemSchema,
})

export type PullRequestWorkflowObservation = z.infer<typeof pullRequestWorkflowObservationSchema>

export const pullRequestBuildObservationSchema = z.object({
  type: z.literal('pull-request-build'),
  branch: z.string().min(1),
  item: pullRequestHealthItemSchema,
})

export type PullRequestBuildObservation = z.infer<typeof pullRequestBuildObservationSchema>

export const httpValueSchema = z.object({
  type: z.literal('http-value'),
  value: z.union([z.string(), z.number(), z.boolean()]),
})

export type HttpValue = z.infer<typeof httpValueSchema>
