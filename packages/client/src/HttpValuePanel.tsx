import type { Panel } from '@ze-great-dashboard/shared'
import { type Envelope, httpValueSchema } from '@ze-great-dashboard/shared'
import { ObservedAt } from './ObservedAt.tsx'
import { panelLayout } from './panel-layout.ts'

export function HttpValuePanel({ panel, data }: { panel: Panel; data: Envelope | undefined }) {
  if (!data)
    return (
      <section className="panel" style={panelLayout(panel)} aria-busy="true">
        <h2 className="panel__label">{panel.id}</h2>
        <p className="panel__hint">Loading…</p>
      </section>
    )
  if (data.state === 'error')
    return (
      <section className="panel panel--error" style={panelLayout(panel)}>
        <h2 className="panel__label">{panel.id}</h2>
        <p className="panel__status">⚠ Unable to read</p>
        <p className="panel__hint">{data.error.message}</p>
        <ObservedAt value={data.observedAt} />
      </section>
    )
  const signal = httpValueSchema.safeParse(data.signal)
  if (!signal.success)
    return (
      <section className="panel panel--error" style={panelLayout(panel)}>
        <h2 className="panel__label">{panel.id}</h2>
        <p className="panel__status">⚠ Invalid value</p>
        <ObservedAt value={data.observedAt} />
      </section>
    )
  const content = (
    <>
      <p className="panel__status">{String(signal.data.value)}</p>
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
