import type { ComponentType } from 'react'
import { HttpValuePanel } from './HttpValuePanel.tsx'
import { PanelPlaceholder } from './PanelPlaceholder.tsx'
import { PipelineAnimationDemoPanel } from './PipelineAnimationDemoPanel.tsx'
import { PipelinePanel } from './PipelinePanel.tsx'
import { PullRequestHealthPanel } from './PullRequestHealthPanel.tsx'
import type { PanelProps } from './panel-props.ts'
import type { RenderablePanelType } from './panel-symbols.ts'

type PanelRendererProps = PanelProps

/** The one client-side dispatch point for panel types. */
export const panelRenderers: Record<RenderablePanelType, ComponentType<PanelRendererProps>> = {
  'pipeline-status': PipelinePanel,
  'pull-request-health': PullRequestHealthPanel,
  'http-value': HttpValuePanel,
  'pipeline-animation-demo': PipelineAnimationDemoPanel,
}

export function PanelRenderer({ panel, envelope, updateHealth, facts }: PanelRendererProps) {
  const Renderer = panelRenderers[panel.type as RenderablePanelType]
  return Renderer ? (
    <Renderer panel={panel} envelope={envelope} updateHealth={updateHealth} facts={facts} />
  ) : (
    <PanelPlaceholder label={panel.type} hint="Not wired yet" wide />
  )
}
