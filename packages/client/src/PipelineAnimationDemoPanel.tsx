import type { Panel } from '@ze-great-dashboard/shared'
import { useEffect, useState } from 'react'
import { PanelFrame } from './PanelFrame.tsx'
import { isRunningFieldAnimation, RunningField } from './RunningField.tsx'
import { RunningFieldTiming } from './RunningFieldTiming.tsx'
import { RunningProgress } from './RunningProgress.tsx'
import { useRunningTiming } from './running-timing.ts'

const RUN_DURATION_MS = 20_000
const ESTIMATED_DURATION_MS = 15_000
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
  const runNumber = Math.floor(now / RUN_DURATION_MS)
  const animation = variants[runNumber % variants.length] ?? 'radial'
  const runStartedAt = runNumber * RUN_DURATION_MS

  return <DemoRun panel={panel} animation={animation} runStartedAt={runStartedAt} />
}

function DemoRun({
  panel,
  animation,
  runStartedAt,
}: {
  panel: Panel
  animation: (typeof variants)[number]
  runStartedAt: number
}) {
  const startedAt = new Date(runStartedAt).toISOString()
  const timing = useRunningTiming(startedAt, ESTIMATED_DURATION_MS)
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
      <p className="panel__status panel__status--running">↻ Running</p>
      <p className="pipeline-animation-demo__variant">Demo treatment · {animation}</p>
      {usesField ? (
        <RunningFieldTiming
          elapsedMs={timing.elapsedMs}
          estimatedDurationMs={ESTIMATED_DURATION_MS}
          overdue={timing.overdue}
        />
      ) : (
        <RunningProgress
          animation={animation}
          runStartedAt={startedAt}
          estimatedDurationMs={ESTIMATED_DURATION_MS}
        />
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
