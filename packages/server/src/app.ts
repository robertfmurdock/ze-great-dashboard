import {
  type BoardConfig,
  boardSchemaModeline,
  type ClientEnv,
  type ClientIdentity,
  normalizeBoardLayout,
  schemaUrlForAssetPath,
} from '@ze-great-dashboard/shared'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { stringify as stringifyYaml } from 'yaml'
import {
  fetchGithubActionsPipeline,
  fetchGithubActionsPullRequestHealth,
} from './adapters/github-actions.ts'
import { fetchHttpValue } from './adapters/http-value.ts'
import { deriveAllowlist } from './allowlist.ts'
import type { ServerConfig } from './config.ts'
import { type CredentialResolver, environmentCredentials } from './credentials.ts'
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
  boardConfig?: BoardConfig
  /** Resolved at boot, never serialized into HTML or API payloads. */
  credentials?: CredentialResolver
}

export function createApp(deps: AppDependencies): Hono {
  const { config } = deps
  const templates = new TemplateCache(deps.fetcher ?? globalThis.fetch)
  const clientVersion = deps.clientVersion ?? deriveVersionLabel(config.assetPath)
  const selectedBoard =
    config.board ?? Object.keys(deps.boardConfig?.boards ?? {})[0] ?? 'ze-great-team'
  const allowlist = deps.boardConfig ? deriveAllowlist(deps.boardConfig) : new Map()
  const credentials = deps.credentials ?? environmentCredentials()

  const app = new Hono()

  app.get('/health', (c) => c.json({ status: 'ok' }))

  // AUTHORIZATION_BOUNDARY: the public initial deployment is intentionally authless. Keep this
  // middleware immediately before dashboard/API routes so an Auth0 or gateway check can be added
  // without changing packaging, route handlers, or the client contract.
  app.use('/api/*', async (_c, next) => next())

  app.get(`${config.proxyPath}/client`, (c) => {
    const identity: ClientIdentity = { assetPath: config.assetPath, clientVersion }
    return c.json(identity, 200, { 'cache-control': 'no-store' })
  })

  app.get('/', (c) => renderEntrypoint(c.req.raw, selectedBoard))
  app.get('/boards/:board', (c) => renderEntrypoint(c.req.raw, c.req.param('board')))
  app.get('/api/boards/:board', (c) => {
    const board = deps.boardConfig?.boards[c.req.param('board')]
    if (!board) return c.notFound()
    // The branch is public source metadata, not a credential. Returning it with the board lets
    // the browser keep histories separate when one panel's source branch changes.
    return c.json({
      ...board,
      panels: board.panels.map((panel) => {
        const source = panel.source ? deps.boardConfig?.sources[panel.source] : undefined
        return source && 'branch' in source && typeof source.branch === 'string'
          ? { ...panel, branch: source.branch }
          : panel
      }),
    })
  })
  const layoutDownload = (
    c: Context<Record<string, never>, '/api/boards/:board/rendered'>,
    mode: 'rendered' | 'authored',
  ) => {
    const boardName = c.req.param('board')
    const board = deps.boardConfig?.boards[boardName]
    if (!board || !deps.boardConfig) return c.notFound()

    const sourceNames = new Set(
      board.panels.flatMap((panel) => (panel.source ? [panel.source] : [])),
    )
    const sources = Object.fromEntries(
      [...sourceNames].flatMap((sourceName) => {
        const source = deps.boardConfig?.sources[sourceName]
        return source ? [[sourceName, source]] : []
      }),
    )
    const outputBoard = {
      ...board,
      panels: mode === 'authored' ? board.panels : normalizeBoardLayout(board.panels),
    }
    const outputConfig = {
      sources,
      boards: { [boardName]: outputBoard },
      ...(deps.boardConfig.auth ? { auth: deps.boardConfig.auth } : {}),
    }

    const filenameBoard = safeDownloadFilename(boardName)
    return new Response(
      `${boardSchemaModeline(schemaUrlForAssetPath(config.assetPath))}\n${stringifyYaml(outputConfig, { sortMapEntries: true })}`,
      {
        headers: {
          'content-type': 'text/yaml; charset=utf-8',
          'content-disposition': `attachment; filename="${filenameBoard}-layout-${mode}.yaml"`,
        },
      },
    )
  }
  app.get('/api/boards/:board/rendered', (c) => layoutDownload(c, 'rendered'))
  app.get('/api/boards/:board/authored', (c) => layoutDownload(c, 'authored'))
  app.get('/api/panel/:board/:panelId', async (c) => {
    const boardName = c.req.param('board')
    const panelId = c.req.param('panelId')
    const board = deps.boardConfig?.boards[boardName]
    const panel = board?.panels.find((candidate) => candidate.id === panelId)
    const source = panel?.source ? deps.boardConfig?.sources[panel.source] : undefined
    if (
      !panel ||
      (panel.type !== 'http-value' && !source) ||
      !allowlist.has(`${boardName}/${panelId}`)
    )
      return c.notFound()

    if (panel.type === 'pipeline-status' && source?.type === 'github-actions' && source) {
      const result = await fetchGithubActionsPipeline({
        panel,
        source,
        requestHeaders: c.req.raw.headers,
        fetcher: deps.fetcher ?? globalThis.fetch,
        credentials,
      })
      const headers = passthroughHeaders(result.response.headers)
      if (result.response.status === 304) return new Response(null, { status: 304, headers })
      const envelope = result.envelope ?? JSON.parse(await result.response.text())
      headers.set('content-type', 'application/json; charset=utf-8')
      return new Response(JSON.stringify(envelope), { status: 200, headers })
    }
    if (panel.type === 'pull-request-health' && source?.type === 'github-actions' && source) {
      const result = await fetchGithubActionsPullRequestHealth({
        panel,
        source,
        requestHeaders: c.req.raw.headers,
        fetcher: deps.fetcher ?? globalThis.fetch,
        credentials,
      })
      const headers = passthroughHeaders(result.response.headers)
      const envelope = result.envelope ?? JSON.parse(await result.response.text())
      headers.set('content-type', 'application/json; charset=utf-8')
      return new Response(JSON.stringify(envelope), { status: 200, headers })
    }
    if (panel.type === 'http-value') {
      const result = await fetchHttpValue({
        panel,
        requestHeaders: c.req.raw.headers,
        fetcher: deps.fetcher ?? globalThis.fetch,
      })
      const headers = passthroughHeaders(result.response.headers)
      if (result.response.status === 304) return new Response(null, { status: 304, headers })
      const envelope = result.envelope ?? JSON.parse(await result.response.text())
      headers.set('content-type', 'application/json; charset=utf-8')
      return new Response(JSON.stringify(envelope), { status: 200, headers })
    }
    return c.notFound()
  })

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

function safeDownloadFilename(value: string): string {
  const sanitized = value.replace(/[\\/\r\n"%*:|<>?]/g, '_').trim()
  return sanitized || 'board'
}

function passthroughHeaders(upstream: Headers): Headers {
  const headers = new Headers()
  for (const name of ['cache-control', 'etag', 'last-modified', 'date', 'vary']) {
    const value = upstream.get(name)
    if (value) headers.set(name, value)
  }
  return headers
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
