import {
  analyzeBoardLayout,
  type Board,
  type ClientEnv,
  isZeroPosition,
} from '@ze-great-dashboard/shared/browser'
import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './App.module.css'
import { projectAttention } from './attention.ts'
import { Diagnostics } from './Diagnostics.tsx'
import type { DashboardAuth } from './dashboard-fetch.ts'
import { dashboardFetch } from './dashboard-fetch.ts'
import { BrowserDiagnosticStore, cacheMetadata } from './diagnostics.ts'
import { OidcGate } from './OidcGate.tsx'
import { PanelPlaceholder } from './PanelPlaceholder.tsx'
import { PanelRenderer } from './panel-registry.tsx'
import { SecurityNotice } from './SecurityNotice.tsx'
import { UpdateActivity } from './UpdateActivity.tsx'
import { projectUpdateActivity } from './update-activity.ts'
import { useClientUpdate } from './useClientUpdate.ts'
import { usePanelSignals } from './usePanelSignals.ts'

/**
 * The board shell.
 *
 * Stage 1 has no data: there is no proxy endpoint to poll yet. What this proves is the plumbing —
 * that the client was handed its configuration by the server and knows which version of itself it
 * is. The version readout is what makes two published versions visibly different, which is the
 * whole point of the Stage 1 exit criterion.
 */
export function App({ env }: { env: ClientEnv }) {
  if (env.security === 'blocked') return <SecurityNotice mode="blocked" />
  return env.auth ? (
    <OidcGate env={env} auth={env.auth}>
      {(accessToken, denied) => <Dashboard env={env} accessToken={accessToken} onDenied={denied} />}
    </OidcGate>
  ) : (
    <Dashboard env={env} />
  )
}

function Dashboard({
  env,
  accessToken,
  onDenied,
}: {
  env: ClientEnv
  accessToken?: string
  onDenied?: () => void
}) {
  const [board, setBoard] = useState<Board>()
  const [loadedBoardName, setLoadedBoardName] = useState<string>()
  const diagnosticsRef = useRef<BrowserDiagnosticStore | null>(null)
  if (!diagnosticsRef.current) diagnosticsRef.current = new BrowserDiagnosticStore(env)
  const diagnostics = diagnosticsRef.current
  const auth = useMemo<DashboardAuth | undefined>(
    () =>
      accessToken
        ? { accessToken, onAuthenticationFailure: (status) => status === 403 && onDenied?.() }
        : undefined,
    [accessToken, onDenied],
  )
  useClientUpdate({ env, diagnostics, auth })
  const { signals, updateHealth, factSignals, schedules } = usePanelSignals({
    board: loadedBoardName === env.board ? board : undefined,
    env,
    diagnostics,
    auth,
  })
  const layout = useMemo(() => (board ? analyzeBoardLayout(board.panels) : undefined), [board])
  const attentionDrivers = useMemo(
    () => projectAttention({ board, signals, updateHealth, factSignals }),
    [board, factSignals, signals, updateHealth],
  )
  const attentionTreatment = attentionDrivers.length ? board?.attention?.treatment : undefined
  const activeAttentionPanels = new Set(attentionDrivers.map((driver) => driver.panelId))

  useEffect(() => {
    if (!layout || layout.issues.length === 0) return
    diagnostics.record({
      kind: 'layout-analyzed',
      issueCount: layout.issues.length,
      affectedPanelIds: layout.issues.map((issue) => issue.panelId),
    })
  }, [diagnostics, layout])

  useEffect(() => {
    let cancelled = false
    setBoard(undefined)
    setLoadedBoardName(undefined)
    const path = `${env.proxyPath}/boards/${encodeURIComponent(env.board)}`
    diagnostics.record({ kind: 'board-fetch-start', path })
    dashboardFetch(env, path, undefined, globalThis.fetch, auth)
      .then(async (response) => {
        diagnostics.record({
          kind: 'board-fetch-response',
          path,
          status: response.status,
          cache: cacheMetadata(response.headers),
        })
        if (!response.ok) throw new Error(`Board configuration returned ${response.status}`)
        try {
          return await response.json()
        } catch (error) {
          diagnostics.record({
            kind: 'board-fetch-parse-failure',
            path,
            message: errorMessage(error),
          })
          throw new DiagnosticParseFailure(error)
        }
      })
      .then((value: unknown) => {
        if (!cancelled) {
          setBoard(value as Board)
          setLoadedBoardName(env.board)
          const panels = Array.isArray((value as { panels?: unknown }).panels)
            ? (value as { panels: Array<{ id?: unknown }> }).panels
            : []
          diagnostics.record({
            kind: 'board-fetch-response',
            path,
            boardSummary: {
              panelCount: panels.length,
              panelIds: panels.flatMap((panel) => (typeof panel.id === 'string' ? [panel.id] : [])),
            },
          })
        }
      })
      .catch((error) => {
        if (!(error instanceof DiagnosticParseFailure)) {
          diagnostics.record({ kind: 'board-fetch-failure', path, message: errorMessage(error) })
        }
        if (!cancelled) {
          setBoard({ panels: [] })
          setLoadedBoardName(env.board)
        }
      })
    return () => {
      cancelled = true
    }
  }, [auth, diagnostics, env])

  return (
    <div
      className={`${styles.board} ${attentionTreatment ? styles[`attention-${attentionTreatment}`] : ''}`}
      data-attention-treatment={attentionTreatment}
      data-attention-active={attentionDrivers.length || undefined}
    >
      <header className={styles.header}>
        <h1 className={styles.title}>{env.board}</h1>
        {env.security === 'warning' && <SecurityNotice mode="warning" />}
        {attentionDrivers.length > 0 && (
          <aside
            className={styles.attentionRail}
            role="alert"
            aria-label="Important panel attention"
          >
            <span className={styles.attentionGlyph} aria-hidden="true">
              ⚠
            </span>
            <ul>
              {attentionDrivers.map((driver) => (
                <li key={`${driver.panelId}-${driver.factId ?? 'panel'}-${driver.reason}`}>
                  <a href={`#panel-${driver.panelId}`}>
                    <strong>{driver.label}</strong>: {driver.reason}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </header>
      <main className={styles.grid}>
        {!board && <PanelPlaceholder label="board" hint="Loading configuration…" wide />}
        {board?.panels
          .filter((panel) => !isZeroPosition(panel.position))
          .map((panel) => (
            <PanelRenderer
              key={panel.id}
              panel={panel}
              envelope={signals[panel.id]}
              attentionActive={activeAttentionPanels.has(panel.id)}
              updateHealth={updateHealth[panel.id]}
              facts={factSignals[panel.id]}
            />
          ))}
      </main>

      <footer className={styles.footer} data-board-footer>
        <span>Signals are read live from their configured authorities.</span>
        <div className={styles.footerTools}>
          {layout && layout.issues.length > 0 && (
            <LayoutWarning board={env.board} layout={layout} env={env} auth={auth} />
          )}
          <Diagnostics
            log={diagnostics}
            updateActivity={() => {
              const evidence = diagnostics.retainedEvidence()
              const projected = projectUpdateActivity({
                schedules,
                ...evidence,
              })
              return {
                capturedAt: projected.capturedAt,
                window: projected.window,
                schedules: projected.schedules,
              }
            }}
          />
          <UpdateActivity board={board} schedules={schedules} log={diagnostics} />
        </div>
      </footer>
    </div>
  )
}

function LayoutWarning({
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

class DiagnosticParseFailure extends Error {
  constructor(error: unknown) {
    super(errorMessage(error))
  }
}
