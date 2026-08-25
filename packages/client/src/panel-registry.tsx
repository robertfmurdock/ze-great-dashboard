import type { Envelope, Panel } from '@ze-great-dashboard/shared'
import type { ComponentType } from 'react'
import { HttpValuePanel } from './HttpValuePanel.tsx'
import { PanelPlaceholder } from './PanelPlaceholder.tsx'
import { PipelineAnimationDemoPanel } from './PipelineAnimationDemoPanel.tsx'
import { PipelinePanel } from './PipelinePanel.tsx'
import { PullRequestHealthPanel } from './PullRequestHealthPanel.tsx'

type PanelRendererProps = {
  panel: Panel
  envelope: Envelope | undefined
}

/** The one client-side dispatch point for panel types. */
export const panelRenderers: Record<string, ComponentType<PanelRendererProps>> = {
  'pipeline-status': PipelinePanel,
  'pull-request-health': PullRequestHealthPanel,
  'http-value': HttpValuePanel,
  'pipeline-animation-demo': PipelineAnimationDemoPanel,
}

export function PanelRenderer({ panel, envelope }: PanelRendererProps) {
  const Renderer = panelRenderers[panel.type]
  return Renderer ? (
    <Renderer panel={panel} envelope={envelope} />
  ) : (
    <PanelPlaceholder label={panel.type} hint="Not wired yet" wide />
  )
}
