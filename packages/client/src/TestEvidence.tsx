import type { TestCount, TestEvidence } from '@ze-great-dashboard/shared/browser'
import { PanelMetadata } from './PanelFrame.tsx'

export function formatTestOutcomes(tests: Extract<TestCount, { status: 'reported' }>) {
  return [
    ['passed', tests.passed],
    ['failed', tests.failed],
    ['skipped', tests.skipped],
  ]
    .filter(([, count]) => count !== undefined)
    .map(([label, count]) => `${count} ${label}`)
    .join(' · ')
}

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
  const outcomes = formatTestOutcomes(tests)
  return (
    <PanelMetadata
      glyph="≡"
      label="Tests"
      value={`${tests.total.toLocaleString()} tests${outcomes ? ` · ${outcomes}` : ''}`}
    />
  )
}

/** Only compact public evidence; observation timestamps do not constitute a visible change. */
export function projectTestEvidence(evidence: TestEvidence) {
  return evidence.state === 'error'
    ? { state: evidence.state, kind: evidence.error.kind, message: evidence.error.message }
    : { state: evidence.state, ...evidence.signal }
}
export type TestEvidenceDiagnostic = ReturnType<typeof projectTestEvidence>
