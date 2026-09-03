import { httpValueSchema } from '@ze-great-dashboard/shared'
import { errorPresentation } from './error-presentation.ts'
import styles from './HttpValuePanel.module.css'
import { PanelFrame, PanelHint, PanelStatus } from './PanelFrame.tsx'
import type { HttpValueFactObservation, PanelProps } from './panel-props.ts'
import { ObservedAt, UpdateHealth } from './TimeAge.tsx'

export function HttpValuePanel({ panel, envelope, updateHealth, facts }: PanelProps) {
  if (panel.facts) return <GroupedHttpValuePanel panel={panel} facts={facts} />
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

function GroupedHttpValuePanel({ panel, facts }: Pick<PanelProps, 'panel' | 'facts'>) {
  if (!panel.facts) return null
  return (
    <PanelFrame panel={panel}>
      <div className={styles.facts} data-http-value-facts>
        {panel.facts.map((fact) => (
          <HttpValueFactCell key={fact.id} label={fact.label} observation={facts?.[fact.id]} />
        ))}
      </div>
    </PanelFrame>
  )
}

function HttpValueFactCell({
  label,
  observation,
}: {
  label: string
  observation: HttpValueFactObservation | undefined
}) {
  const envelope = observation?.envelope
  if (!envelope)
    return (
      <section className={styles.factCell} data-http-value-fact>
        <h3>{label}</h3>
        <PanelStatus emphasis={observation?.failure ? 'serious' : undefined}>
          {observation?.failure ? '⚠ Updates unavailable' : 'Loading…'}
        </PanelStatus>
        {observation?.updateHealth && <UpdateHealth health={observation.updateHealth} />}
      </section>
    )
  if (envelope.state === 'error') {
    const presentation = errorPresentation(envelope.error.kind)
    return (
      <section className={styles.factCell} data-http-value-fact data-error>
        <FactSourceLink label={label} link={envelope.link} />
        <h3>{label}</h3>
        <PanelStatus emphasis={presentation.emphasis}>⚠ {presentation.label}</PanelStatus>
        <PanelHint>{envelope.error.message}</PanelHint>
        <ObservedAt value={envelope.observedAt} />
      </section>
    )
  }
  const signal = httpValueSchema.safeParse(envelope.signal)
  if (!signal.success)
    return (
      <section className={styles.factCell} data-http-value-fact data-error>
        <FactSourceLink label={label} link={envelope.link} />
        <h3>{label}</h3>
        <PanelStatus emphasis="serious">⚠ Invalid value</PanelStatus>
        <ObservedAt value={envelope.observedAt} />
      </section>
    )
  return (
    <section className={styles.factCell} data-http-value-fact>
      <FactSourceLink label={label} link={envelope.link} />
      <h3>{label}</h3>
      <PanelStatus>{String(signal.data.value)}</PanelStatus>
      <ObservedAt value={envelope.observedAt} />
    </section>
  )
}

function FactSourceLink({ label, link }: { label: string; link: string | null }) {
  if (!link) return null
  return (
    <a
      className={styles.factSource}
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View source for ${label} (opens in a new tab)`}
      title={`View source for ${label} (opens in a new tab)`}
    >
      <span aria-hidden="true">↗</span>
      <span className="screen-reader-only">View source</span>
    </a>
  )
}
