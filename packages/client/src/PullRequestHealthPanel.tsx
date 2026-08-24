import { type Envelope, type Panel, pullRequestHealthSchema } from '@ze-great-dashboard/shared'
import { ObservedAt } from './ObservedAt.tsx'
import { PanelFrame } from './PanelFrame.tsx'

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
        <p className="panel__hint">Loading…</p>
      </PanelFrame>
    )
  if (envelope.state === 'error')
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <p className="panel__status">⚠ Unable to read</p>
        <p className="panel__hint">{envelope.error.message}</p>
        <ObservedAt value={envelope.observedAt} />
      </PanelFrame>
    )
  const signal = pullRequestHealthSchema.safeParse(envelope.signal)
  if (!signal.success)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <p className="panel__status">⚠ Invalid signal</p>
      </PanelFrame>
    )
  const presentation = statusPresentation(signal.data.status)
  return (
    <PanelFrame panel={panel} envelope={envelope}>
      <p className={`panel__status panel__status--${signal.data.status}`}>
        {presentation.glyph} {presentation.label}
      </p>
      <p className="panel__hint">{signal.data.summary}</p>
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
