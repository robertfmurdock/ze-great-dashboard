import { pullRequestHealthSchema } from '@ze-great-dashboard/shared'
import { PanelFrame, PanelHint, PanelStatus } from './PanelFrame.tsx'
import type { PanelProps } from './panel-props.ts'
import { CheckedAt } from './TimeAge.tsx'

export function PullRequestHealthPanel({ panel, envelope, checkedAt }: PanelProps) {
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
        {checkedAt && <CheckedAt value={checkedAt} />}
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
      {checkedAt && <CheckedAt value={checkedAt} />}
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
