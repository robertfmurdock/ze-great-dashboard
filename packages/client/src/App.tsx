import {
  type Board,
  type ClientEnv,
  type Envelope,
  parseDuration,
  resolveRefreshMillis,
} from '@ze-great-dashboard/shared'
import { useEffect, useState } from 'react'
import { PanelPlaceholder } from './PanelPlaceholder.tsx'
import { PipelinePanel, parseEnvelope } from './PipelinePanel.tsx'

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
  const [signals, setSignals] = useState<Record<string, Envelope | undefined>>({})

  useEffect(() => {
    let cancelled = false
    setBoard(undefined)
    setLoadedBoardName(undefined)
    setSignals({})
    fetch(`${env.proxyPath}/boards/${encodeURIComponent(env.board)}`)
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(`Board configuration returned ${response.status}`)),
      )
      .then((value: unknown) => {
        if (!cancelled) {
          setBoard(value as Board)
          setLoadedBoardName(env.board)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBoard({ panels: [] })
          setLoadedBoardName(env.board)
        }
      })
    return () => {
      cancelled = true
    }
  }, [env.board, env.proxyPath])

  useEffect(() => {
    if (!board || loadedBoardName !== env.board) return
    let cancelled = false
    const timers: number[] = []

    for (const panel of board.panels) {
      if (panel.type !== 'pipeline-status') continue

      let inFlight = false
      const refreshMillis = resolveRefreshMillis({
        boardDefaultMillis: parseDuration(board.refresh ?? '60s') ?? 60_000,
        panelOverrideMillis: panel.refresh
          ? (parseDuration(panel.refresh) ?? undefined)
          : undefined,
        adapterFloorMillis: 0,
      })

      const refresh = () => {
        if (cancelled || inFlight) return
        inFlight = true
        fetch(
          `${env.proxyPath}/panel/${encodeURIComponent(env.board)}/${encodeURIComponent(panel.id)}`,
        )
          .then((response) => (response.status === 304 ? undefined : response.json()))
          .then((value: unknown) => {
            const envelope = parseEnvelope(value)
            if (!cancelled && envelope)
              setSignals((current) => ({ ...current, [panel.id]: envelope }))
          })
          .catch(() => undefined)
          .finally(() => {
            inFlight = false
          })
      }

      refresh()
      timers.push(window.setInterval(refresh, refreshMillis))
    }
    return () => {
      cancelled = true
      for (const timer of timers) window.clearInterval(timer)
    }
  }, [board, env.board, env.proxyPath, loadedBoardName])

  return (
    <div className="board">
      <header className="board__header">
        <h1 className="board__title">{env.board}</h1>
        <dl className="board__meta">
          <div>
            <dt>client</dt>
            <dd>{env.clientVersion}</dd>
          </div>
          <div>
            <dt>assets</dt>
            <dd>{env.assetPath}</dd>
          </div>
        </dl>
      </header>

      <main className="board__grid">
        {!board && <PanelPlaceholder label="board" hint="Loading configuration…" wide />}
        {board?.panels.map((panel) =>
          panel.type === 'pipeline-status' ? (
            <PipelinePanel key={panel.id} panel={panel} data={signals[panel.id]} />
          ) : (
            <PanelPlaceholder key={panel.id} label={panel.type} hint="Not wired yet" wide />
          ),
        )}
      </main>

      <footer className="board__footer">
        Signals are read live from their configured authorities.
      </footer>
    </div>
  )
}
