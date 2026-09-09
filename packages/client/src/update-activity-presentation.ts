import type { PollingScheduleSnapshot } from './polling-schedule.ts'
import { type UpdateActivityLane, updateActivityWindowMillis } from './update-activity.ts'

export function activityMarkerPosition(at: string, now: Date) {
  return Math.max(
    0,
    Math.min(
      100,
      ((Date.parse(at) - (now.valueOf() - updateActivityWindowMillis)) /
        updateActivityWindowMillis) *
        100,
    ),
  )
}

export function activityLaneLabel(lane: UpdateActivityLane, now: Date) {
  return `${lane.label}, panel ${lane.panelId}; ${cadenceLabel(lane.cadence)} cadence; ${lane.inFlight ? 'request in flight' : lane.nextDueAt ? relativeDue(lane.nextDueAt, now) : 'awaiting first request'}; ${lane.observed.length ? `${lane.observed.length} observed proxy path${lane.observed.length === 1 ? '' : 's'}` : 'no retained requests in the last 10 minutes'}`
}

function cadenceLabel(cadence: PollingScheduleSnapshot['cadence']) {
  return cadence === 'completion-window'
    ? 'Completion-window'
    : cadence === 'running'
      ? 'Running'
      : 'Normal'
}

function relativeDue(at: string, now: Date) {
  const millis = Date.parse(at) - now.valueOf()
  return millis < 0 ? `Overdue by ${formatMillis(-millis)}` : `Next poll in ${formatMillis(millis)}`
}

function formatMillis(millis: number) {
  return millis % 60_000 === 0
    ? `${Math.round(millis / 60_000)}m`
    : `${Math.max(1, Math.round(millis / 1_000))}s`
}
