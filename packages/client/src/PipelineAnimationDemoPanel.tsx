import type { Panel } from '@ze-great-dashboard/shared'
import { useEffect, useState } from 'react'
import { PanelFrame, PanelStatus } from './PanelFrame.tsx'
import styles from './PipelineAnimationDemoPanel.module.css'
import { isRunningFieldAnimation, RunningField } from './RunningField.tsx'
import { RunningFieldTiming } from './RunningFieldTiming.tsx'
import { RunningProgress } from './RunningProgress.tsx'
import { useRunningTiming } from './running-timing.ts'

const RUN_DURATION_MS = 20_000
const ESTIMATED_DURATION_MS = 15_000
const REVIEW_DURATION_MS = 300_000
const variants = [
  'radial',
  'runway',
  'orbit',
  'signal-field',
  'telemetry-bloom',
  'release-transit',
  'status-weather',
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
  const durationMs = fixedAnimation ? REVIEW_DURATION_MS : RUN_DURATION_MS
  const runNumber = Math.floor(now / durationMs)
  const animation = fixedAnimation ?? variants[runNumber % variants.length] ?? 'radial'
  const runStartedAt = runNumber * durationMs

  return (
    <DemoRun
      panel={panel}
      animation={animation}
      runStartedAt={runStartedAt}
      estimatedDurationMs={fixedAnimation ? REVIEW_DURATION_MS : ESTIMATED_DURATION_MS}
    />
  )
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
            animation={animation}
            progress={timing.progress}
            overdue={timing.overdue}
            indeterminate={!timing.hasEstimate}
          />
        ) : undefined
      }
    >
      <PanelStatus status="running">↻ Running</PanelStatus>
      <p className={styles.variant}>Demo treatment · {animation}</p>
      {usesField ? (
        <RunningFieldTiming
          elapsedMs={timing.elapsedMs}
          estimatedDurationMs={estimatedDurationMs}
          overdue={timing.overdue}
        />
      ) : (
        <RunningProgress animation={animation} timing={timing} />
      )}
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
