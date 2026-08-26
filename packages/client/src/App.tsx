import type { Board, ClientEnv } from '@ze-great-dashboard/shared'
import { useEffect, useRef, useState } from 'react'
import { Diagnostics } from './Diagnostics.tsx'
import { BrowserDiagnosticStore, cacheMetadata } from './diagnostics.ts'
import { PanelPlaceholder } from './PanelPlaceholder.tsx'
import { PanelRenderer } from './panel-registry.tsx'
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
  const [board, setBoard] = useState<Board>()
  const [loadedBoardName, setLoadedBoardName] = useState<string>()
  const diagnosticsRef = useRef<BrowserDiagnosticStore | null>(null)
  if (!diagnosticsRef.current) diagnosticsRef.current = new BrowserDiagnosticStore(env)
  const diagnostics = diagnosticsRef.current
  useClientUpdate({ env, diagnostics })
  const signals = usePanelSignals({
    board: loadedBoardName === env.board ? board : undefined,
    env,
    diagnostics,
  })

  useEffect(() => {
    let cancelled = false
    setBoard(undefined)
    setLoadedBoardName(undefined)
    const path = `${env.proxyPath}/boards/${encodeURIComponent(env.board)}`
    diagnostics.record({ kind: 'board-fetch-start', path })
    fetch(path)
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
  }, [diagnostics, env.board, env.proxyPath])

  return (
    <div className="board">
      <header className="board__header">
        <h1 className="board__title">{env.board}</h1>
      </header>

      <main className="board__grid">
        {!board && <PanelPlaceholder label="board" hint="Loading configuration…" wide />}
        {board?.panels.map((panel) => (
          <PanelRenderer key={panel.id} panel={panel} envelope={signals[panel.id]} />
        ))}
      </main>

      <footer className="board__footer">
        <span>Signals are read live from their configured authorities.</span>
        <Diagnostics log={diagnostics} />
      </footer>
    </div>
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

class DiagnosticParseFailure extends Error {
  constructor(error: unknown) {
    super(errorMessage(error))
  }
}
