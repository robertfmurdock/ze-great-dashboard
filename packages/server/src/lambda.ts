import type { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import type { AppEnvironment } from './app.ts'
import { startup } from './startup.ts'
import { StartupFailure } from './startup-failure.ts'

/**
 * The Lambda entry point. Same app, same startup checks — only the invocation differs.
 *
 * On serverless, "boot" is cold start, so a bad ASSET_PATH becomes a first-request failure with
 * the same clear message rather than a refusal to start. The promise is held (not awaited at
 * module scope) so a failure is retried on the next invocation instead of being cached forever.
 */
let pending: Promise<Hono<AppEnvironment>> | undefined

function bootstrap(): Promise<Hono<AppEnvironment>> {
  pending ??= startup()
    .then(({ app }) => app)
    .catch((error: unknown) => {
      pending = undefined
      throw error
    })
  return pending
}

export const handler = handle({
  fetch: async (request: Request) => {
    let app: Hono<AppEnvironment>
    try {
      app = await bootstrap()
    } catch (error) {
      if (!(error instanceof StartupFailure)) throw error
      return Response.json(
        {
          code: 'dashboard_startup_failed',
          guidance:
            'Find server.startup_failed in the server logs using this support reference. Correct the configuration or deployment and redeploy.',
          supportReference: error.diagnostic.supportReference,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return app.fetch(request)
  },
} as Hono)
