import type { TestCount, TestEvidence } from '@ze-great-dashboard/shared/browser'
import styles from './PanelFrame.module.css'
import { PanelMetadata } from './PanelFrame.tsx'
import { TestDirectionSummary } from './TestDirectionSummary.tsx'
import type { TestDirection } from './test-direction.ts'

export function RunTestResults({
  envelope,
  direction,
  motionId,
}: {
  envelope: TestEvidence
  direction?: TestDirection
  motionId?: string
}) {
  if (envelope.state === 'error')
    return (
      <PanelMetadata
        glyph="⚠"
        label="Tests"
        motionId={motionId}
        value={`Test results unavailable: ${envelope.error.message}`}
      />
    )
  const tests = envelope.signal
  if (tests.status !== 'reported')
    return (
      <PanelMetadata
        glyph="≡"
        label="Tests"
        motionId={motionId}
        value={tests.status === 'pending' ? 'Tests pending' : 'No test results published'}
      />
    )
  return (
    <PanelMetadata
      glyph="≡"
      label="Tests"
      motionId={motionId}
      value={<TestOutcomeSummary tests={tests} direction={direction} />}
    />
  )
}

/** The same reported evidence in both standalone panels and workflow runs. */
export function TestOutcomeSummary({
  tests,
  direction,
}: {
  tests: Extract<TestCount, { status: 'reported' }>
  direction?: TestDirection
}) {
  const allPassed = tests.total > 0 && tests.passed === tests.total
  return (
    <TestDirectionSummary direction={direction}>
      {allPassed ? (
        <span className={styles.passed}>✓ {tests.total.toLocaleString()}</span>
      ) : (
        `${tests.total.toLocaleString()} tests`
      )}
      {!!tests.failed && (
        <span className={styles.failed}> · ✕ {tests.failed.toLocaleString()}</span>
      )}
      {!!tests.skipped && (
        <span className={styles.warning}> · ↷ {tests.skipped.toLocaleString()}</span>
      )}
    </TestDirectionSummary>
  )
}

/** Only compact public evidence; observation timestamps do not constitute a visible change. */
export function projectTestEvidence(evidence: TestEvidence) {
  return evidence.state === 'error'
    ? { state: evidence.state, kind: evidence.error.kind, message: evidence.error.message }
    : { state: evidence.state, ...publicTestCounts(evidence.signal) }
}
export type TestEvidenceDiagnostic = ReturnType<typeof projectTestEvidence>

function publicTestCounts(signal: TestCount) {
  if (signal.status !== 'reported') return signal
  const { run: _run, ...counts } = signal
  return counts
}
