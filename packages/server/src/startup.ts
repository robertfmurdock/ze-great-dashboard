import type { Hono } from 'hono'
import { createApp } from './app.ts'
import { isLocalHost, loadConfig, type ServerConfig } from './config.ts'
import { type Fetcher, fetchTemplate } from './template.ts'

export type StartupResult = {
  app: Hono
  config: ServerConfig
}

/**
 * Boots the app: validate configuration, prove the template is reachable, warn about anything
 * that deserves a warning. Shared by both entry points so the container and Lambda cannot drift
 * in what they consider a valid start.
 */
export async function startup(options: { fetcher?: Fetcher } = {}): Promise<StartupResult> {
  const config = loadConfig()
  const fetcher = options.fetcher ?? globalThis.fetch

  // Fail at boot rather than serving a 500 per request. A typo'd ASSET_PATH should fail like the
  // misconfiguration it is, while someone is still watching the logs.
  await waitForTemplate(config, fetcher)

  warnAboutMissingAuth(config)

  return { app: createApp({ config, fetcher }), config }
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
function warnAboutMissingAuth(config: ServerConfig): void {
  if (isLocalHost(config.host)) return

  console.warn(
    '\n  ⚠️  No auth configured. This instance is accessible to anyone who can reach it.\n' +
      `     Bound to ${config.host}:${config.port}, which is not localhost.\n`,
  )
}
