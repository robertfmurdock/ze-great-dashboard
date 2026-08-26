/**
 * A panel-shaped hole, so the grid can be looked at and argued with before any signal exists.
 * Replaced by real panels in Stage 2 — nothing here is meant to survive.
 */
export function PanelPlaceholder({
  label,
  hint,
  wide = false,
}: {
  label: string
  hint: string
  wide?: boolean
}) {
  return (
    <section
      className={`${styles.panel} ${wide ? styles.wide : ''}`}
      data-panel
      data-panel-id="placeholder"
    >
      <h2 className={styles.label}>{label}</h2>
      <p className={styles.hint}>{hint}</p>
    </section>
  )
}

import styles from './PanelFrame.module.css'
