import type { Envelope, Panel } from '@ze-great-dashboard/shared'
import type { ReactNode } from 'react'
import styles from './PanelFrame.module.css'
import { panelLayout } from './panel-layout.ts'

type PanelStatusKind = 'passed' | 'failed' | 'running' | 'cancelled' | 'unknown'

export function PanelHint({ children }: { children: ReactNode }) {
  return <p className={styles.hint}>{children}</p>
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

export function PanelBranch({ children, title }: { children: ReactNode; title: string }) {
  return (
    <span className={styles.branch} title={title}>
      {children}
    </span>
  )
}

export function PanelObserved({
  children,
  stale = false,
}: {
  children: ReactNode
  stale?: boolean
}) {
  return (
    <p className={`${styles.hint} ${styles.observed} ${stale ? styles.stale : ''}`}>{children}</p>
  )
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
  const display =
    panel.display === 'primary' || panel.display === 'compact' ? panel.display : 'supporting'
  const shallow = panel.position?.h !== undefined && panel.position.h <= 2
  return (
    <section
      className={`${styles.panel} ${styles[display]} ${shallow ? styles.shallow : ''} ${error ? styles.error : ''}`}
      style={panelLayout(panel)}
      aria-busy={envelope ? undefined : true}
      data-panel
      data-panel-id={panel.id}
      data-display={display}
      data-shallow={shallow}
      data-error={error || undefined}
    >
      {field}
      <div className={styles.content} data-panel-content>
        <h2 className={styles.label}>{panel.label ?? panel.id}</h2>
        {children}
        <PanelSourceLink panelId={panel.id} link={envelope?.link} />
      </div>
    </section>
  )
}

function PanelSourceLink({ panelId, link }: { panelId: string; link?: string | null }) {
  if (!link) return null

  return (
    <a
      className={styles.link}
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View source for ${panelId} (opens in a new tab)`}
      data-panel-link
    >
      View source <span aria-hidden="true">↗</span>
    </a>
  )
}
