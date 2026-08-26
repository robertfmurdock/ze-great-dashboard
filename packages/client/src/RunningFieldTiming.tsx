import styles from './RunningField.module.css'
import { compactTiming, timingDescription } from './running-timing.ts'

/** The sole readable timing projection for panel-scale decorative fields. */
export function RunningFieldTiming({
  elapsedMs,
  estimatedDurationMs,
  overdue,
}: {
  elapsedMs: number | undefined
  estimatedDurationMs: number | undefined
  overdue: boolean
}) {
  return (
    <p className={`${styles.timing} ${overdue ? styles.timingOverdue : ''}`}>
      <span className="screen-reader-only">
        {timingDescription(elapsedMs, estimatedDurationMs, overdue)}
      </span>
      <span aria-hidden="true">{compactTiming(elapsedMs, estimatedDurationMs, overdue)}</span>
    </p>
  )
}
