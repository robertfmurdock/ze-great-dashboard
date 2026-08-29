import { httpValueSchema } from '@ze-great-dashboard/shared'
import { errorPresentation } from './error-presentation.ts'
import styles from './HttpValuePanel.module.css'
import { PanelFrame, PanelHint, PanelStatus } from './PanelFrame.tsx'
import type { PanelProps } from './panel-props.ts'
import { ObservedAt, UpdateHealth } from './TimeAge.tsx'

export function HttpValuePanel({ panel, envelope, updateHealth }: PanelProps) {
  if (!envelope)
    return (
      <PanelFrame panel={panel}>
        <PanelHint>Loading…</PanelHint>
      </PanelFrame>
    )
  if (envelope.state === 'error') {
    const presentation = errorPresentation(envelope.error.kind)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <PanelStatus emphasis={presentation.emphasis}>⚠ {presentation.label}</PanelStatus>
        <PanelHint>{envelope.error.message}</PanelHint>
      </PanelFrame>
    )
  }
  const signal = httpValueSchema.safeParse(envelope.signal)
  if (!signal.success)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <PanelStatus>⚠ Invalid value</PanelStatus>
      </PanelFrame>
    )
  return (
    <PanelFrame panel={panel} envelope={envelope}>
      <div className={styles.fact}>
        <PanelStatus>{String(signal.data.value)}</PanelStatus>
        <ObservedAt value={envelope.observedAt} />
        {updateHealth && <UpdateHealth health={updateHealth} />}
      </div>
    </PanelFrame>
  )
}
