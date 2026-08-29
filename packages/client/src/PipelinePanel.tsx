import {
  type Envelope,
  type Panel,
  type PipelineStatus,
  pipelineStatusSchema,
  type RunningAnimation,
  visibleRunningAnimations,
} from '@ze-great-dashboard/shared'
import { useRef, useState } from 'react'
import { fallingSeed } from './falling-shapes.ts'
import { PanelFrame, PanelHint, PanelMetadata, PanelStatus } from './PanelFrame.tsx'
import styles from './PipelinePanel.module.css'
import type { PanelProps } from './panel-props.ts'
import { statusPresentation } from './panel-status.ts'
import { formatPipelineActivity } from './pipeline-activity.ts'
import { isRunningFieldAnimation, RunningField } from './RunningField.tsx'
import { RunningFieldTiming } from './RunningFieldTiming.tsx'
import { isLegacyRunningAnimation, RunningProgress } from './RunningProgress.tsx'
import { useRunningTiming } from './running-timing.ts'
import { CheckedAt, RunAge } from './TimeAge.tsx'

export function PipelinePanel({ panel, envelope, checkedAt }: PanelProps) {
  if (!envelope)
    return (
      <PanelFrame panel={panel}>
        <PanelHint>Loading…</PanelHint>
      </PanelFrame>
    )
  if (envelope.state === 'error') {
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <PanelStatus>
          ⚠ {envelope.error.kind === 'no-runs' ? 'No workflow runs' : 'Unable to read'}
        </PanelStatus>
        <PanelHint>{envelope.error.message}</PanelHint>
        {checkedAt && <CheckedAt value={checkedAt} />}
      </PanelFrame>
    )
  }

  const signal = pipelineStatusSchema.safeParse(envelope.signal)
  if (!signal.success)
    return (
      <PanelFrame panel={panel} envelope={envelope} error>
        <PanelStatus>⚠ Invalid signal</PanelStatus>
        {checkedAt && <CheckedAt value={checkedAt} />}
      </PanelFrame>
    )
  return (
    <PipelineSignalPanel
      panel={panel}
      envelope={envelope}
      signal={signal.data}
      checkedAt={checkedAt}
    />
  )
}

function PipelineSignalPanel({
  panel,
  envelope,
  signal,
  checkedAt,
}: {
  panel: Panel
  envelope: Envelope
  signal: PipelineStatus
  checkedAt?: string
}) {
  const presentation = statusPresentation(signal.status)
  const [defaultAnimation, setDefaultAnimation] = useState<RunningAnimation | undefined>(() =>
    signal.status === 'running' ? selectDefaultRunningAnimation() : undefined,
  )
  const previousStatusRef = useRef(signal.status)
  if (signal.status !== previousStatusRef.current) {
    const wasRunning = previousStatusRef.current === 'running'
    previousStatusRef.current = signal.status
    if (panel.running_animation === undefined && !wasRunning && signal.status === 'running') {
      setDefaultAnimation((previousAnimation) => selectDefaultRunningAnimation(previousAnimation))
    }
  }
  const animation = panel.running_animation ?? defaultAnimation ?? 'off'
  const activeRun = signal.status === 'running' && animation !== 'off'
  const timing = useRunningTiming(signal.runStartedAt, signal.estimatedDurationMs)
  const usesField = activeRun && isRunningFieldAnimation(animation)
  const usesLegacyProgress = activeRun && isLegacyRunningAnimation(animation)
  return (
    <PanelFrame
      panel={panel}
      envelope={envelope}
      field={
        usesField ? (
          <RunningField
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
      <div className={styles.details}>
        <PanelStatus status={signal.status}>
          {presentation.glyph} {presentation.label}
        </PanelStatus>
        {signal.status === 'running' && (
          <PanelMetadata
            glyph="⚙"
            label="Activity"
            value={formatPipelineActivity(signal.activity)}
            title={`Activity: ${formatPipelineActivity(signal.activity)}`}
            className={styles.activity}
          />
        )}
        {signal.branch && (
          <PanelMetadata
            glyph="⎇"
            label="Branch"
            value={<span className={styles.branch}>{signal.branch}</span>}
            title={`Branch: ${signal.branch}`}
          />
        )}
        {usesField && (
          <RunningFieldTiming
            elapsedMs={timing.elapsedMs}
            estimatedDurationMs={signal.estimatedDurationMs}
            overdue={timing.overdue}
          />
        )}
        {usesLegacyProgress && <RunningProgress animation={animation} timing={timing} />}
        {signal.status !== 'running' && signal.durationMs !== undefined && (
          <PanelMetadata
            glyph="◷"
            label="Duration"
            value={`Took ${formatDuration(signal.durationMs)}`}
            title={`Duration: Took ${formatDuration(signal.durationMs)}`}
            className={styles.duration}
          />
        )}
        {((signal.status === 'running' && signal.runStartedAt) || signal.sourceUpdatedAt) && (
          <RunAge
            value={
              signal.status === 'running' && signal.runStartedAt
                ? signal.runStartedAt
                : (signal.sourceUpdatedAt ?? envelope.observedAt)
            }
            running={signal.status === 'running'}
          />
        )}
        {checkedAt && <CheckedAt value={checkedAt} />}
      </div>
    </PanelFrame>
  )
}

function selectDefaultRunningAnimation(previousAnimation?: RunningAnimation) {
  const candidates = visibleRunningAnimations.filter((animation) => animation !== previousAnimation)
  return candidates[Math.floor(Math.random() * candidates.length)] ?? 'telemetry-bloom'
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
