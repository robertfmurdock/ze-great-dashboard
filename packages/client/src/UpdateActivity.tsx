import type { Board } from '@ze-great-dashboard/shared/browser'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { BrowserDiagnosticStore } from './diagnostics.ts'
import type { PollingScheduleSnapshot } from './polling-schedule.ts'
import styles from './UpdateActivity.module.css'
import { projectUpdateActivity } from './update-activity.ts'
import { activityLaneLabel, activityMarkerPosition } from './update-activity-presentation.ts'

/** A browser-local polling timeline, available on demand. Diagnostics retains the exportable detail. */
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
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const wasOpenRef = useRef(false)
  useSyncExternalStore(log.subscribe, log.snapshot, log.snapshot)
  useEffect(() => {
    if (!open) return
    const interval = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(interval)
  }, [open])
  const activity = useMemo(
    () => projectUpdateActivity({ schedules, ...log.retainedEvidence(), now }),
    [log, now, schedules],
  )

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) triggerRef.current?.focus()
      wasOpenRef.current = false
      return
    }

    wasOpenRef.current = true
    const dismiss = () => setOpen(false)
    let timeout = window.setTimeout(dismiss, 60_000)
    const resetDismissal = () => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(dismiss, 60_000)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ]
      const first = focusable.at(0)
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const dialog = dialogRef.current
    dialog?.addEventListener('pointerdown', resetDismissal)
    dialog?.addEventListener('keydown', resetDismissal)
    dialog?.addEventListener('focusin', resetDismissal)
    dialog?.addEventListener('keydown', containFocus)
    window.addEventListener('keydown', closeOnEscape)
    closeRef.current?.focus()
    return () => {
      window.clearTimeout(timeout)
      dialog?.removeEventListener('pointerdown', resetDismissal)
      dialog?.removeEventListener('keydown', resetDismissal)
      dialog?.removeEventListener('focusin', resetDismissal)
      dialog?.removeEventListener('keydown', containFocus)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        aria-expanded={open}
        aria-controls="update-activity-dialog"
        onClick={() => {
          setNow(new Date())
          setOpen(true)
        }}
      >
        Update activity
      </button>
      {open && (
        <section
          ref={dialogRef}
          className={styles.dialog}
          data-update-activity
          id="update-activity-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-activity-title"
        >
          <div className={styles.dialogHeader}>
            <div>
              <h2 id="update-activity-title">Update activity</h2>
              <p>
                Browser-local proxy reads from the last 10 minutes. Panels schedule independently.
              </p>
            </div>
            <button
              ref={closeRef}
              className={styles.close}
              type="button"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          <div className={styles.body}>
            <span className={styles.legend}>● observed · ◇ expected</span>
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
                      <span
                        className={styles.track}
                        role="img"
                        aria-label={activityLaneLabel(lane, now)}
                      >
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
                Older browser evidence was pruned, so an empty lane only means no retained request
                in this window.
              </p>
            )}
            <p className={styles.note}>
              Observed markers are requests this browser started; the outlined marker is the current
              expected next poll, not an observed request.
            </p>
          </div>
        </section>
      )}
    </>
  )
}
