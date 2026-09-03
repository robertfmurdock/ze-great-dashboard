import { pullRequestHealthSchema } from '@ze-great-dashboard/shared'
import { errorPresentation } from './error-presentation.ts'
import { PanelEvidence, PanelFrame, PanelHint, PanelMetadata, PanelStatus } from './PanelFrame.tsx'
import styles from './PullRequestHealthPanel.module.css'
import type { PanelProps } from './panel-props.ts'
import { statusPresentation } from './panel-status.ts'
import { compactPullRequestHealthFacts } from './pull-request-health.ts'
import { ObservedAt, UpdateHealth } from './TimeAge.tsx'

export function PullRequestHealthPanel({ panel, envelope, updateHealth }: PanelProps) {
  if (!envelope)
    return (
      <PanelFrame panel={panel}>
        <PanelEvidence>
          <PanelHint>Loading…</PanelHint>
        </PanelEvidence>
      </PanelFrame>
    )
  if (envelope.state === 'error') {
    const presentation = errorPresentation(envelope.error.kind)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <PanelEvidence>
          <PanelStatus emphasis={presentation.emphasis}>⚠ {presentation.label}</PanelStatus>
          <PanelHint>{envelope.error.message}</PanelHint>
        </PanelEvidence>
      </PanelFrame>
    )
  }
  const signal = pullRequestHealthSchema.safeParse(envelope.signal)
  if (!signal.success)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <PanelEvidence>
          <PanelStatus>⚠ Invalid signal</PanelStatus>
        </PanelEvidence>
      </PanelFrame>
    )
  const presentation = statusPresentation(signal.data.status, 'Healthy')
  const compactFacts = compactPullRequestHealthFacts(signal.data)
  return (
    <PanelFrame panel={panel} envelope={envelope} layout="three-anchor">
      <div className={styles.statusAnchor} data-panel-anchor="status">
        <PanelStatus status={signal.data.status}>
          {presentation.glyph} {presentation.label}
        </PanelStatus>
      </div>
      <div className={styles.evidence} data-panel-anchor="evidence">
        <PanelHint className={styles.fullSummary} title={signal.data.summary}>
          {signal.data.summary}
        </PanelHint>
        <div className={styles.compactFacts} title={compactFacts.title} data-compact-facts>
          {compactFacts.primaryDetail && (
            <p className={styles.failedItem} title={compactFacts.primaryDetail}>
              <span aria-hidden="true">⚠</span>{' '}
              <span className="screen-reader-only">
                {compactFacts.primaryKind === 'warning' ? 'Warning' : 'Failed'} item:{' '}
              </span>
              {compactFacts.primary}
              <span className="screen-reader-only">. Detail: {compactFacts.primaryDetail}</span>
            </p>
          )}
          <PanelMetadata
            glyph="⚙"
            label="Update workflows"
            value={compactFacts.workflow}
            compact={{ kind: 'short-value', value: signal.data.workflows.length }}
            title={`Update workflows: ${compactFacts.workflow}`}
            className={styles.compactFact}
          />
          <PanelMetadata
            glyph="⎇"
            label="Open update pull requests"
            value={compactFacts.pullRequests}
            compact={{ kind: 'short-value', value: signal.data.pullRequests.length }}
            title={`Open update pull requests: ${compactFacts.pullRequests}`}
            className={styles.compactFact}
          />
        </div>
        <div className={styles.freshness}>
          <ObservedAt value={envelope.observedAt} label="Observed (oldest evidence)" />
          {signal.data.newestObservedAt && (
            <span className="screen-reader-only">
              Newest evidence observed {signal.data.newestObservedAt}.
            </span>
          )}
          {updateHealth && <UpdateHealth health={updateHealth} />}
        </div>
        {signal.data.incompleteObservations && (
          <div role="status">
            <PanelHint className={styles.incomplete}>
              ⚠ Incomplete observations:{' '}
              {signal.data.incompleteObservations
                .map(({ label, message }) => `${label}: ${message}`)
                .join(' · ')}
            </PanelHint>
          </div>
        )}
      </div>
    </PanelFrame>
  )
}
