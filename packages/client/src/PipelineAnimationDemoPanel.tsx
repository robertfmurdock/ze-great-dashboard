import type { Panel } from '@ze-great-dashboard/shared'
import { useEffect, useState } from 'react'
import { PanelFrame } from './PanelFrame.tsx'
import { RunningProgress } from './RunningProgress.tsx'

const RUN_DURATION_MS = 20_000
const ESTIMATED_DURATION_MS = 15_000
const variants = ['radial', 'runway', 'orbit', 'signal-field'] as const

/**
 * A local comparison aid for the active-run treatments. It deliberately creates no signal or
 * diagnostic evidence: its state is derived only from the wall clock and repeats forever.
 */
export function PipelineAnimationDemoPanel({ panel }: { panel: Panel }) {
  const now = useClock()
  const runNumber = Math.floor(now / RUN_DURATION_MS)
  const animation = variants[runNumber % variants.length] ?? 'radial'
  const runStartedAt = runNumber * RUN_DURATION_MS

  return (
    <PanelFrame panel={panel}>
      <p className="panel__status panel__status--running">↻ Running</p>
      <p className="pipeline-animation-demo__variant">Demo treatment · {animation}</p>
      <RunningProgress
        key={runStartedAt}
        animation={animation}
        runStartedAt={new Date(runStartedAt).toISOString()}
        estimatedDurationMs={ESTIMATED_DURATION_MS}
      />
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
