import type { Envelope, Panel, PipelineStatus } from '@ze-great-dashboard/shared'
import type { ReactNode } from 'react'
import styles from './PanelFrame.module.css'
import { panelLayout } from './panel-layout.ts'

type PanelStatusKind = PipelineStatus['status']
type CompactEvidence = { kind: 'short-value'; value: ReactNode } | { kind: 'glyph-only' }

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
  compact,
  title,
  observed = false,
  emphasis,
  className,
}: {
  glyph: string
  label: string
  value: ReactNode
  /** A text-light visual alternative; the full value remains available to assistive technology. */
  compact?: CompactEvidence
  title?: string
  observed?: boolean
  emphasis?: 'warning' | 'serious'
  className?: string
}) {
  return (
    <p
      className={`${styles.hint} ${observed ? styles.observed : ''} ${emphasis ? styles[emphasis] : ''} ${styles.meta} ${className ?? ''}`}
      data-panel-meta
    >
      <span aria-hidden="true">{glyph}</span> <span className="screen-reader-only">{label}: </span>
      <span className={styles.metaValue} title={title}>
        <span className={styles.fullValue}>{value}</span>
        {compact && (
          <span className={styles.compactValue} aria-hidden="true">
            {compact.kind === 'short-value' ? compact.value : null}
          </span>
        )}
      </span>
    </p>
  )
}

/** Stable layout slot for a panel's ordinary readable evidence. */
export function PanelEvidence({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`${styles.evidence} ${className ?? ''}`} data-panel-evidence>
      {children}
    </div>
  )
}

export function PanelStatus({
  children,
  status,
  emphasis,
}: {
  children: ReactNode
  status?: PanelStatusKind
  emphasis?: 'warning' | 'serious'
}) {
  return (
    <p
      className={`${styles.status} ${status ? styles[status] : ''} ${emphasis ? styles[emphasis] : ''}`}
    >
      {children}
    </p>
  )
}

export function PanelFrame({
  panel,
  envelope,
  error = false,
  field,
  layout,
  children,
}: {
  panel: Panel
  envelope?: Envelope
  error?: boolean
  /** Decorative active-run layer. It is intentionally a sibling of readable panel content. */
  field?: ReactNode
  /** Opt-in slots for a panel with identity, status, and evidence anchors. */
  layout?: 'three-anchor'
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
      <div
        className={`${styles.content} ${layout === 'three-anchor' ? styles.threeAnchor : ''}`}
        data-panel-content
        data-panel-layout={layout}
      >
        <h2 className={styles.label} data-panel-anchor="identity">
          {panel.label ?? panel.id}
        </h2>
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
