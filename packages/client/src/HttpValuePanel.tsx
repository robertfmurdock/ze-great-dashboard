import type { Panel } from '@ze-great-dashboard/shared'
import { type Envelope, httpValueSchema } from '@ze-great-dashboard/shared'
import { ObservedAt } from './ObservedAt.tsx'
import { PanelFrame } from './PanelFrame.tsx'

export function HttpValuePanel({
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
  const signal = httpValueSchema.safeParse(envelope.signal)
  if (!signal.success)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <p className="panel__status">⚠ Invalid value</p>
        <ObservedAt value={envelope.observedAt} />
      </PanelFrame>
    )
  return (
    <PanelFrame panel={panel} envelope={envelope}>
      <p className="panel__status">{String(signal.data.value)}</p>
      <ObservedAt value={envelope.observedAt} />
    </PanelFrame>
  )
}
