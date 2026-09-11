import {
  type Board,
  type Envelope,
  httpValueSchema,
  pipelineStatusSchema,
  pullRequestHealthSchema,
} from '@ze-great-dashboard/shared/browser'
import type { HttpValueFactObservation, PanelUpdateHealth } from './panel-props.ts'

export type AttentionDriver = {
  panelId: string
  label: string
  reason: string
  factId?: string
}

/**
 * Projects only public, already-rendered evidence into the board's opt-in attention rail.
 * It intentionally never infers a source condition from loading, warning, or unknown states.
 */
export function projectAttention(args: {
  board: Board | undefined
  signals: Record<string, Envelope | undefined>
  updateHealth: Record<string, PanelUpdateHealth | undefined>
  factSignals: Record<string, Record<string, HttpValueFactObservation | undefined> | undefined>
}): AttentionDriver[] {
  if (!args.board?.attention) return []
  return args.board.panels.flatMap((panel) => {
    if (!panel.attention) return []
    const label = panel.label ?? panel.id
    if (panel.type === 'http-value' && panel.facts)
      return panel.facts.flatMap((fact) => {
        const observation = args.factSignals[panel.id]?.[fact.id]
        const reason = unreadableFactReason(observation)
        return reason
          ? [{ panelId: panel.id, label, reason: `${fact.label}: ${reason}`, factId: fact.id }]
          : []
      })
    const reason = unreadablePanelReason(
      panel.type,
      args.signals[panel.id],
      args.updateHealth[panel.id],
    )
    return reason ? [{ panelId: panel.id, label, reason }] : []
  })
}

function unreadableFactReason(observation: HttpValueFactObservation | undefined) {
  if (observation?.failure) return `Updates unavailable — ${observation.failure}`
  if (observation?.updateHealth) return `Updates unavailable — ${observation.updateHealth.message}`
  if (!observation?.envelope) return undefined
  if (observation.envelope.state === 'error') return observation.envelope.error.message
  return httpValueSchema.safeParse(observation.envelope.signal).success
    ? undefined
    : 'Invalid value'
}

function unreadablePanelReason(
  type: string,
  envelope: Envelope | undefined,
  updateHealth: PanelUpdateHealth | undefined,
) {
  if (updateHealth) return `Updates unavailable — ${updateHealth.message}`
  if (!envelope) return undefined
  if (envelope.state === 'error') return envelope.error.message
  if (type === 'pipeline-status') {
    const signal = pipelineStatusSchema.safeParse(envelope.signal)
    if (!signal.success) return 'Invalid signal'
    return signal.data.status === 'failed' ? 'Pipeline failed' : undefined
  }
  if (type === 'pull-request-health') {
    const signal = pullRequestHealthSchema.safeParse(envelope.signal)
    if (!signal.success) return 'Invalid signal'
    if (signal.data.status === 'failed') return signal.data.summary
    const missing = signal.data.incompleteObservations?.[0]
    return missing ? `${missing.label}: ${missing.message}` : undefined
  }
  if (type === 'http-value')
    return httpValueSchema.safeParse(envelope.signal).success ? undefined : 'Invalid value'
  return undefined
}
