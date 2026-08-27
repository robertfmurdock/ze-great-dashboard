import {
  type Envelope,
  type PipelineStatus,
  type PollingSettings,
  pipelineStatusSchema,
} from '@ze-great-dashboard/shared'

/** Return the next delay for a panel, keeping active runs responsive without polling forever at burst speed. */
export function nextPollDelayMillis(
  envelope: Envelope | undefined,
  nowMillis: number,
  settings: PollingSettings,
): number {
  const pipeline = runningPipeline(envelope)
  if (!pipeline) return settings.refreshMillis

  const completionAt = estimatedCompletionAt(pipeline)
  if (completionAt === undefined) return settings.runningRefreshMillis

  if (nowMillis < completionAt) {
    return Math.min(settings.runningRefreshMillis, completionAt - nowMillis)
  }
  if (nowMillis < completionAt + settings.runningCompletionWindowMillis) {
    return settings.runningCompletionRefreshMillis
  }
  return settings.runningRefreshMillis
}

function runningPipeline(envelope: Envelope | undefined): PipelineStatus | undefined {
  if (envelope?.state !== 'ok') return undefined
  const result = pipelineStatusSchema.safeParse(envelope.signal)
  return result.success && result.data.status === 'running' ? result.data : undefined
}

function estimatedCompletionAt(signal: PipelineStatus): number | undefined {
  if (!signal.runStartedAt || signal.estimatedDurationMs === undefined) return undefined
  const startedAt = Date.parse(signal.runStartedAt)
  return Number.isFinite(startedAt) ? startedAt + signal.estimatedDurationMs : undefined
}
