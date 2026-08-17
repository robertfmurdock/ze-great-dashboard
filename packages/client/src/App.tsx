import type { ClientEnv } from '@ze-great-dashboard/shared'
import { PanelPlaceholder } from './PanelPlaceholder.tsx'

/**
 * The board shell.
 *
 * Stage 1 has no data: there is no proxy endpoint to poll yet. What this proves is the plumbing —
 * that the client was handed its configuration by the server and knows which version of itself it
 * is. The version readout is what makes two published versions visibly different, which is the
 * whole point of the Stage 1 exit criterion.
 */
export function App({ env }: { env: ClientEnv }) {
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
        <PanelPlaceholder label="pipeline-status" hint="Stage 2" />
        <PanelPlaceholder label="pipeline-status" hint="Stage 3" />
        <PanelPlaceholder label="http-value" hint="Stage 4" wide />
      </main>

      <footer className="board__footer">
        No signals wired yet — this is the immutable shell. Panels arrive in Stage 2.
      </footer>
    </div>
  )
}
