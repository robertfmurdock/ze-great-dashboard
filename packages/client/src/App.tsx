import {
  analyzeBoardLayout,
  type ClientEnv,
  isZeroPosition,
} from '@ze-great-dashboard/shared/browser'
import { useEffect, useMemo, useRef } from 'react'
import styles from './App.module.css'
import { projectAttention } from './attention.ts'
import { Diagnostics } from './Diagnostics.tsx'
import type { DashboardAuth } from './dashboard-fetch.ts'
import { BrowserDiagnosticStore } from './diagnostics.ts'
import { LayoutWarning } from './LayoutWarning.tsx'
import { OidcGate } from './OidcGate.tsx'
import { PanelPlaceholder } from './PanelPlaceholder.tsx'
import { PanelRenderer } from './panel-registry.tsx'
import { SecurityDetails } from './SecurityDetails.tsx'
import { SecurityNotice } from './SecurityNotice.tsx'
import { UpdateActivity } from './UpdateActivity.tsx'
import { projectUpdateActivity } from './update-activity.ts'
import { useBoardConfig } from './useBoardConfig.ts'
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
  const { board, loadedBoardName } = useBoardConfig({ env, diagnostics, auth })
  const { signals, updateHealth, factSignals, schedules, rejectedPipelines } = usePanelSignals({
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
              rejectedPipeline={rejectedPipelines[panel.id]}
              facts={factSignals[panel.id]}
            />
          ))}
      </main>

      <footer className={styles.footer} data-board-footer>
        <span>Signals are read live from their configured authorities.</span>
        <div className={styles.footerTools}>
          {auth && <SecurityDetails env={env} auth={auth} />}
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
