import type { Envelope, PipelineStatus } from '@ze-great-dashboard/shared'
import { pipelineStatusSchema } from '@ze-great-dashboard/shared'
import type { AcceptedPipeline } from './panel-memory.ts'

export type PipelineDurationSample = {
  link: string | null
  sourceRunId?: string
  durationMs: number
  sourceUpdatedAt: string
}

export type PipelineReconciliation =
  | { kind: 'not-pipeline'; envelope: Envelope }
  | {
      kind: 'rejected'
      envelope: Extract<Envelope, { state: 'ok' }>
      signal: PipelineStatus & { sourceUpdatedAt: string }
    }
  | {
      kind: 'accepted'
      envelope: Envelope
      signal: PipelineStatus
      accepted?: AcceptedPipeline
      durationSample?: PipelineDurationSample
    }

export function reconcilePipelineResponse(args: {
  envelope: Envelope
  accepted?: AcceptedPipeline
  estimatedDurationMs?: number
}): PipelineReconciliation {
  const signal = pipelineStatus(args.envelope)
  if (!signal) return { kind: 'not-pipeline', envelope: args.envelope }
  if (
    args.accepted &&
    signal.sourceUpdatedAt &&
    Date.parse(signal.sourceUpdatedAt) < Date.parse(args.accepted.sourceUpdatedAt)
  ) {
    if (args.envelope.state !== 'ok' || !signal.sourceUpdatedAt)
      return { kind: 'not-pipeline', envelope: args.envelope }
    return {
      kind: 'rejected',
      envelope: args.envelope,
      signal: { ...signal, sourceUpdatedAt: signal.sourceUpdatedAt },
    }
  }

  const accepted = signal.sourceUpdatedAt
    ? { sourceUpdatedAt: signal.sourceUpdatedAt, status: signal.status, link: args.envelope.link }
    : undefined
  const durationSample =
    signal.status !== 'running' &&
    signal.durationMs !== undefined &&
    signal.sourceUpdatedAt &&
    Number.isFinite(Date.parse(signal.sourceUpdatedAt))
      ? {
          link: args.envelope.link,
          ...(signal.sourceRunId ? { sourceRunId: signal.sourceRunId } : {}),
          durationMs: signal.durationMs,
          sourceUpdatedAt: signal.sourceUpdatedAt,
        }
      : undefined
  const envelope =
    signal.status === 'running' &&
    args.estimatedDurationMs !== undefined &&
    args.envelope.state === 'ok'
      ? { ...args.envelope, signal: { ...signal, estimatedDurationMs: args.estimatedDurationMs } }
      : args.envelope
  return { kind: 'accepted', envelope, signal, accepted, durationSample }
}

export function pipelineStatus(envelope: Envelope): PipelineStatus | undefined {
  if (envelope.state !== 'ok') return undefined
  const result = pipelineStatusSchema.safeParse(envelope.signal)
  return result.success ? result.data : undefined
}
