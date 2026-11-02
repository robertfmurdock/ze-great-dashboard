import type { Envelope, Panel } from '@ze-great-dashboard/shared/browser'
import type { RenderedPanelDiagnostic } from './diagnostics.ts'
import type { HttpValueFactObservation } from './panel-props.ts'
import { panelFeature } from './panel-registry.tsx'

/**
 * The compact public fact a viewer saw. Keep new panel projections here beside their
 * presentation boundary; this is intentionally not a source or server event contract.
 */
export function projectPanelDiagnostic(panel: Panel, envelope: Envelope): RenderedPanelDiagnostic {
  return (
    panelFeature(panel.type)?.projectDiagnostic(envelope) ?? {
      state: envelope.state,
      link: envelope.link,
    }
  )
}

export function panelDiagnosticChanged(
  previous: Envelope | undefined,
  panel: Panel,
  next: Envelope,
) {
  if (!previous) return true
  const before = projectPanelDiagnostic(panel, previous)
  const after = projectPanelDiagnostic(panel, next)
  return JSON.stringify(before) !== JSON.stringify(after)
}

/** Public evidence for a visual group whose sources were observed independently. */
export function projectHttpValueFactsDiagnostic(
  facts: Record<string, HttpValueFactObservation | undefined>,
): RenderedPanelDiagnostic {
  const projected = Object.entries(facts).map(([id, observation]) => {
    if (!observation?.envelope) return { id, state: 'unavailable' as const, link: null }
    return { id, state: observation.envelope.state, link: observation.envelope.link }
  })
  return {
    state: projected.some((fact) => fact.state === 'ok') ? 'ok' : 'error',
    link: null,
    facts: projected,
  }
}

export function httpValueFactsDiagnosticChanged(
  previous: Record<string, HttpValueFactObservation | undefined> | undefined,
  next: Record<string, HttpValueFactObservation | undefined>,
) {
  return (
    JSON.stringify(previous && projectHttpValueFactsDiagnostic(previous)) !==
    JSON.stringify(projectHttpValueFactsDiagnostic(next))
  )
}
