import type { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import { startup } from './startup.ts'

/**
 * The Lambda entry point. Same app, same startup checks — only the invocation differs.
 *
 * On serverless, "boot" is cold start, so a bad ASSET_PATH becomes a first-request failure with
 * the same clear message rather than a refusal to start. The promise is held (not awaited at
 * module scope) so a failure is retried on the next invocation instead of being cached forever.
 */
let pending: Promise<Hono> | undefined

function bootstrap(): Promise<Hono> {
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
    const app = await bootstrap()
    return app.fetch(request)
  },
} as Hono)
