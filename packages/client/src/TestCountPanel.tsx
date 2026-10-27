import { testCountSchema } from '@ze-great-dashboard/shared/browser'
import { errorPresentation } from './error-presentation.ts'
import {
  PanelEvidence,
  PanelFrame,
  PanelHint,
  PanelMetadata,
  PanelStatus,
  PanelValue,
} from './PanelFrame.tsx'
import type { PanelProps } from './panel-props.ts'
import { ObservedAt, UpdateHealth } from './TimeAge.tsx'

/** Renders one workflow run's declared aggregate test evidence. */
export function TestCountPanel({ panel, envelope, attentionActive, updateHealth }: PanelProps) {
  if (!envelope)
    return (
      <PanelFrame panel={panel} attentionActive={attentionActive}>
        <PanelEvidence>
          <PanelHint>Loading…</PanelHint>
        </PanelEvidence>
      </PanelFrame>
    )
  if (envelope.state === 'error') {
    const presentation = errorPresentation(envelope.error.kind)
    return (
      <PanelFrame panel={panel} envelope={envelope} attentionActive={attentionActive} error>
        <PanelEvidence>
          <PanelStatus glyph="⚠" label={presentation.label} emphasis={presentation.emphasis} />
          <PanelHint>{envelope.error.message}</PanelHint>
        </PanelEvidence>
      </PanelFrame>
    )
  }
  const parsed = testCountSchema.safeParse(envelope.signal)
  if (!parsed.success)
    return (
      <PanelFrame panel={panel} envelope={envelope} attentionActive={attentionActive} error>
        <PanelEvidence>
          <PanelStatus glyph="⚠" label="Invalid test result" />
        </PanelEvidence>
      </PanelFrame>
    )
  const signal = parsed.data
  if (signal.status === 'pending')
    return (
      <TestCountMessage
        panel={panel}
        envelope={envelope}
        attentionActive={attentionActive}
        label="Pending"
        hint="The selected workflow run is still in progress."
      />
    )
  if (signal.status === 'not-reported')
    return (
      <TestCountMessage
        panel={panel}
        envelope={envelope}
        attentionActive={attentionActive}
        label="No test results published"
        hint="This completed workflow did not publish the configured test summary."
      />
    )
  const outcomes = [
    ['passed', signal.passed],
    ['failed', signal.failed],
    ['skipped', signal.skipped],
  ]
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `${value} ${label}`)
    .join(' · ')
  return (
    <PanelFrame panel={panel} envelope={envelope} attentionActive={attentionActive}>
      <PanelEvidence>
        <PanelStatus glyph="✓" label="Test results reported" compactOnly />
        <PanelValue>{signal.total.toLocaleString()} tests</PanelValue>
        {outcomes && <PanelMetadata glyph="≡" label="Outcomes" value={outcomes} />}
        <ObservedAt value={envelope.observedAt} />
        {updateHealth && <UpdateHealth health={updateHealth} />}
      </PanelEvidence>
    </PanelFrame>
  )
}

function TestCountMessage({
  panel,
  envelope,
  attentionActive,
  label,
  hint,
}: {
  panel: PanelProps['panel']
  envelope: NonNullable<PanelProps['envelope']>
  attentionActive?: boolean
  label: string
  hint: string
}) {
  return (
    <PanelFrame panel={panel} envelope={envelope} attentionActive={attentionActive}>
      <PanelEvidence>
        <PanelStatus glyph="◌" label={label} />
        <PanelHint>{hint}</PanelHint>
        <ObservedAt value={envelope.observedAt} />
      </PanelEvidence>
    </PanelFrame>
  )
}
