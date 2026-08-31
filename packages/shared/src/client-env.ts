import { z } from 'zod'

/**
 * The `window.env` block the server injects into `index.html`.
 *
 * This is browser-visible by definition, so it may contain only public values. Anything secret
 * belongs in the proxy's environment and must never reach the template. The schema lives in the
 * shared package so the server's injection and the client's read are the same definition — a
 * typo'd key becomes a type error rather than an undefined at runtime.
 */
export const clientEnvSchema = z.object({
  /** Where the immutable client assets live. The one variable that repoints the whole client. */
  assetPath: z.string().min(1),
  /** Same-origin path the proxy is mounted at, so there is no CORS and no cookie problem. */
  proxyPath: z.string().min(1),
  /** Which board this is, resolved server-side so the client parses no URLs. */
  board: z.string().min(1),
  /** Omitted entirely when unauthenticated — presence is what turns auth on. */
  auth: z
    .object({
      issuer: z.string().min(1),
      clientId: z.string().min(1).optional(),
    })
    .optional(),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>

/** The public identity of the client currently selected by the server. */
export const clientIdentitySchema = clientEnvSchema.pick({ assetPath: true })

export type ClientIdentity = z.infer<typeof clientIdentitySchema>

declare global {
  interface Window {
    env?: unknown
  }
}

/**
 * Reads and validates `window.env`. Throws with a readable message rather than letting a missing
 * value surface later as a confusing render failure.
 */
export function readClientEnv(source: unknown = globalThis.window?.env): ClientEnv {
  const result = clientEnvSchema.safeParse(source)
  if (!result.success) {
    throw new Error(
      `window.env is missing or invalid — the server did not inject usable configuration.\n${z.prettifyError(result.error)}`,
    )
  }
  return result.data
}
