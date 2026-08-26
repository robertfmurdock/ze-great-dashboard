import { type Envelope, type Panel, pullRequestHealthSchema } from '@ze-great-dashboard/shared'
import { ObservedAt } from './ObservedAt.tsx'
import { PanelFrame, PanelHint, PanelStatus } from './PanelFrame.tsx'

export function PullRequestHealthPanel({
  panel,
  envelope,
}: {
  panel: Panel
  envelope: Envelope | undefined
}) {
  if (!envelope)
    return (
      <PanelFrame panel={panel}>
        <PanelHint>Loading…</PanelHint>
      </PanelFrame>
    )
  if (envelope.state === 'error')
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <PanelStatus>⚠ Unable to read</PanelStatus>
        <PanelHint>{envelope.error.message}</PanelHint>
        <ObservedAt value={envelope.observedAt} />
      </PanelFrame>
    )
  const signal = pullRequestHealthSchema.safeParse(envelope.signal)
  if (!signal.success)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <PanelStatus>⚠ Invalid signal</PanelStatus>
      </PanelFrame>
    )
  const presentation = statusPresentation(signal.data.status)
  return (
    <PanelFrame panel={panel} envelope={envelope}>
      <PanelStatus status={signal.data.status}>
        {presentation.glyph} {presentation.label}
      </PanelStatus>
      <PanelHint>{signal.data.summary}</PanelHint>
      <ObservedAt value={envelope.observedAt} />
    </PanelFrame>
  )
}

function statusPresentation(status: 'passed' | 'failed' | 'running' | 'cancelled' | 'unknown') {
  switch (status) {
    case 'passed':
      return { glyph: '✓', label: 'Healthy' }
    case 'failed':
      return { glyph: '✕', label: 'Failed' }
    case 'running':
      return { glyph: '↻', label: 'Running' }
    case 'cancelled':
      return { glyph: '⊘', label: 'Cancelled' }
    case 'unknown':
      return { glyph: '?', label: 'Unknown' }
  }
}
