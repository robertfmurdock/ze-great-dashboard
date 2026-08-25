import { useState, useSyncExternalStore } from 'react'
import styles from './Diagnostics.module.css'
import type { BrowserDiagnosticStore } from './diagnostics.ts'

export function Diagnostics({ log }: { log: BrowserDiagnosticStore }) {
  const [open, setOpen] = useState(false)
  useSyncExternalStore(log.subscribe, log.snapshot, log.snapshot)
  const count = log.count()
  const summary = log.summary()
  const download = () => {
    const blob = new Blob([JSON.stringify(log.export(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `dashboard-diagnostics-${new Date().toISOString().replaceAll(':', '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  const clear = () => {
    if (!window.confirm('Clear this browser’s retained dashboard diagnostics?')) return
    log.clear()
  }

  return (
    <section className={styles.diagnostics}>
      <button
        className={styles.button}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Diagnostics ({count})
      </button>
      {open && (
        <div className={styles.area}>
          <p>
            {summary.retained.eventCount} retained browser-local events across{' '}
            {summary.retained.sessionCount} session{summary.retained.sessionCount === 1 ? '' : 's'}
            {summary.retained.firstEventAt && summary.retained.lastEventAt
              ? ` (${formatWindow(summary.retained.firstEventAt, summary.retained.lastEventAt)})`
              : ''}
            . They are never uploaded.
          </p>
          {summary.retained.evidenceMayBeIncomplete && (
            <p className={styles.warning} role="alert">
              Earlier evidence was pruned: {summary.retained.retention.eventsPrunedByCount} at the
              2,000-event cap and {summary.retained.retention.eventsPrunedByAge} by the 7-day age
              limit. “No failures” applies only to the retained window.
            </p>
          )}
          <p>
            Update failures: {summary.failures.clientUpdate}; board fetch failures:{' '}
            {summary.failures.boardFetch}.
          </p>
          {summary.panels.length > 0 && (
            <div className={styles.panels}>
              {summary.panels.map((panel) => (
                <p key={panel.panelId}>
                  <strong>{panel.panelId}</strong> — {panel.requests} requests
                  {Object.keys(panel.httpStatuses).length
                    ? `; HTTP ${Object.entries(panel.httpStatuses)
                        .map(([status, count]) => `${status}×${count}`)
                        .join(', ')}`
                    : ''}
                  ; parse/network failures {panel.parseFailures}/{panel.networkFailures}; visible
                  changes {panel.visibleStateChanges}; latest{' '}
                  {panel.latestRendered
                    ? `${panel.latestRendered.state}${panel.latestRendered.status ? `/${panel.latestRendered.status}` : ''}`
                    : 'not rendered'}
                  .
                </p>
              ))}
            </div>
          )}
          <div className={styles.actions}>
            <button className={styles.button} type="button" onClick={download}>
              Download
            </button>
            <button className={styles.button} type="button" onClick={clear}>
              Clear
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function formatWindow(first: string, last: string) {
  return first === last ? first : `${first} to ${last}`
}
