import type { Envelope, Panel } from '@ze-great-dashboard/shared/browser'
import type { ComponentType } from 'react'
import type { RenderedPanelDiagnostic } from './diagnostics.ts'
import type { PanelProps } from './panel-props.ts'

/** Every feature explicitly chooses how it obtains observations, including local-only features. */
type PollingPaths = { initialPaths: (panel: Panel, root: string) => string[] }
export type RemotePanelPolling = PollingPaths &
  ({ kind: 'single' } | { kind: 'facts' } | { kind: 'pull-request-health' })
export type PanelFeature = {
  /** This feature displays completed-run test totals and participates in local comparisons. */
  testHistory?: true
  symbol: { glyph: string; label: string }
  Renderer: ComponentType<PanelProps>
  polling: RemotePanelPolling | { kind: 'local' }
  projectDiagnostic: (envelope: Envelope) => RenderedPanelDiagnostic
}
