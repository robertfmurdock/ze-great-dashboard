import { pullRequestHealthSchema } from '@ze-great-dashboard/shared'
import { PanelFrame, PanelHint, PanelStatus } from './PanelFrame.tsx'
import styles from './PullRequestHealthPanel.module.css'
import type { PanelProps } from './panel-props.ts'
import { statusPresentation } from './panel-status.ts'
import { compactPullRequestHealthFacts } from './pull-request-health.ts'
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
      {checkedAt && <CheckedAt value={checkedAt} />}
    </PanelFrame>
  )
}
