import type { RunningAnimation } from '@ze-great-dashboard/shared'
import type { CSSProperties } from 'react'
import { ReleaseTransitField } from './ReleaseTransitField.tsx'
import styles from './RunningField.module.css'
import { StatusWeatherField } from './StatusWeatherField.tsx'
import { TelemetryBloomField } from './TelemetryBloomField.tsx'

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
  return (
    <div
      className={`${styles.field} ${overdue ? styles.overdue : ''}`}
      data-animation={animation}
      data-running-field
      data-indeterminate={indeterminate || undefined}
      aria-hidden="true"
      style={style}
    >
      {animation === 'telemetry-bloom' && <TelemetryBloomField />}
      {animation === 'release-transit' && <ReleaseTransitField />}
      {animation === 'status-weather' && <StatusWeatherField />}
    </div>
  )
}
