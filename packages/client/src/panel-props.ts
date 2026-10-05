import type { Envelope, Panel, PipelineStatus } from '@ze-great-dashboard/shared/browser'

/** Client-only evidence that the dashboard has missed scheduled updates for a panel. */
export type PanelUpdateHealth = {
  consecutiveFailures: number
  message: string
  lastConfirmedAt: string
}

/**
 * Client-only evidence retained when a source response predates a pipeline result already
 * confirmed in browser memory. It is presentation evidence, not a replacement envelope.
 */
export type RejectedPipelinePresentation = {
  status: PipelineStatus['status']
  sourceUpdatedAt: string
  link: string | null
  github: boolean
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
  attentionActive?: boolean
  updateHealth?: PanelUpdateHealth
  rejectedPipeline?: RejectedPipelinePresentation
  facts?: Record<string, HttpValueFactObservation | undefined>
}
