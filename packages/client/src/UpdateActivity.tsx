import type { Board } from '@ze-great-dashboard/shared'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { BrowserDiagnosticStore } from './diagnostics.ts'
import type { PollingScheduleSnapshot } from './polling-schedule.ts'
import styles from './UpdateActivity.module.css'
import { projectUpdateActivity } from './update-activity.ts'
import { activityLaneLabel, activityMarkerPosition } from './update-activity-presentation.ts'

/** An in-flow, browser-local polling timeline. Diagnostics retains the exportable detail. */
export function UpdateActivity({
  board,
  schedules,
  log,
}: {
  board: Board | undefined
  schedules: PollingScheduleSnapshot[]
  log: BrowserDiagnosticStore
}) {
  const [now, setNow] = useState(() => new Date())
  useSyncExternalStore(log.subscribe, log.snapshot, log.snapshot)
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(interval)
  }, [])
  const activity = useMemo(
    () => projectUpdateActivity({ schedules, ...log.retainedEvidence(), now }),
    [log, now, schedules],
  )
  return (
    <section
      className={styles.activity}
      data-update-activity
      aria-labelledby="update-activity-title"
    >
      <div className={styles.heading}>
        <div>
          <strong id="update-activity-title">Update activity</strong>
          <p>Browser-local proxy reads from the last 10 minutes. Panels schedule independently.</p>
        </div>
        <span className={styles.legend}>● observed · ◇ expected</span>
      </div>
      {board && activity.lanes.length === 0 && (
        <p className={styles.empty}>No visible polling panels are configured.</p>
      )}
      {activity.lanes.length > 0 && (
        <>
          <div className={styles.axis} aria-hidden="true">
            <span>10m ago</span>
            <span>now</span>
          </div>
          <div className={styles.lanes}>
            {activity.lanes.map((lane) => (
              <div className={styles.lane} data-update-activity-lane key={lane.panelId}>
                <span className={styles.laneLabel}>{lane.label}</span>
                <span className={styles.track} role="img" aria-label={activityLaneLabel(lane, now)}>
                  {lane.observed.flatMap(({ path, starts }) =>
                    starts.map((start) => (
                      <i
                        className={styles.observed}
                        key={`${path}-${start}`}
                        style={{ left: `${activityMarkerPosition(start, now)}%` }}
                        title={`Observed request: ${path}`}
                      />
                    )),
                  )}
                  {lane.nextDueAt && (
                    <i
                      className={styles.expected}
                      style={{ left: `${activityMarkerPosition(lane.nextDueAt, now)}%` }}
                      title="Expected next poll"
                    />
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
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
    </section>
  )
}
