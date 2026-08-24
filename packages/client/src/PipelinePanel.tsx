import { type Envelope, type Panel, pipelineStatusSchema } from '@ze-great-dashboard/shared'
import { ObservedAt } from './ObservedAt.tsx'
import { PanelFrame } from './PanelFrame.tsx'

export function PipelinePanel({
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
  if (envelope.state === 'error') {
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <p className="panel__status">
          ⚠ {envelope.error.kind === 'no-runs' ? 'No workflow runs' : 'Unable to read'}
        </p>
        <p className="panel__hint">{envelope.error.message}</p>
        <ObservedAt value={envelope.observedAt} />
      </PanelFrame>
    )
  }

  const signal = pipelineStatusSchema.safeParse(envelope.signal)
  if (!signal.success)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <p className="panel__status">⚠ Invalid signal</p>
        <ObservedAt value={envelope.observedAt} />
      </PanelFrame>
    )
  const presentation = statusPresentation(signal.data.status)
  return (
    <PanelFrame panel={panel} envelope={envelope}>
      <p className={`panel__status panel__status--${signal.data.status}`}>
        {presentation.glyph} {presentation.label}
      </p>
      <p className="panel__hint">
        {signal.data.name} · {signal.data.rawStatus}
        {signal.data.branch && (
          <span className="panel__branch" title={`Branch: ${signal.data.branch}`}>
            <span aria-hidden="true"> · ⎇ </span>
            <span className="screen-reader-only">Branch: </span>
            {signal.data.branch}
          </span>
        )}
      </p>
      {signal.data.status !== 'running' && signal.data.durationMs !== undefined && (
        <p className="panel__hint">Took {formatDuration(signal.data.durationMs)}</p>
      )}
      {signal.data.sourceUpdatedAt && (
        <ObservedAt value={signal.data.sourceUpdatedAt} label="Run updated" />
      )}
      <ObservedAt value={envelope.observedAt} />
    </PanelFrame>
  )
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function statusPresentation(status: 'passed' | 'failed' | 'running' | 'cancelled' | 'unknown') {
  switch (status) {
    case 'passed':
      return { glyph: '✓', label: 'Passed' }
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
