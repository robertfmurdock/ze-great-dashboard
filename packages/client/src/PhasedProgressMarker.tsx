import type { CSSProperties } from 'react'
import styles from './PhasedProgressMarker.module.css'

/**
 * A progress-anchored decorative marker. The anchor owns live progress geometry; the body owns
 * its independent phase animation, so a timing render cannot replace its transform.
 */
export function PhasedProgressMarker({
  anchorClassName,
  bodyClassName,
  delay,
  anchorPart,
  bodyPart,
}: {
  anchorClassName: string | undefined
  bodyClassName: string | undefined
  delay?: string
  anchorPart?: string
  bodyPart: string
}) {
  const style = delay ? ({ '--phased-marker-delay': delay } as CSSProperties) : undefined
  return (
    <span className={`${styles.anchor} ${anchorClassName ?? ''}`} data-running-part={anchorPart}>
      <span
        className={`${styles.body} ${bodyClassName ?? ''}`}
        data-running-part={bodyPart}
        style={style}
      />
    </span>
  )
}
