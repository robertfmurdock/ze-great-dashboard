import { useEffect, useState } from 'react'

const VISUAL_TICK_MS = 20

export function useRunningTiming(runStartedAt?: string, estimatedDurationMs?: number) {
  const now = useClock(Boolean(runStartedAt))
  const startedAt = runStartedAt ? new Date(runStartedAt).valueOf() : Number.NaN
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : undefined
  const hasEstimate = elapsedMs !== undefined && estimatedDurationMs !== undefined
  const overdue = hasEstimate && elapsedMs > estimatedDurationMs
  const progress = hasEstimate ? Math.min(elapsedMs / estimatedDurationMs, 1) : 0
  return { elapsedMs, hasEstimate, overdue, progress }
}

function useClock(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    // The timing text rounds to seconds, but progress gets display-cadence intermediate positions.
    // This avoids the visible sawtooth created by a coarse timer and CSS transition.
    const interval = window.setInterval(() => setNow(Date.now()), VISUAL_TICK_MS)
    return () => window.clearInterval(interval)
  }, [enabled])
  return now
}

export function timingDescription(
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

export function compactTiming(
  elapsedMs: number | undefined,
  estimatedDurationMs: number | undefined,
  overdue: boolean,
) {
  const elapsed = elapsedMs === undefined ? '—' : formatClockDuration(elapsedMs)
  const expected =
    estimatedDurationMs === undefined ? '?' : `~${formatClockDuration(estimatedDurationMs)}`
  return `${overdue ? '⚠' : '\u00a0'}${elapsed}/${expected}`
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

function formatClockDuration(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const clock = `${minutes}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${clock.padStart(5, '0')}` : clock
}
