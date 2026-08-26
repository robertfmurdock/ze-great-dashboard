import type { RunningAnimation } from '@ze-great-dashboard/shared'
import type { CSSProperties } from 'react'
import { FallingShapesField } from './FallingShapesField.tsx'
import { ReleaseTransitField } from './ReleaseTransitField.tsx'
import styles from './RunningField.module.css'
import { StatusWeatherField } from './StatusWeatherField.tsx'
import { TelemetryBloomField } from './TelemetryBloomField.tsx'

export type RunningFieldAnimation = Extract<
  RunningAnimation,
  'telemetry-bloom' | 'release-transit' | 'status-weather' | 'falling-shapes'
>

export function isRunningFieldAnimation(
  animation: Exclude<RunningAnimation, 'off'>,
): animation is RunningFieldAnimation {
  return ['telemetry-bloom', 'release-transit', 'status-weather', 'falling-shapes'].includes(
    animation,
  )
}

export function RunningField({
  animation,
  progress,
  estimatedDurationMs,
  overdue,
  indeterminate,
  seed,
}: {
  animation: RunningFieldAnimation
  progress: number
  estimatedDurationMs?: number
  overdue: boolean
  indeterminate: boolean
  seed?: number
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
      {animation === 'falling-shapes' && (
        <FallingShapesField
          progress={progress}
          estimatedDurationMs={estimatedDurationMs}
          overdue={overdue}
          seed={seed}
        />
      )}
    </div>
  )
}
