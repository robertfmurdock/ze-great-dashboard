import type { RunningAnimation } from '@ze-great-dashboard/shared'
import { type CSSProperties, useEffect, useState } from 'react'

export function RunningProgress({
  animation,
  runStartedAt,
  estimatedDurationMs,
}: {
  animation: Exclude<RunningAnimation, 'off'>
  runStartedAt?: string
  estimatedDurationMs?: number
}) {
  const now = useClock(Boolean(runStartedAt))
  const startedAt = runStartedAt ? new Date(runStartedAt).valueOf() : Number.NaN
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : undefined
  const hasEstimate = elapsedMs !== undefined && estimatedDurationMs !== undefined
  const overdue = hasEstimate && elapsedMs > estimatedDurationMs
  const progress = hasEstimate ? Math.min(elapsedMs / estimatedDurationMs, 1) : 0
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
                  <span className="running-progress__signal-marker" />
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

function useClock(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [enabled])
  return now
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

function timingDescription(
  elapsedMs: number | undefined,
  estimatedDurationMs: number | undefined,
  overdue: boolean,
) {
  const elapsed =
    elapsedMs === undefined ? 'Run in progress' : `Elapsed ${formatDuration(elapsedMs)}`
  const expected =
    estimatedDurationMs === undefined
      ? 'Expected duration unavailable'
      : `Expected ≈ ${formatDuration(estimatedDurationMs)}`
  return `${elapsed} · ${expected}${overdue ? ' · Over estimate' : ''}`
}

function compactTiming(
  elapsedMs: number | undefined,
  estimatedDurationMs: number | undefined,
  overdue: boolean,
) {
  const elapsed = elapsedMs === undefined ? '—' : formatClockDuration(elapsedMs)
  const expected =
    estimatedDurationMs === undefined ? '?' : `~${formatClockDuration(estimatedDurationMs)}`
  return `${overdue ? '⚠' : '\u00a0'}${elapsed}/${expected}`
}

function formatClockDuration(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const clock = `${minutes}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${clock.padStart(5, '0')}` : clock
}
