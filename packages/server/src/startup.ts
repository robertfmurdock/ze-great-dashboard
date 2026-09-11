import {
  type BoardConfig,
  credentialEnvironmentNames,
  schemaUrlForAssetPath,
} from '@ze-great-dashboard/shared'
import type { Hono } from 'hono'
import { deriveValidatedAllowlist } from './allowlist.ts'
import { type AppEnvironment, createApp } from './app.ts'
import { createBlockedApp } from './blocked-app.ts'
import { loadBoardConfig } from './board-config.ts'
import { isLocalHost, loadConfig, type ServerConfig } from './config.ts'
import { ConfigurationError } from './configuration-error.ts'
import { createCredentialResolver } from './credentials.ts'
import { consoleLogger, type ServerLogger } from './logger.ts'
import { createAccessTokenVerifier } from './oidc-auth.ts'
import { deploymentSecurityState } from './security-posture.ts'
import { StartupFailure, type StartupFailureCategory } from './startup-failure.ts'
import { type Fetcher, fetchTemplate } from './template.ts'

export type StartupResult = {
  app: Hono<AppEnvironment>
  config: ServerConfig
}

export { deploymentSecurityState } from './security-posture.ts'

/**
 * Boots the app: validate configuration, prove the template is reachable, warn about anything
 * that deserves a warning. Shared by both entry points so the container and Lambda cannot drift
 * in what they consider a valid start.
 */
export async function startup(
  options: { fetcher?: Fetcher; logger?: ServerLogger } = {},
): Promise<StartupResult> {
  const logger = options.logger ?? consoleLogger
  logger.log({
    event: 'server.starting',
    serverVersion: process.env.SERVER_RELEASE ?? 'development',
  })
  let category: StartupFailureCategory = 'configuration'
  try {
    const config = loadConfig()
    const fetcher = options.fetcher ?? globalThis.fetch

    // Local binds cannot enter the blocked posture, so retain the dev template-race behavior while
    // deployed binds read policy first. Required mode must never load a client template or source
    // capability before it can serve its safe configuration error.
    const localTemplate = isLocalHost(config.host)
      ? waitForTemplate(config, fetcher).then(
          () => undefined,
          (error: unknown) => new StartupFailure('template', error),
        )
      : undefined
    const boardConfig = await loadBoardConfig(
      config.boardConfigUrl,
      fetcher,
      config.assetPath.includes('__ASSET_PATH__')
        ? undefined
        : schemaUrlForAssetPath(config.assetPath),
    ).catch((error: unknown) => {
      throw new StartupFailure('board-config', error)
    })
    category = 'board-config'
    const board = selectBoard(config.board, boardConfig)
    const resolvedConfig = { ...config, board }
    const securityState = deploymentSecurityState(resolvedConfig, boardConfig)
    if (securityState === 'blocked') {
      logger.log({
        event: 'server.required_auth_missing',
        serverVersion: config.serverRelease,
        host: config.host,
        port: config.port,
      })
      return {
        app: createBlockedApp(),
        config: resolvedConfig,
      }
    }
    if (localTemplate) {
      const failure = await localTemplate
      if (failure) throw failure
    } else {
      await waitForTemplate(config, fetcher).catch((error: unknown) => {
        throw new StartupFailure('template', error)
      })
    }
    // Admission precedes credentials and all upstream access. The map is passed unchanged to the
    // app, so its immutable board config and its proxy capabilities are derived atomically.
    const allowlist = deriveValidatedAllowlist(boardConfig)
    const credentialNames = Object.values(boardConfig.sources).flatMap(credentialEnvironmentNames)
    category = 'credentials'
    const credentials = await createCredentialResolver({
      secretReference: config.secretReference,
      credentialNames,
    })

    category = 'authentication'
    const accessTokenVerifier = boardConfig.auth
      ? await createAccessTokenVerifier(boardConfig.auth, fetcher)
      : undefined

    category = 'unknown'
    if (securityState === 'warning') warnAboutMissingAuth(resolvedConfig, logger)

    return {
      app: createApp({
        config: resolvedConfig,
        fetcher,
        boardConfig,
        allowlist,
        credentials,
        logger,
        accessTokenVerifier,
      }),
      config: resolvedConfig,
    }
  } catch (error) {
    const failure = error instanceof StartupFailure ? error : new StartupFailure(category, error)
    logger.log({
      event: 'server.startup_failed',
      serverVersion: process.env.SERVER_RELEASE ?? 'development',
      ...failure.diagnostic,
    })
    throw failure
  }
}

export function selectBoard(requested: string | undefined, config: BoardConfig): string {
  if (requested) {
    if (!config.boards[requested]) {
      throw new ConfigurationError(
        `Board "${requested}" is not defined; available boards: ${Object.keys(config.boards).join(', ')}`,
        [
          {
            kind: 'board-selection',
            location: 'BOARD',
            constraint: 'Select a board defined in the configuration.',
          },
        ],
      )
    }
    return requested
  }
  const names = Object.keys(config.boards)
  if (names.length === 1 && names[0]) return names[0]
  throw new ConfigurationError(
    `BOARD is required when board configuration contains ${names.length} boards`,
    [
      {
        kind: 'board-selection',
        location: 'BOARD',
        constraint: 'Set BOARD to a configured board when more than one board exists.',
      },
    ],
  )
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
  logger.log({
    event: 'server.no_auth_warning',
    serverVersion: config.serverRelease,
    host: config.host,
    port: config.port,
  })
}
