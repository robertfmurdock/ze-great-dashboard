import {
  type Envelope,
  type PipelineStatus,
  type PollingSettings,
  pipelineStatusSchema,
} from '@ze-great-dashboard/shared'

/** Ephemeral scheduling state; polling owns it and views may project it. */
export type PollingScheduleSnapshot = {
  panelId: string
  label: string
  settings: PollingSettings
  cadence: PollingCadence
  inFlight: boolean
  lastRequestStartedAt?: string
  nextDueAt?: string
  /** Paths known before this cycle; dynamic fan-out is disclosed only once observed. */
  knownPaths: string[]
}

/** Return the next delay for a panel, keeping active runs responsive without polling forever at burst speed. */
export function nextPollDelayMillis(
  envelope: Envelope | undefined,
  nowMillis: number,
  settings: PollingSettings,
): number {
  return resolveNextPoll(envelope, nowMillis, settings).delayMillis
}

export type PollingCadence = 'normal' | 'running' | 'completion-window'

/** The scheduler and activity view share this resolved cadence; neither infers it from history. */
export function resolveNextPoll(
  envelope: Envelope | undefined,
  nowMillis: number,
  settings: PollingSettings,
): { delayMillis: number; cadence: PollingCadence } {
  const pipeline = runningPipeline(envelope)
  if (!pipeline) return { delayMillis: settings.refreshMillis, cadence: 'normal' }

  const completionAt = estimatedCompletionAt(pipeline)
  if (completionAt === undefined)
    return { delayMillis: settings.runningRefreshMillis, cadence: 'running' }

  if (nowMillis < completionAt) {
    return {
      delayMillis: Math.min(settings.runningRefreshMillis, completionAt - nowMillis),
      cadence: 'running',
    }
  }
  if (nowMillis < completionAt + settings.runningCompletionWindowMillis) {
    return { delayMillis: settings.runningCompletionRefreshMillis, cadence: 'completion-window' }
  }
  return { delayMillis: settings.runningRefreshMillis, cadence: 'running' }
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
