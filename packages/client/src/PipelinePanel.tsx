import {
  type Envelope,
  envelopeSchema,
  type Panel,
  pipelineStatusSchema,
} from '@ze-great-dashboard/shared'
import { ObservedAt } from './ObservedAt.tsx'
import { panelLayout } from './panel-layout.ts'

export function PipelinePanel({ panel, data }: { panel: Panel; data: Envelope | undefined }) {
  if (!data)
    return (
      <section className="panel" style={panelLayout(panel)} aria-busy="true">
        <h2 className="panel__label">{panel.id}</h2>
        <p className="panel__hint">Loading…</p>
      </section>
    )
  if (data.state === 'error') {
    return (
      <section className="panel panel--error" style={panelLayout(panel)}>
        <h2 className="panel__label">{panel.id}</h2>
        <p className="panel__status">
          ⚠ {data.error.kind === 'no-runs' ? 'No workflow runs' : 'Unable to read'}
        </p>
        <p className="panel__hint">{data.error.message}</p>
        <ObservedAt value={data.observedAt} />
      </section>
    )
  }

  const signal = pipelineStatusSchema.safeParse(data.signal)
  if (!signal.success)
    return (
      <section className="panel panel--error" style={panelLayout(panel)}>
        <h2 className="panel__label">{panel.id}</h2>
        <p className="panel__status">⚠ Invalid signal</p>
        <ObservedAt value={data.observedAt} />
      </section>
    )
  const presentation = statusPresentation(signal.data.status)
  const content = (
    <>
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
      <ObservedAt value={data.observedAt} />
    </>
  )
  return (
    <section className="panel" style={panelLayout(panel)}>
      <h2 className="panel__label">{panel.id}</h2>
      {data.link ? (
        <a className="panel__link" href={data.link}>
          {content}
        </a>
      ) : (
        content
      )}
    </section>
  )
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

export function parseEnvelope(value: unknown): Envelope | undefined {
  const result = envelopeSchema.safeParse(value)
  return result.success ? result.data : undefined
}
