import type { TestCount, TestEvidence } from '@ze-great-dashboard/shared/browser'
import styles from './PanelFrame.module.css'
import { PanelMetadata } from './PanelFrame.tsx'

export function RunTestResults({ envelope }: { envelope: TestEvidence }) {
  if (envelope.state === 'error')
    return (
      <PanelMetadata
        glyph="⚠"
        label="Tests"
        value={`Test results unavailable: ${envelope.error.message}`}
      />
    )
  const tests = envelope.signal
  if (tests.status !== 'reported')
    return (
      <PanelMetadata
        glyph="≡"
        label="Tests"
        value={tests.status === 'pending' ? 'Tests pending' : 'No test results published'}
      />
    )
  return <PanelMetadata glyph="≡" label="Tests" value={<TestOutcomeSummary tests={tests} />} />
}

/** The same reported evidence in both standalone panels and workflow runs. */
export function TestOutcomeSummary({
  tests,
}: {
  tests: Extract<TestCount, { status: 'reported' }>
}) {
  const allPassed = tests.total > 0 && tests.passed === tests.total
  return (
    <>
      {allPassed ? (
        <span className={styles.passed}>✓ {tests.total.toLocaleString()} passed</span>
      ) : (
        `${tests.total.toLocaleString()} tests`
      )}
      {!!tests.failed && (
        <span className={styles.failed}> · ✕ {tests.failed.toLocaleString()} failed</span>
      )}
      {!!tests.skipped && (
        <span className={styles.warning}> · ↷ {tests.skipped.toLocaleString()} skipped</span>
      )}
    </>
  )
}

/** Only compact public evidence; observation timestamps do not constitute a visible change. */
export function projectTestEvidence(evidence: TestEvidence) {
  return evidence.state === 'error'
    ? { state: evidence.state, kind: evidence.error.kind, message: evidence.error.message }
    : { state: evidence.state, ...evidence.signal }
}
export type TestEvidenceDiagnostic = ReturnType<typeof projectTestEvidence>
