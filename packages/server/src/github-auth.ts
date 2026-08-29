import { createSign } from 'node:crypto'
import type { GithubActionsSource } from '@ze-great-dashboard/shared'
import type { CredentialResolver } from './credentials.ts'

type GithubTokenResponse = { token: string; expires_at: string }

export class GithubAuthenticationError extends Error {
  constructor() {
    super('GitHub authentication could not be completed.')
    this.name = 'GithubAuthenticationError'
  }
}

export type GithubClient = {
  get(args: {
    source: GithubActionsSource
    url: string
    requestHeaders: Headers
    fetcher: typeof fetch
  }): Promise<Response>
}

/** The sole server-side boundary for GitHub credentials and HTTP conventions. */
export function createGithubClient(
  credentials: CredentialResolver,
  now: () => number = Date.now,
): GithubClient {
  const tokens = new Map<string, { token: string; expiresAt: number }>()
  const pending = new Map<string, Promise<string>>()

  async function installationToken(
    source: GithubActionsSource,
    fetcher: typeof fetch,
    refresh = false,
  ) {
    const app = source.github_app
    if (!app) return undefined
    const appId = requiredCredential(credentials, app.app_id_env)
    const privateKey = requiredCredential(credentials, app.private_key_env)
    const installationId = requiredCredential(credentials, app.installation_id_env)
    const cacheKey = `${appId}:${installationId}:${app.private_key_env}`
    const cached = tokens.get(cacheKey)
    if (!refresh && cached && cached.expiresAt > now() + 60_000)
      return { token: cached.token, cacheKey }
    const existing = pending.get(cacheKey)
    if (existing) return { token: await existing, cacheKey }

    const exchange = exchangeInstallationToken({ appId, privateKey, installationId, fetcher, now })
      .then(({ token, expiresAt }) => {
        tokens.set(cacheKey, { token, expiresAt })
        return token
      })
      .catch((error: unknown) => {
        if (error instanceof GithubAuthenticationError) throw error
        throw new GithubAuthenticationError()
      })
    pending.set(cacheKey, exchange)
    try {
      return { token: await exchange, cacheKey }
    } finally {
      pending.delete(cacheKey)
    }
  }

  return {
    async get({ source, url, requestHeaders, fetcher }) {
      const headers = githubHeaders(requestHeaders)
      if (source.token_env)
        headers.set('authorization', `Bearer ${requiredCredential(credentials, source.token_env)}`)
      const appToken = await installationToken(source, fetcher)
      if (appToken) headers.set('authorization', `Bearer ${appToken.token}`)
      const response = await fetcher(url, { headers })
      if (!appToken || response.status !== 401) return response

      tokens.delete(appToken.cacheKey)
      const refreshed = await installationToken(source, fetcher, true)
      if (!refreshed) return response
      const replayHeaders = githubHeaders(requestHeaders)
      replayHeaders.set('authorization', `Bearer ${refreshed.token}`)
      return fetcher(url, { headers: replayHeaders })
    },
  }
}

function githubHeaders(requestHeaders: Headers): Headers {
  const headers = new Headers({ accept: 'application/vnd.github+json' })
  for (const name of ['if-none-match', 'if-modified-since']) {
    const value = requestHeaders.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

async function exchangeInstallationToken(args: {
  appId: string
  privateKey: string
  installationId: string
  fetcher: typeof fetch
  now: () => number
}): Promise<{ token: string; expiresAt: number }> {
  let jwt: string
  try {
    jwt = createAppJwt(args.appId, args.privateKey, args.now())
  } catch {
    throw new GithubAuthenticationError()
  }
  let response: Response
  try {
    response = await args.fetcher(
      `https://api.github.com/app/installations/${encodeURIComponent(args.installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: new Headers({
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        }),
      },
    )
  } catch {
    throw new GithubAuthenticationError()
  }
  if (!response.ok) throw new GithubAuthenticationError()
  const body = (await response.json()) as Partial<GithubTokenResponse>
  if (!body.token || !body.expires_at) throw new GithubAuthenticationError()
  const expiresAt = new Date(body.expires_at).valueOf()
  if (!Number.isFinite(expiresAt)) throw new GithubAuthenticationError()
  return { token: body.token, expiresAt }
}

export function createAppJwt(appId: string, privateKey: string, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000) - 60
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: appId }))
  const signingInput = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  return `${signingInput}.${base64url(signer.sign(privateKey))}`
}

function requiredCredential(credentials: CredentialResolver, name: string): string {
  const value = credentials.get(name)
  if (value) return value
  throw new GithubAuthenticationError()
}

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}
