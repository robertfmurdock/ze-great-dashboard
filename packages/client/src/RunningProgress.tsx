import type { RunningAnimation } from '@ze-great-dashboard/shared'
import type { CSSProperties } from 'react'
import { PhasedProgressMarker } from './PhasedProgressMarker.tsx'
import styles from './RunningProgress.module.css'
import { compactTiming, type RunningTiming, timingDescription } from './running-timing.ts'

export function RunningProgress({
  animation,
  timing,
}: {
  animation: LegacyRunningAnimation
  timing: RunningTiming
}) {
  const { elapsedMs, estimatedDurationMs, hasEstimate, overdue, progress } = timing
  const usesReadout = animation === 'runway' || animation === 'signal-field'
  const timingText = timingDescription(elapsedMs, estimatedDurationMs, overdue)
  const style = {
    '--running-progress': `${progress * 100}%`,
    '--running-degrees': `${progress * 360}deg`,
  } as CSSProperties
  const animationStyle = animation === 'signal-field' ? styles.signalField : styles[animation]

  return (
    <div
      className={`${styles.progress} ${animationStyle} ${overdue ? styles.overdue : ''} ${hasEstimate ? '' : styles.indeterminate}`}
      style={style}
      data-running-progress={animation}
      data-overdue={overdue || undefined}
      data-indeterminate={!hasEstimate || undefined}
    >
      <div className={styles.visual} aria-hidden="true" data-running-visual>
        {animation === 'radial' && <span className={styles.radialCore} />}
        {animation === 'runway' && (
          <>
            <span className={styles.spark} data-running-part="runway-spark" />
            <span
              className={`${styles.spark} ${styles.sparkTwo}`}
              data-running-part="runway-spark-two"
            />
          </>
        )}
        {animation === 'orbit' && (
          <>
            <span className={styles.orbitCore} />
            <span className={styles.particle} />
            <span className={`${styles.particle} ${styles.particleTwo}`} />
          </>
        )}
        {animation === 'signal-field' && (
          <>
            <span className={styles.rail} />
            <span className={styles.lead} />
            <span className={styles.pulse} />
            <span className={`${styles.pulse} ${styles.pulseTwo}`} />
            <span className={styles.tracks} data-running-part="signal-tracks">
              {[0, 1, 2, 3, 4].map((track) => (
                <span className={styles.track} key={track} data-running-part="signal-track">
                  <PhasedProgressMarker
                    anchorClassName={styles.markerAnchor}
                    bodyClassName={styles.markerBody}
                    delay={[undefined, '-0.8s', '-1.7s', '-2.4s', '-0.35s'][track]}
                    anchorPart="signal-marker-anchor"
                    bodyPart="signal-marker"
                  />
                </span>
              ))}
            </span>
          </>
        )}
      </div>
      <p className={`${styles.timing} ${usesReadout ? styles.readout : ''}`}>
        {usesReadout ? (
          <>
            <span className="screen-reader-only">{timingText}</span>
            <span aria-hidden="true">{compactTiming(elapsedMs, estimatedDurationMs, overdue)}</span>
          </>
        ) : (
          timingText
        )}
      </p>
    </div>
  )
}

/** The compact, inline treatments retained for existing boards. */
export type LegacyRunningAnimation = Extract<
  RunningAnimation,
  'radial' | 'runway' | 'orbit' | 'signal-field'
>

export function isLegacyRunningAnimation(
  animation: RunningAnimation,
): animation is LegacyRunningAnimation {
  return ['radial', 'runway', 'orbit', 'signal-field'].includes(animation)
}
