import {
  type BoardConfig,
  credentialEnvironmentNames,
  schemaUrlForAssetPath,
} from '@ze-great-dashboard/shared'
import type { Hono } from 'hono'
import { deriveValidatedAllowlist } from './allowlist.ts'
import { type AppEnvironment, createApp } from './app.ts'
import { loadBoardConfig } from './board-config.ts'
import { isLocalHost, loadConfig, type ServerConfig } from './config.ts'
import { createCredentialResolver } from './credentials.ts'
import { consoleLogger, type ServerLogger } from './logger.ts'
import { type Fetcher, fetchTemplate } from './template.ts'

export type StartupResult = {
  app: Hono<AppEnvironment>
  config: ServerConfig
}

/**
 * Boots the app: validate configuration, prove the template is reachable, warn about anything
 * that deserves a warning. Shared by both entry points so the container and Lambda cannot drift
 * in what they consider a valid start.
 */
export async function startup(
  options: { fetcher?: Fetcher; logger?: ServerLogger } = {},
): Promise<StartupResult> {
  const logger = options.logger ?? consoleLogger
  logger.log({ event: 'server.starting' })
  try {
    const config = loadConfig()
    const fetcher = options.fetcher ?? globalThis.fetch

    // Fail at boot rather than serving a 500 per request. A typo'd ASSET_PATH should fail like the
    // misconfiguration it is, while someone is still watching the logs.
    // These independent reads happen together so a remote board config does not wait behind the
    // client template fetch. Startup still completes only after both have succeeded.
    const [, boardConfig] = await Promise.all([
      waitForTemplate(config, fetcher),
      loadBoardConfig(
        config.boardConfigUrl,
        fetcher,
        config.assetPath.includes('__ASSET_PATH__')
          ? undefined
          : schemaUrlForAssetPath(config.assetPath),
      ),
    ])
    const board = selectBoard(config.board, boardConfig)
    const resolvedConfig = { ...config, board }
    // Admission precedes credentials and all upstream access. The map is passed unchanged to the
    // app, so its immutable board config and its proxy capabilities are derived atomically.
    const allowlist = deriveValidatedAllowlist(boardConfig)
    const credentialNames = Object.values(boardConfig.sources).flatMap(credentialEnvironmentNames)
    const credentials = await createCredentialResolver({
      secretReference: config.secretReference,
      credentialNames,
    })

    warnAboutMissingAuth(resolvedConfig, logger)

    return {
      app: createApp({
        config: resolvedConfig,
        fetcher,
        boardConfig,
        allowlist,
        credentials,
        logger,
      }),
      config: resolvedConfig,
    }
  } catch (error) {
    logger.log({ event: 'server.startup_failed', category: startupFailureCategory(error) })
    throw error
  }
}

export function selectBoard(requested: string | undefined, config: BoardConfig): string {
  if (requested) {
    if (!config.boards[requested]) {
      throw new Error(
        `Board "${requested}" is not defined; available boards: ${Object.keys(config.boards).join(', ')}`,
      )
    }
    return requested
  }
  const names = Object.keys(config.boards)
  if (names.length === 1 && names[0]) return names[0]
  throw new Error(`BOARD is required when board configuration contains ${names.length} boards`)
}

/**
 * Fetches the template, optionally retrying for up to `templateWaitMillis`.
 *
 * The retry exists for exactly one situation: `npm run dev` starts this server and the Vite dev
 * server simultaneously, and whichever loses the race would otherwise kill the whole loop. Every
 * deployment leaves the window at zero, so a bad ASSET_PATH there still fails on the first
 * attempt. The last error is rethrown unchanged — waiting must not blur what actually went wrong.
 */
async function waitForTemplate(config: ServerConfig, fetcher: Fetcher): Promise<void> {
  const deadline = config.templateWaitMillis
  let waited = 0
  let announced = false

  for (;;) {
    try {
      await fetchTemplate(config.assetPath, fetcher)
      return
    } catch (error) {
      if (waited >= deadline) throw error
      if (!announced) {
        console.log(`Waiting for the client at ${config.assetPath} …`)
        announced = true
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MILLIS))
      waited += RETRY_INTERVAL_MILLIS
    }
  }
}

const RETRY_INTERVAL_MILLIS = 250

/**
 * Auth is controlled by the presence or absence of an `auth` section, not by a deployment mode
 * flag. Absent plus a nonlocal bind is the case that deserves noise.
 *
 * Stage 1 has no auth section to read yet, so this warns purely on the bind address. When the
 * board config's `auth` block is wired in, the condition gains its second half.
 */
function warnAboutMissingAuth(config: ServerConfig, logger: ServerLogger): void {
  if (isLocalHost(config.host)) return
  logger.log({ event: 'server.no_auth_warning', host: config.host, port: config.port })
}

function startupFailureCategory(
  error: unknown,
): 'configuration' | 'template' | 'board-config' | 'credentials' | 'unknown' {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('server configuration')) return 'configuration'
  if (message.includes('ASSET_PATH') || message.includes('<head>')) return 'template'
  if (message.includes('board') || message.includes('Board')) return 'board-config'
  if (message.includes('credential') || message.includes('secret')) return 'credentials'
  return 'unknown'
}
