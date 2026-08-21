import { type Envelope, type Panel, pipelineStatusSchema } from '@ze-great-dashboard/shared'
import type { RenderedPanelDiagnostic } from './diagnostics.ts'

/**
 * The compact public fact a viewer saw. Keep new panel projections here beside their
 * presentation boundary; this is intentionally not a source or server event contract.
 */
export function projectPanelDiagnostic(panel: Panel, envelope: Envelope): RenderedPanelDiagnostic {
  if (envelope.state === 'error') return { state: envelope.state, link: envelope.link }

  if (panel.type === 'pipeline-status') {
    const signal = pipelineStatusSchema.safeParse(envelope.signal)
    return {
      state: envelope.state,
      status: signal.success ? signal.data.status : undefined,
      link: envelope.link,
    }
  }

  return { state: envelope.state, link: envelope.link }
}

export function panelDiagnosticChanged(
  previous: Envelope | undefined,
  panel: Panel,
  next: Envelope,
) {
  if (!previous) return true
  const before = projectPanelDiagnostic(panel, previous)
  const after = projectPanelDiagnostic(panel, next)
  return (
    before.state !== after.state || before.status !== after.status || before.link !== after.link
  )
}
