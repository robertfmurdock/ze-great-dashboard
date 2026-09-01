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
import { fetchAzureDevOpsPipeline } from './adapters/azure-devops.ts'
import {
  fetchGithubActionsPipeline,
  fetchGithubActionsPullRequestBuild,
  fetchGithubActionsPullRequestCandidates,
  fetchGithubActionsUpdateWorkflow,
  pullRequestHealthCapabilities,
} from './adapters/github-actions.ts'
import { fetchHttpValue } from './adapters/http-value.ts'
import { deriveAllowlist, type PanelOperation, permitsPanelOperation } from './allowlist.ts'
import type { ServerConfig } from './config.ts'
import { type CredentialResolver, environmentCredentials } from './credentials.ts'
import { createGithubClient } from './github-auth.ts'
import { consoleLogger, destinationOrigin, requestId, type ServerLogger } from './logger.ts'
import { renderIndexHtml } from './render.ts'
import { type Fetcher, TemplateCache } from './template.ts'
import { type AdapterResult, adapterRouteResponse } from './upstream.ts'

export type AppDependencies = {
  config: ServerConfig
  /**
   * Injected rather than imported, which is what makes the template behavior testable without a
   * network. The same reasoning applies to adapters in Stage 2.
   */
  fetcher?: Fetcher
  boardConfig?: BoardConfig
  /** Derived atomically with board admission at production startup. */
  allowlist?: Map<string, Set<PanelOperation>>
  /** Resolved at boot, never serialized into HTML or API payloads. */
  credentials?: CredentialResolver
  logger?: ServerLogger
}

export type AppEnvironment = { Variables: { dashboardRequestId: string } }
type ObservationContext = {
  boardId: string
  panelId: string
  operation: string
  sourceName?: string
  sourceType?: string
  destination?: string
}

