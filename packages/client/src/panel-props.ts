import type { Envelope, Panel } from '@ze-great-dashboard/shared'

/** Client-only evidence that the dashboard has missed scheduled updates for a panel. */
export type PanelUpdateHealth = {
  consecutiveFailures: number
  message: string
  lastConfirmedAt: string
}

/** Independent source evidence displayed together by a grouped http-value panel. */
export type HttpValueFactObservation = {
  envelope?: Envelope
  /** A browser/proxy transport failure that could not produce an envelope. */
  failure?: string
  updateHealth?: PanelUpdateHealth
}

export type PanelProps = {
  panel: Panel
  envelope: Envelope | undefined
  updateHealth?: PanelUpdateHealth
  facts?: Record<string, HttpValueFactObservation | undefined>
}
