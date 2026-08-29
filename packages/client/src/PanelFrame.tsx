import type { Envelope, Panel } from '@ze-great-dashboard/shared'
import type { ReactNode } from 'react'
import styles from './PanelFrame.module.css'
import { panelLayout } from './panel-layout.ts'

type PanelStatusKind = 'passed' | 'failed' | 'running' | 'cancelled' | 'unknown'

export function PanelHint({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <p className={`${styles.hint} ${className ?? ''}`} title={title}>
      {children}
    </p>
  )
}

/** A concise metadata row with one visible glyph and the full value retained in the DOM. */
export function PanelMetadata({
  glyph,
  label,
  value,
  title,
  observed = false,
  stale = false,
  className,
}: {
  glyph: string
  label: string
  value: ReactNode
  title?: string
  observed?: boolean
  stale?: boolean
  className?: string
}) {
  return (
    <p
      className={`${styles.hint} ${observed ? styles.observed : ''} ${stale ? styles.stale : ''} ${styles.meta} ${className ?? ''}`}
      data-panel-meta
    >
      <span aria-hidden="true">{glyph}</span> <span className="screen-reader-only">{label}: </span>
      <span className={styles.metaValue} title={title}>
        {value}
      </span>
    </p>
  )
}

export function PanelStatus({
  children,
  status,
}: {
  children: ReactNode
  status?: PanelStatusKind
}) {
  return <p className={`${styles.status} ${status ? styles[status] : ''}`}>{children}</p>
}

export function PanelFrame({
  panel,
  envelope,
  error = false,
  field,
  children,
}: {
  panel: Panel
  envelope?: Envelope
  error?: boolean
  /** Decorative active-run layer. It is intentionally a sibling of readable panel content. */
  field?: ReactNode
  children: ReactNode
}) {
  const density = panel.density ?? 'auto'
  const position = panel.position
  const shallow = position !== undefined && position.h <= 2
  const short = position !== undefined && position.h <= 3
  return (
    <section
      className={`${styles.panel} ${styles[`density-${density}`]} ${shallow ? styles.shallow : ''} ${short ? styles.short : ''} ${error ? styles.error : ''}`}
      style={panelLayout(panel)}
      aria-busy={envelope ? undefined : true}
      data-panel
      data-panel-id={panel.id}
      data-panel-position={
        position ? `${position.x},${position.y},${position.w},${position.h}` : undefined
      }
      data-density={density}
      data-shallow={shallow}
      data-short={short}
      data-error={error || undefined}
    >
      {field}
      <PanelSourceLink panelId={panel.id} link={envelope?.link} />
      <div className={styles.content} data-panel-content>
        <h2 className={styles.label}>{panel.label ?? panel.id}</h2>
        {children}
      </div>
    </section>
  )
}

function PanelSourceLink({ panelId, link }: { panelId: string; link?: string | null }) {
  if (!link) return null

  return (
    <a
      className={styles.sourceAction}
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View source for ${panelId} (opens in a new tab)`}
      title={`View source for ${panelId} (opens in a new tab)`}
      data-panel-action="source"
      data-panel-link
    >
      <span aria-hidden="true">↗</span>
      <span className="screen-reader-only">View source</span>
    </a>
  )
}
