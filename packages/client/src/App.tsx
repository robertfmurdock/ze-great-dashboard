import type { Board, ClientEnv, Envelope } from '@ze-great-dashboard/shared'
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
  const [signals, setSignals] = useState<Record<string, Envelope | undefined>>({})

  useEffect(() => {
    let cancelled = false
    fetch(`${env.proxyPath}/boards/${encodeURIComponent(env.board)}`)
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(`Board configuration returned ${response.status}`)),
      )
      .then((value: unknown) => {
        if (!cancelled) setBoard(value as Board)
      })
      .catch(() => {
        if (!cancelled) setBoard({ panels: [] })
      })
    return () => {
      cancelled = true
    }
  }, [env.board, env.proxyPath])

  useEffect(() => {
    if (!board) return
    let cancelled = false
    for (const panel of board.panels) {
      if (panel.type !== 'pipeline-status') continue
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
    }
    return () => {
      cancelled = true
    }
  }, [board, env.board, env.proxyPath])

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
