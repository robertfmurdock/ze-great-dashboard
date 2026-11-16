import type { analyzeBoardLayout, ClientEnv } from '@ze-great-dashboard/shared/browser'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [downloadError, setDownloadError] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogId = `layout-warning-${board}`

  const closeWarning = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeWarning()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeWarning, open])

  const boardPath = `${env.proxyPath}/boards/${encodeURIComponent(board)}`
  async function requestDownload(kind: 'rendered' | 'authored') {
    setDownloadError(false)
    try {
      await downloadLayout(env, `${boardPath}/${kind}`, auth)
    } catch {
      setDownloadError(true)
    }
  }

  return (
    <div className={styles.layoutWarning} data-layout-warning>
      <button
        ref={triggerRef}
        className={styles.layoutWarningButton}
        type="button"
        aria-label={`Layout warnings (${layout.issues.length})`}
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => {
          if (open) closeWarning()
          else setOpen(true)
        }}
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
              onClick={closeWarning}
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
            <button type="button" onClick={() => void requestDownload('rendered')}>
              Download legal rendered layout
            </button>
            <button type="button" onClick={() => void requestDownload('authored')}>
              Download authored layout
            </button>
          </div>
          {downloadError && <p role="alert">Could not download the layout. Try again.</p>}
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
