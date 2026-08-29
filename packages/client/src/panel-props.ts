import type { Envelope, Panel } from '@ze-great-dashboard/shared'

/** Client-only evidence that the dashboard has missed scheduled updates for a panel. */
export type PanelUpdateHealth = {
  consecutiveFailures: number
  message: string
  lastConfirmedAt: string
}

export type PanelProps = {
  panel: Panel
  envelope: Envelope | undefined
  updateHealth?: PanelUpdateHealth
}