export function createApp(deps: AppDependencies): Hono<AppEnvironment> {
  const { config } = deps
  const templates = new TemplateCache(deps.fetcher ?? globalThis.fetch)
  const selectedBoard =
    config.board ?? Object.keys(deps.boardConfig?.boards ?? {})[0] ?? 'ze-great-team'
  const allowlist =
    deps.allowlist ?? (deps.boardConfig ? deriveAllowlist(deps.boardConfig) : new Map())
  const credentials = deps.credentials ?? environmentCredentials()
  const githubClient = createGithubClient(credentials)
  const logger = deps.logger ?? consoleLogger
  const app = new Hono<AppEnvironment>()

  app.use('/api/*', async (c, next) => {
    const id = requestId()
    c.set('dashboardRequestId', id)
    await next()
    c.header('x-dashboard-request-id', id)
  })
  app.onError((_error, c) => {
    const id = c.get('dashboardRequestId')
    logger.log({
      event: 'server.unhandled_exception',
      ...(id ? { requestId: id } : {}),
      operation: 'route-handler',
    })
    return c.json(
      { error: 'The dashboard could not complete this request.' },
      500,
      id ? { 'x-dashboard-request-id': id } : undefined,
    )
  })

  app.get('/health', (c) => c.json({ status: 'ok' }))

  // AUTHORIZATION_BOUNDARY: the public initial deployment is intentionally authless. Keep this
  // middleware immediately before dashboard/API routes so an Auth0 or gateway check can be added
  // without changing packaging, route handlers, or the client contract.
  app.get(`${config.proxyPath}/client`, (c) => {
    const identity: ClientIdentity = { assetPath: config.assetPath }
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
    c: Context<AppEnvironment, '/api/boards/:board/rendered'>,
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
      !permitsPanelOperation(allowlist, boardName, panelId, 'read')
    )
      return rejected(c, { boardId: boardName, panelId, operation: 'read' })

    if (panel.type === 'pipeline-status' && source?.type === 'github-actions' && source) {
      const result = fetchGithubActionsPipeline({
        panel,
        source,
        requestHeaders: c.req.raw.headers,
        fetcher: deps.fetcher ?? globalThis.fetch,
        githubClient,
      })
      return observation(c, result, {
        boardId: boardName,
        panelId,
        operation: 'read',
        sourceName: panel.source,
        sourceType: source.type,
        destination: 'https://api.github.com',
      })
    }
    if (panel.type === 'pipeline-status' && source?.type === 'azure-devops' && source) {
      const result = fetchAzureDevOpsPipeline({
        panel,
        source,
        requestHeaders: c.req.raw.headers,
        fetcher: deps.fetcher ?? globalThis.fetch,
        credentials,
      })
      return observation(c, result, {
        boardId: boardName,
        panelId,
        operation: 'read',
        sourceName: panel.source,
        sourceType: source.type,
        destination: 'https://dev.azure.com',
      })
    }
    if (panel.type === 'pull-request-health')
      return rejected(c, { boardId: boardName, panelId, operation: 'read' })
    if (panel.type === 'http-value') {
      const result = fetchHttpValue({
        panel,
        requestHeaders: c.req.raw.headers,
        fetcher: deps.fetcher ?? globalThis.fetch,
      })
      return observation(c, result, {
        boardId: boardName,
        panelId,
        operation: 'read',
        destination: panel.url,
      })
    }
    return c.notFound()
  })

  app.get('/api/panel/:board/:panelId/pull-requests', async (c) => {
    const resolved = pullRequestPanel(c.req.param('board'), c.req.param('panelId'), 'pull-requests')
    if (!resolved)
      return rejected(c, {
        boardId: c.req.param('board'),
        panelId: c.req.param('panelId'),
        operation: 'pull-requests',
      })
    return observation(
      c,
      fetchGithubActionsPullRequestCandidates({
        ...resolved,
        requestHeaders: c.req.raw.headers,
        fetcher: deps.fetcher ?? globalThis.fetch,
        githubClient,
      }),
      {
        boardId: c.req.param('board'),
        panelId: c.req.param('panelId'),
        operation: 'pull-requests',
        sourceName: resolved.panel.source,
        sourceType: resolved.source.type,
        destination: 'https://api.github.com',
      },
    )
  })
  app.get('/api/panel/:board/:panelId/update-workflow/:workflow', async (c) => {
    const resolved = pullRequestPanel(
      c.req.param('board'),
      c.req.param('panelId'),
      'update-workflow',
    )
    const workflow = c.req.param('workflow')
    if (!resolved?.capabilities.configuredUpdateWorkflow(workflow))
      return rejected(c, {
        boardId: c.req.param('board'),
        panelId: c.req.param('panelId'),
        operation: 'update-workflow',
      })
    return observation(
      c,
      fetchGithubActionsUpdateWorkflow({
        ...resolved,
        workflow,
        requestHeaders: c.req.raw.headers,
        fetcher: deps.fetcher ?? globalThis.fetch,
        githubClient,
      }),
      {
        boardId: c.req.param('board'),
        panelId: c.req.param('panelId'),
        operation: 'update-workflow',
        sourceName: resolved.panel.source,
        sourceType: resolved.source.type,
        destination: 'https://api.github.com',
      },
    )
  })
  app.get('/api/panel/:board/:panelId/pull-request-build', async (c) => {
    const resolved = pullRequestPanel(
      c.req.param('board'),
      c.req.param('panelId'),
      'pull-request-build',
    )
    const branch = c.req.query('branch')
    if (!resolved || !branch || !resolved.capabilities.permitsBuildBranch(branch))
      return rejected(c, {
        boardId: c.req.param('board'),
        panelId: c.req.param('panelId'),
        operation: 'pull-request-build',
      })
    return observation(
      c,
      fetchGithubActionsPullRequestBuild({
        ...resolved,
        branch,
        requestHeaders: c.req.raw.headers,
        fetcher: deps.fetcher ?? globalThis.fetch,
        githubClient,
      }),
      {
        boardId: c.req.param('board'),
        panelId: c.req.param('panelId'),
        operation: 'pull-request-build',
        sourceName: resolved.panel.source,
        sourceType: resolved.source.type,
        destination: 'https://api.github.com',
      },
    )
  })

  function pullRequestPanel(boardName: string, panelId: string, operation: PanelOperation) {
    const panel = deps.boardConfig?.boards[boardName]?.panels.find(
      (candidate) => candidate.id === panelId,
    )
    const source = panel?.source ? deps.boardConfig?.sources[panel.source] : undefined
    const capabilities =
      panel?.type === 'pull-request-health' ? pullRequestHealthCapabilities(panel) : undefined
    if (!capabilities) return undefined
    return panel?.type === 'pull-request-health' &&
      source?.type === 'github-actions' &&
      permitsPanelOperation(allowlist, boardName, panelId, operation)
      ? { panel, source, capabilities }
      : undefined
  }

  function rejected(c: Context<AppEnvironment>, context: ObservationContext) {
    logger.log({
      event: 'api.operation_rejected',
      requestId: c.get('dashboardRequestId'),
      boardId: context.boardId,
      panelId: context.panelId,
      operation: context.operation,
    })
    return c.notFound()
  }

  async function observation(
    c: Context<AppEnvironment>,
    result: Promise<AdapterResult> | AdapterResult,
    context: ObservationContext,
  ) {
    const started = performance.now()
    const resolved = await result
    const adapted = await adapterRouteResponse(resolved)
    if (adapted.envelope?.state === 'error') {
      logger.log({
        event: 'panel.observation_failed',
        requestId: c.get('dashboardRequestId'),
        boardId: context.boardId,
        panelId: context.panelId,
        operation: context.operation,
        errorKind: adapted.envelope.error.kind,
        elapsedMs: Math.round(performance.now() - started),
        ...(context.sourceName ? { sourceName: context.sourceName } : {}),
        ...(context.sourceType ? { sourceType: context.sourceType } : {}),
        ...(destinationOrigin(context.destination)
          ? { destinationOrigin: destinationOrigin(context.destination) }
          : {}),
        ...(resolved.failure?.upstreamStatus
          ? { upstreamStatus: resolved.failure.upstreamStatus }
          : {}),
        ...(resolved.failure?.networkCode ? { networkCode: resolved.failure.networkCode } : {}),
      })
    }
    return adapted.response
  }

  async function renderEntrypoint(_request: Request, board: string): Promise<Response> {
    const template = await templates.get(config.assetPath)
    const env: ClientEnv = {
      assetPath: config.assetPath,
      proxyPath: config.proxyPath,
      board,
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
