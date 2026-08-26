import type { Panel } from '@ze-great-dashboard/shared'
import { type Envelope, httpValueSchema } from '@ze-great-dashboard/shared'
import styles from './HttpValuePanel.module.css'
import { ObservedAt } from './ObservedAt.tsx'
import { PanelFrame, PanelHint, PanelStatus } from './PanelFrame.tsx'

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
  const signal = httpValueSchema.safeParse(envelope.signal)
  if (!signal.success)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <PanelStatus>⚠ Invalid value</PanelStatus>
        <ObservedAt value={envelope.observedAt} />
      </PanelFrame>
    )
  return (
    <PanelFrame panel={panel} envelope={envelope}>
      <div className={styles.fact}>
        <PanelStatus>{String(signal.data.value)}</PanelStatus>
        <ObservedAt value={envelope.observedAt} />
      </div>
    </PanelFrame>
  )
}
