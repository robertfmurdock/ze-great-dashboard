import type { analyzeBoardLayout, ClientEnv } from '@ze-great-dashboard/shared/browser'
import { useEffect, useState } from 'react'
import styles from './App.module.css'
import type { DashboardAuth } from './dashboard-fetch.ts'
import { dashboardFetch } from './dashboard-fetch.ts'

/** Discloses authored layout conflicts without altering the live board. */
export function LayoutWarning({
  board,
  layout,
  env,
  auth,
}: {
  board: string
  layout: ReturnType<typeof analyzeBoardLayout>
  env: ClientEnv
  auth?: DashboardAuth
}) {
  const [open, setOpen] = useState(false)
  const dialogId = `layout-warning-${board}`

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  const boardPath = `${env.proxyPath}/boards/${encodeURIComponent(board)}`
  return (
    <div className={styles.layoutWarning} data-layout-warning>
      <button
        className={styles.layoutWarningButton}
        type="button"
        aria-label={`Layout warnings (${layout.issues.length})`}
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">⚠</span>
        <span>{layout.issues.length}</span>
      </button>
      {open && (
        <aside
          className={styles.layoutWarningDialog}
          id={dialogId}
          role="dialog"
          aria-labelledby={`${dialogId}-title`}
          aria-modal="false"
        >
          <div className={styles.layoutWarningHeading}>
            <strong id={`${dialogId}-title`}>Layout warnings</strong>
            <button
              className={styles.layoutWarningClose}
              type="button"
              aria-label="Close layout warnings"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <p>
            {layout.issues.length} layout issue{layout.issues.length === 1 ? '' : 's'} detected
            against the intended 12×12 space. The live board is unchanged: explicit overlaps remain
            overlapped and overflow continues in implicit rows.
          </p>
          <ul>
            {layout.issues.map((issue) => (
              <li key={`${issue.panelId}-${issue.kind}`}>
                <strong>{issue.panelId}</strong>: {issue.kind} at ({issue.position.x},{' '}
                {issue.position.y}), {issue.position.w}×{issue.position.h}
                {issue.conflictsWith.length ? `; overlaps ${issue.conflictsWith.join(', ')}` : ''}
              </li>
            ))}
          </ul>
          <div className={styles.layoutWarningDownloads}>
            <button
              type="button"
              onClick={() => void downloadLayout(env, `${boardPath}/rendered`, auth)}
            >
              Download legal rendered layout
            </button>
            <button
              type="button"
              onClick={() => void downloadLayout(env, `${boardPath}/authored`, auth)}
            >
              Download authored layout
            </button>
          </div>
          <p className={styles.layoutWarningNote}>
            The legal rendered layout normalizes the currently visible explicit area into 12×12 and
            makes the smallest deterministic adjustments needed to avoid collisions. The authored
            layout preserves the original coordinates exactly.
          </p>
        </aside>
      )}
    </div>
  )
}

async function downloadLayout(env: ClientEnv, path: string, auth?: DashboardAuth) {
  const response = await dashboardFetch(env, path, undefined, globalThis.fetch, auth)
  if (!response.ok) throw new Error(`Layout download returned ${response.status}`)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(await response.blob())
  link.download =
    response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'layout.yaml'
  link.click()
  URL.revokeObjectURL(link.href)
}
