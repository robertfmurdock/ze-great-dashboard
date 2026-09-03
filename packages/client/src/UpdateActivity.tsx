import type { Board } from '@ze-great-dashboard/shared'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { BrowserDiagnosticStore } from './diagnostics.ts'
import type { PollingScheduleSnapshot } from './polling-schedule.ts'
import styles from './UpdateActivity.module.css'
import { projectUpdateActivity, updateActivityWindowMillis } from './update-activity.ts'

export function UpdateActivity({
  board,
  schedules,
  log,
}: {
  board: Board | undefined
  schedules: PollingScheduleSnapshot[]
  log: BrowserDiagnosticStore
}) {
  const [open, setOpen] = useState(false)
  const dialogId = 'update-activity-dialog'
  return (
    <section className={styles.activity} data-update-activity>
      <button
        className={styles.button}
        type="button"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => setOpen(!open)}
      >
        Update activity
      </button>
      {open && (
        <UpdateActivityDialog
          board={board}
          dialogId={dialogId}
          schedules={schedules}
          log={log}
          close={() => setOpen(false)}
        />
      )}
    </section>
  )
}

function UpdateActivityDialog({
  board,
  dialogId,
  schedules,
  log,
  close,
}: {
  board: Board | undefined
  dialogId: string
  schedules: PollingScheduleSnapshot[]
  log: BrowserDiagnosticStore
  close: () => void
}) {
  const [selectedPanelId, setSelectedPanelId] = useState<string>()
  const [now, setNow] = useState(() => new Date())
  useSyncExternalStore(log.subscribe, log.snapshot, log.snapshot)

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(interval)
  }, [])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [close])

  const activity = useMemo(
    () =>
      projectUpdateActivity({
        schedules,
        ...log.retainedEvidence(),
        now,
      }),
    [log, now, schedules],
  )
  const selected =
    activity.lanes.find((lane) => lane.panelId === selectedPanelId) ?? activity.lanes[0]
  return (
    <aside
      className={styles.dialog}
      id={dialogId}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${dialogId}-title`}
    >
      <div className={styles.heading}>
        <div>
          <strong id={`${dialogId}-title`}>Update activity</strong>
          <p>Browser-local proxy reads from the last 10 minutes. Panels schedule independently.</p>
        </div>
        <button
          className={styles.close}
          type="button"
          aria-label="Close update activity"
          onClick={close}
        >
          ×
        </button>
      </div>
      {board && activity.lanes.length === 0 && <p>No visible polling panels are configured.</p>}
      <div className={styles.axis} aria-hidden="true">
        <span>10m ago</span>
        <span>now</span>
      </div>
      <div className={styles.lanes}>
        {activity.lanes.map((lane) => (
          <button
            className={styles.lane}
            data-selected={selected?.panelId === lane.panelId || undefined}
            key={lane.panelId}
            type="button"
            onFocus={() => setSelectedPanelId(lane.panelId)}
            onClick={() => setSelectedPanelId(lane.panelId)}
            aria-label={laneLabel(lane, now)}
          >
            <span className={styles.laneLabel}>{lane.label}</span>
            <span className={styles.track}>
              {lane.observed.flatMap(({ path, starts }) =>
                starts.map((start) => (
                  <i
                    className={styles.observed}
                    key={`${path}-${start}`}
                    style={{ left: `${position(start, now)}%` }}
                    title={`Observed request: ${path}`}
                  />
                )),
              )}
              {lane.nextDueAt && (
                <i
                  className={styles.expected}
                  style={{ left: `${position(lane.nextDueAt, now)}%` }}
                  title="Expected next poll"
                />
              )}
            </span>
            <span className={styles.legend} aria-hidden="true">
              ● observed · ◇ expected
            </span>
          </button>
        ))}
      </div>
      {selected && <LaneDetail lane={selected} now={now} />}
      {activity.evidenceMayBeIncomplete && (
        <p className={styles.note}>
          Older browser evidence was pruned, so an empty lane only means no retained request in this
          window.
        </p>
      )}
      <p className={styles.note}>
        Observed markers are requests this browser started; the outlined marker is the current
        expected next poll, not an observed request.
      </p>
    </aside>
  )
}

function LaneDetail({
  lane,
  now,
}: {
  lane: ReturnType<typeof projectUpdateActivity>['lanes'][number]
  now: Date
}) {
  const timing = lane.inFlight
    ? 'Request in flight.'
    : lane.nextDueAt
      ? `${relativeDue(lane.nextDueAt, now)}.`
      : 'Awaiting the first request.'
  return (
    <section className={styles.detail} aria-live="polite">
      <strong>
        {lane.label} <code>({lane.panelId})</code>
      </strong>
      <p>
        {cadenceLabel(lane.cadence)} cadence · {timing}
      </p>
      <p>
        Resolved: normal {formatMillis(lane.settings.refreshMillis)}; running{' '}
        {formatMillis(lane.settings.runningRefreshMillis)}; completion window{' '}
        {formatMillis(lane.settings.runningCompletionRefreshMillis)} for{' '}
        {formatMillis(lane.settings.runningCompletionWindowMillis)}.
      </p>
      {lane.observed.length ? (
        <p>Observed proxy paths: {lane.observed.map(({ path }) => path).join(', ')}.</p>
      ) : (
        <p>
          No retained request start in the last 10 minutes. Known initial paths:{' '}
          {lane.knownPaths.join(', ')}.
        </p>
      )}
    </section>
  )
}

function position(at: string, now: Date) {
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
function laneLabel(lane: ReturnType<typeof projectUpdateActivity>['lanes'][number], now: Date) {
  return `${lane.label}, panel ${lane.panelId}; ${cadenceLabel(lane.cadence)} cadence; ${lane.inFlight ? 'request in flight' : lane.nextDueAt ? relativeDue(lane.nextDueAt, now) : 'awaiting first request'}; ${lane.observed.length ? `${lane.observed.length} observed proxy path${lane.observed.length === 1 ? '' : 's'}` : 'no retained requests in the last 10 minutes'}`
}
