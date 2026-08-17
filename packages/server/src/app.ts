import type { ClientEnv } from '@ze-great-dashboard/shared'
import { Hono } from 'hono'
import type { ServerConfig } from './config.ts'
import { renderIndexHtml } from './render.ts'
import { ASSET_PATH_SENTINEL, type Fetcher, TemplateCache } from './template.ts'

export type AppDependencies = {
  config: ServerConfig
  /**
   * Injected rather than imported, which is what makes the template behavior testable without a
   * network. The same reasoning applies to adapters in Stage 2.
   */
  fetcher?: Fetcher
  /** Surfaced in `window.env` so two published versions are visibly distinguishable. */
  clientVersion?: string
}

export function createApp(deps: AppDependencies): Hono {
  const { config } = deps
  const templates = new TemplateCache(deps.fetcher ?? globalThis.fetch)
  const clientVersion = deps.clientVersion ?? deriveVersionLabel(config.assetPath)

  const app = new Hono()

  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.get('/', (c) => renderEntrypoint(c.req.raw, config.board))
  app.get('/boards/:board', (c) => renderEntrypoint(c.req.raw, c.req.param('board')))

  async function renderEntrypoint(_request: Request, board: string): Promise<Response> {
    const template = await templates.get(config.assetPath)
    const env: ClientEnv = {
      assetPath: config.assetPath,
      proxyPath: config.proxyPath,
      board,
      clientVersion,
    }

    return new Response(renderIndexHtml(template, env), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Configuration must be able to change on a dime, so the entrypoint is never cached.
        // The assets it references are immutable and cached hard; this document is not.
        'cache-control': 'no-store',
      },
    })
  }

  return app
}

/**
 * The last path segment of a versioned asset path is the version (`.../dashboard/1.0.7`). This is
 * a display label only — nothing branches on it.
 *
 * Locally the last segment is the sentinel itself, since ASSET_PATH points at the Vite dev server.
 * Rendering "__ASSET_PATH__" as a version number would just look like a bug on screen.
 */
function deriveVersionLabel(assetPath: string): string {
  const segments = assetPath.split('/').filter((segment) => segment !== '')
  const last = segments.at(-1)
  if (last === undefined) return 'unknown'
  return last === ASSET_PATH_SENTINEL.replace('/', '') ? 'dev' : last
}
