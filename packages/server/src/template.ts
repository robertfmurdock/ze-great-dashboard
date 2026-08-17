/**
 * The entrypoint template.
 *
 * The template is published alongside the assets it references, at `{assetPath}/index.html`, and
 * fetched from there at runtime rather than baked into the server image. This is what makes
 * "point at a different client version" a one-variable change: the template names the build's
 * hashed filenames, so it is only ever correct for the version it shipped with. Baking it in
 * would silently mean "serve that version's assets using this version's filenames", which fails
 * in the most confusing way available.
 */

/**
 * The build writes this token wherever it would have written a base path (Vite `base`). The
 * server's only rewriting is replacing it with the real asset path. It is a sentinel, not an
 * environment value, so the published artifact stays immutable and environment-free.
 *
 * `<base href>` is deliberately not used: it would repoint *every* relative URL including
 * root-relative ones like `/api`, sending proxy calls to the CDN and failing at runtime.
 */
export const ASSET_PATH_SENTINEL = '/__ASSET_PATH__'

export class TemplateFetchError extends Error {
  constructor(assetPath: string, reason: string) {
    super(
      `Unable to fetch the client template from ${assetPath}/index.html — ${reason}\n` +
        'The server cannot serve a client it cannot find. Check ASSET_PATH points at a published ' +
        'client version (or a running Vite dev server).',
    )
    this.name = 'TemplateFetchError'
  }
}

export type Fetcher = typeof globalThis.fetch

export async function fetchTemplate(assetPath: string, fetcher: Fetcher): Promise<string> {
  const url = `${assetPath}/index.html`

  let response: Response
  try {
    response = await fetcher(url)
  } catch (cause) {
    throw new TemplateFetchError(assetPath, `the request failed: ${describe(cause)}`)
  }

  if (!response.ok) {
    throw new TemplateFetchError(assetPath, `responded ${response.status} ${response.statusText}`)
  }

  const body = await response.text()
  if (body.trim() === '') {
    throw new TemplateFetchError(assetPath, 'the response body was empty')
  }
  if (!HEAD_PATTERN.test(body)) {
    // Caught at boot rather than per-request: there is nowhere to inject configuration, so every
    // response would be a 500. That's a broken build, and it should look like one immediately.
    throw new TemplateFetchError(assetPath, 'the document has no <head> element to configure')
  }
  return body
}

const HEAD_PATTERN = /<head[^>]*>/i

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Caches the template in memory, keyed by asset path.
 *
 * This is the one thing the server holds that resembles state, and it doesn't violate the
 * no-persistence rule: a given version's template is immutable, so there is nothing to
 * invalidate and no staleness question. It is reconstructible from its URL and lost freely on
 * restart. Keying by asset path means repointing at a new version can't serve the old template.
 */
export class TemplateCache {
  private readonly entries = new Map<string, Promise<string>>()

  constructor(private readonly fetcher: Fetcher) {}

  get(assetPath: string): Promise<string> {
    const existing = this.entries.get(assetPath)
    if (existing) return existing

    const pending = fetchTemplate(assetPath, this.fetcher).catch((error: unknown) => {
      // Don't cache a failure — a transient network blip shouldn't poison the process for good.
      this.entries.delete(assetPath)
      throw error
    })
    this.entries.set(assetPath, pending)
    return pending
  }
}
