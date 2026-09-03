import { type Panel, parseDuration } from '@ze-great-dashboard/shared'
import { useEffect, useState } from 'react'
import { fallingSeed } from './falling-shapes.ts'
import { PanelEvidence, PanelFrame, PanelStatus } from './PanelFrame.tsx'
import styles from './PipelineAnimationDemoPanel.module.css'
import { isRunningFieldAnimation, RunningField } from './RunningField.tsx'
import { RunningFieldTiming } from './RunningFieldTiming.tsx'
import { RunningProgress } from './RunningProgress.tsx'
import { useRunningTiming } from './running-timing.ts'

const DEFAULT_RUN_DURATION_MS = 20_000
const ESTIMATED_DURATION_MS = 15_000
const DEFAULT_REVIEW_DURATION_MS = 300_000
const REVIEW_CYCLE_MULTIPLIER = 1.25
const variants = [
  'radial',
  'runway',
  'orbit',
  'signal-field',
  'telemetry-bloom',
  'release-transit',
  'status-weather',
  'falling-shapes',
] as const

/**
 * A local comparison aid for the active-run treatments. It deliberately creates no signal or
 * diagnostic evidence: its state is derived only from the wall clock and repeats forever.
 */
export function PipelineAnimationDemoPanel({ panel }: { panel: Panel }) {
  const now = useClock()
  // A configured visible treatment turns the local comparison aid into a stable review panel.
  // `off` retains the rotating default: the demo exists to render a treatment.
  const fixedAnimation =
    panel.running_animation === undefined || panel.running_animation === 'off'
      ? undefined
      : panel.running_animation
  const runDurationMs = durationMillis(panel.demo_run_duration, DEFAULT_RUN_DURATION_MS)
  const reviewDurationMs = durationMillis(panel.demo_review_duration, DEFAULT_REVIEW_DURATION_MS)
  const durationMs = fixedAnimation
    ? Math.ceil(reviewDurationMs * REVIEW_CYCLE_MULTIPLIER)
    : runDurationMs
  const runNumber = Math.floor(now / durationMs)
  const animation = fixedAnimation ?? variants[runNumber % variants.length] ?? 'radial'
  const runStartedAt = runNumber * durationMs

  return (
    <DemoRun
      panel={panel}
      animation={animation}
      runStartedAt={runStartedAt}
      estimatedDurationMs={fixedAnimation ? reviewDurationMs : ESTIMATED_DURATION_MS}
    />
  )
}

function durationMillis(value: Panel['demo_run_duration'], fallback: number): number {
  if (!value) return fallback
  return parseDuration(value) ?? fallback
}

function DemoRun({
  panel,
  animation,
  runStartedAt,
  estimatedDurationMs,
}: {
  panel: Panel
  animation: (typeof variants)[number]
  runStartedAt: number
  estimatedDurationMs: number
}) {
  const startedAt = new Date(runStartedAt).toISOString()
  const timing = useRunningTiming(startedAt, estimatedDurationMs)
  const usesField = isRunningFieldAnimation(animation)
  return (
    <PanelFrame
      panel={panel}
      field={
        usesField ? (
          <RunningField
            key={`${animation}-${runStartedAt}`}
            animation={animation}
            progress={timing.progress}
            estimatedDurationMs={timing.estimatedDurationMs}
            overdue={timing.overdue}
            indeterminate={!timing.hasEstimate}
            seed={fallingSeed(panel.id)}
          />
        ) : undefined
      }
    >
      <PanelEvidence>
        <PanelStatus status="running">↻ Running</PanelStatus>
        <p className={styles.variant}>
          <span className={styles.variantPrefix}>Demo treatment · </span>
          {animation}
        </p>
        {usesField ? (
          <RunningFieldTiming
            elapsedMs={timing.elapsedMs}
            estimatedDurationMs={estimatedDurationMs}
            overdue={timing.overdue}
          />
        ) : (
          <RunningProgress animation={animation} timing={timing} />
        )}
      </PanelEvidence>
    </PanelFrame>
  )
}

function useClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [])
  return now
}
