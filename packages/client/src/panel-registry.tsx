import { HttpValuePanel } from './HttpValuePanel.tsx'
import { PanelPlaceholder } from './PanelPlaceholder.tsx'
import { PipelineAnimationDemoPanel } from './PipelineAnimationDemoPanel.tsx'
import { PipelinePanel, projectPipelineDiagnostic } from './PipelinePanel.tsx'
import { PullRequestHealthPanel, projectPullRequestDiagnostic } from './PullRequestHealthPanel.tsx'
import type { PanelFeature } from './panel-feature.ts'
import type { PanelProps } from './panel-props.ts'
import { projectTestCountDiagnostic, TestCountPanel } from './TestCountPanel.tsx'
import { readUpdateWorkflows } from './update-workflows.ts'

type PanelRendererProps = PanelProps

const singlePolling = {
  kind: 'single',
  initialPaths: (_panel, root) => [root],
} satisfies PanelFeature['polling']
const basicDiagnostic: PanelFeature['projectDiagnostic'] = (envelope) => ({
  state: envelope.state,
  link: envelope.link,
})

/** Exhaustive feature contracts: a renderer cannot be registered without polling and diagnostics. */
export const panelFeatures = {
  'pipeline-status': {
    testHistory: true,
    symbol: { glyph: '▣', label: 'Pipeline status' },
    Renderer: PipelinePanel,
    polling: singlePolling,
    projectDiagnostic: projectPipelineDiagnostic,
  },
  'pull-request-health': {
    symbol: { glyph: '⌘', label: 'Pull request health' },
    Renderer: PullRequestHealthPanel,
    polling: {
      kind: 'pull-request-health',
      initialPaths: (panel, root) => [
        `${root}/pull-requests`,
        ...readUpdateWorkflows(panel).map(
          ({ workflow }) => `${root}/update-workflow/${encodeURIComponent(workflow)}`,
        ),
      ],
    },
    projectDiagnostic: projectPullRequestDiagnostic,
  },
  'http-value': {
    symbol: { glyph: '◌', label: 'HTTP value' },
    Renderer: HttpValuePanel,
    polling: {
      kind: 'facts',
      initialPaths: (panel, root) =>
        panel.facts
          ? panel.facts.map((fact) => `${root}/facts/${encodeURIComponent(fact.id)}`)
          : [root],
    },
    projectDiagnostic: basicDiagnostic,
  },
  'test-count': {
    testHistory: true,
    symbol: { glyph: '≡', label: 'Test count' },
    Renderer: TestCountPanel,
    polling: singlePolling,
    projectDiagnostic: projectTestCountDiagnostic,
  },
  'pipeline-animation-demo': {
    symbol: { glyph: '✦', label: 'Pipeline animation demo' },
    Renderer: PipelineAnimationDemoPanel,
    polling: { kind: 'local' },
    projectDiagnostic: basicDiagnostic,
  },
} satisfies Record<string, PanelFeature>

export type RenderablePanelType = keyof typeof panelFeatures

const featuresByType = new Map<string, PanelFeature>(Object.entries(panelFeatures))
export function panelFeature(type: string) {
  return featuresByType.get(type)
}

export function PanelRenderer({
  panel,
  envelope,
  attentionActive,
  updateHealth,
  rejectedPipeline,
  facts,
  testDirection,
}: PanelRendererProps) {
  const Renderer = panelFeature(panel.type)?.Renderer
  return Renderer ? (
    <Renderer
      panel={panel}
      envelope={envelope}
      attentionActive={attentionActive}
      updateHealth={updateHealth}
      rejectedPipeline={rejectedPipeline}
      facts={facts}
      testDirection={testDirection}
    />
  ) : (
    <PanelPlaceholder label={panel.type} hint="Not wired yet" wide />
  )
}
