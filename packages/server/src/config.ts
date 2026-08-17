import { z } from 'zod'

/**
 * Environment configuration for the server.
 *
 * Validated once at boot. A misconfiguration should fail like the misconfiguration it is, at the
 * moment someone can still see the logs — not as a 500 per request later.
 */
const configSchema = z.object({
  /**
   * Where the built client lives. Points at a versioned CDN path in a deployment
   * (`https://assets.../dashboard/1.0.7`) or at the Vite dev server locally. Trailing slashes are
   * trimmed so `${assetPath}/index.html` never doubles up.
   */
  assetPath: z
    .string({
      error: 'ASSET_PATH is required — the server has no client to serve without it.',
    })
    .min(1, 'ASSET_PATH is required — the server has no client to serve without it.')
    .transform((value) => value.replace(/\/+$/, '')),
  proxyPath: z.string().min(1).default('/api'),
  /** A URL or a local file path. Local development uses a path and needs no credential. */
  boardConfigUrl: z.string().min(1).default('./boards/example.yaml'),
  board: z.string().min(1).default('team-alpha'),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  host: z.string().min(1).default('localhost'),
  /**
   * How long to keep retrying an unreachable template before giving up, in milliseconds.
   *
   * Zero — the default, and what every deployment uses — means a bad ASSET_PATH fails on the first
   * attempt, which is the behavior a misconfiguration deserves. `npm run dev` sets a few seconds
   * because it starts the server and the Vite dev server at the same moment, and without this the
   * local loop is a race the developer loses about half the time.
   */
  templateWaitMillis: z.coerce.number().int().min(0).default(0),
})

export type ServerConfig = z.infer<typeof configSchema>

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const result = configSchema.safeParse({
    assetPath: env.ASSET_PATH,
    proxyPath: env.PROXY_PATH,
    boardConfigUrl: env.BOARD_CONFIG_URL,
    board: env.BOARD,
    port: env.PORT,
    host: env.HOST,
    templateWaitMillis: env.TEMPLATE_WAIT_MS,
  })

  if (!result.success) {
    throw new Error(`Invalid server configuration:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host)
}
