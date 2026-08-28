import { httpValueSchema } from '@ze-great-dashboard/shared'
import styles from './HttpValuePanel.module.css'
import { PanelFrame, PanelHint, PanelStatus } from './PanelFrame.tsx'
import type { PanelProps } from './panel-props.ts'
import { CheckedAt } from './TimeAge.tsx'

export function HttpValuePanel({ panel, envelope, checkedAt }: PanelProps) {
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
  const signal = httpValueSchema.safeParse(envelope.signal)
  if (!signal.success)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <PanelStatus>⚠ Invalid value</PanelStatus>
        {checkedAt && <CheckedAt value={checkedAt} />}
      </PanelFrame>
    )
  return (
    <PanelFrame panel={panel} envelope={envelope}>
      <div className={styles.fact}>
        <PanelStatus>{String(signal.data.value)}</PanelStatus>
        {checkedAt && <CheckedAt value={checkedAt} />}
      </div>
    </PanelFrame>
  )
}
