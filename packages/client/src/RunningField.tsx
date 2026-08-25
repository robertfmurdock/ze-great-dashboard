import type { RunningAnimation } from '@ze-great-dashboard/shared'
import type { CSSProperties } from 'react'

export type RunningFieldAnimation = Extract<
  RunningAnimation,
  'telemetry-bloom' | 'release-transit' | 'status-weather'
>

export function isRunningFieldAnimation(
  animation: Exclude<RunningAnimation, 'off'>,
): animation is RunningFieldAnimation {
  return ['telemetry-bloom', 'release-transit', 'status-weather'].includes(animation)
}

export function RunningField({
  animation,
  progress,
  overdue,
  indeterminate,
}: {
  animation: RunningFieldAnimation
  progress: number
  overdue: boolean
  indeterminate: boolean
}) {
  const style = {
    '--running-progress': `${progress * 100}%`,
  } as CSSProperties
  const state = `${overdue ? ' running-field--overdue' : ''}${indeterminate ? ' running-field--indeterminate' : ''}`

  return (
    <div
      className={`running-field running-field--${animation}${state}`}
      data-animation={animation}
      aria-hidden="true"
      style={style}
    >
      {animation === 'telemetry-bloom' && (
        <>
          <span className="running-field__bloom-frontier" />
          <span className="running-field__bloom-lanes">
            {[0, 1, 2, 3].map((lane) => (
              <span className="running-field__bloom-lane" key={lane}>
                <span className="running-field__bloom-marker" />
              </span>
            ))}
          </span>
        </>
      )}
      {animation === 'release-transit' && (
        <>
          <span className="running-field__transit-frontier" />
          <span className="running-field__transit-now" />
          <span className="running-field__transit-routes">
            {[0, 1, 2].map((route) => (
              <span className="running-field__transit-route" key={route} />
            ))}
          </span>
          <span className="running-field__transit-trail" />
          <span className="running-field__transit-packet" />
        </>
      )}
      {animation === 'status-weather' && (
        <>
          <span className="running-field__weather-haze" />
          <span className="running-field__weather-band running-field__weather-band--one" />
          <span className="running-field__weather-band running-field__weather-band--two" />
          <span className="running-field__weather-band running-field__weather-band--three" />
          <span className="running-field__weather-drift running-field__weather-drift--one" />
          <span className="running-field__weather-drift running-field__weather-drift--two" />
          <span className="running-field__weather-drift running-field__weather-drift--three" />
          <span className="running-field__weather-drift running-field__weather-drift--four" />
          <span className="running-field__weather-drift running-field__weather-drift--five" />
        </>
      )}
    </div>
  )
}
