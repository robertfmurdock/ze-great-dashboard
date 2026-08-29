import { pullRequestHealthSchema } from '@ze-great-dashboard/shared'
import { errorPresentation } from './error-presentation.ts'
import { PanelFrame, PanelHint, PanelStatus } from './PanelFrame.tsx'
import styles from './PullRequestHealthPanel.module.css'
import type { PanelProps } from './panel-props.ts'
import { statusPresentation } from './panel-status.ts'
import { compactPullRequestHealthFacts } from './pull-request-health.ts'
import { ObservedAt, UpdateHealth } from './TimeAge.tsx'

export function PullRequestHealthPanel({ panel, envelope, updateHealth }: PanelProps) {
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
  const signal = pullRequestHealthSchema.safeParse(envelope.signal)
  if (!signal.success)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <PanelStatus>⚠ Invalid signal</PanelStatus>
      </PanelFrame>
    )
  const presentation = statusPresentation(signal.data.status, 'Healthy')
  const compactFacts = compactPullRequestHealthFacts(signal.data)
  return (
    <PanelFrame panel={panel} envelope={envelope}>
      <PanelStatus status={signal.data.status}>
        {presentation.glyph} {presentation.label}
      </PanelStatus>
      <PanelHint className={styles.fullSummary} title={signal.data.summary}>
        {signal.data.summary}
      </PanelHint>
      <div className={styles.compactFacts} title={compactFacts.title} data-compact-facts>
        <p
          className={`${styles.compactFact} ${styles.compactPrimary}`}
          title={compactFacts.primaryDetail}
        >
          {compactFacts.primary}
        </p>
        <p className={`${styles.compactFact} ${styles.compactSecondary}`}>
          {compactFacts.secondary}
        </p>
      </div>
      <ObservedAt value={envelope.observedAt} />
      {updateHealth && <UpdateHealth health={updateHealth} />}
    </PanelFrame>
  )
}
