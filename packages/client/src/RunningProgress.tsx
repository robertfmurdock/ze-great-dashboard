import type { RunningAnimation } from '@ze-great-dashboard/shared'
import type { CSSProperties } from 'react'
import { compactTiming, timingDescription, useRunningTiming } from './running-timing.ts'

export function RunningProgress({
  animation,
  runStartedAt,
  estimatedDurationMs,
}: {
  animation: LegacyRunningAnimation
  runStartedAt?: string
  estimatedDurationMs?: number
}) {
  const { elapsedMs, hasEstimate, overdue, progress } = useRunningTiming(
    runStartedAt,
    estimatedDurationMs,
  )
  const usesReadout = animation === 'runway' || animation === 'signal-field'
  const timingText = timingDescription(elapsedMs, estimatedDurationMs, overdue)
  const style = {
    '--running-progress': `${progress * 100}%`,
    '--running-degrees': `${progress * 360}deg`,
  } as CSSProperties

  return (
    <div
      className={`running-progress running-progress--${animation}${overdue ? ' running-progress--overdue' : ''}${hasEstimate ? '' : ' running-progress--indeterminate'}`}
      style={style}
    >
      <div className="running-progress__visual" aria-hidden="true">
        {animation === 'radial' && <span className="running-progress__radial-core" />}
        {animation === 'runway' && <span className="running-progress__runway-spark" />}
        {animation === 'orbit' && (
          <>
            <span className="running-progress__orbit-core" />
            <span className="running-progress__orbit-particle running-progress__orbit-particle--one" />
            <span className="running-progress__orbit-particle running-progress__orbit-particle--two" />
          </>
        )}
        {animation === 'signal-field' && (
          <>
            <span className="running-progress__signal-rail" />
            <span className="running-progress__signal-lead" />
            <span className="running-progress__signal-pulse running-progress__signal-pulse--one" />
            <span className="running-progress__signal-pulse running-progress__signal-pulse--two" />
            <span className="running-progress__signal-tracks">
              {[0, 1, 2, 3, 4].map((track) => (
                <span className="running-progress__signal-track" key={track}>
                  <span className="running-progress__signal-marker">
                    <span className="running-progress__signal-marker-dot" />
                  </span>
                </span>
              ))}
            </span>
          </>
        )}
      </div>
      <p
        className={`running-progress__timing${usesReadout ? ' running-progress__timing--readout' : ''}`}
      >
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
