import { type Auth, type Authorization, authorizationForAuth } from '@ze-great-dashboard/shared'
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import type { Fetcher } from './template.ts'

export type VerifiedIdentity = { subject: string }
export type AccessTokenVerifier = (token: string) => Promise<VerifiedIdentity>

/**
 * Discovers a provider once at boot, then verifies every API bearer token against its rotating
 * JWKS. Discovery and key retrieval share the injected fetcher so startup and tests exercise the
 * exact network boundary rather than trusting a copied issuer string.
 */
export async function createAccessTokenVerifier(
  auth: Auth,
  fetcher: Fetcher = globalThis.fetch,
): Promise<AccessTokenVerifier> {
  const configuredIssuer = auth.issuer.replace(/\/$/, '')
  const discovery = await fetchJson(`${configuredIssuer}/.well-known/openid-configuration`, fetcher)
  if (
    typeof discovery.issuer !== 'string' ||
    discovery.issuer.replace(/\/$/, '') !== configuredIssuer ||
    typeof discovery.jwks_uri !== 'string'
  ) {
    throw new Error('OIDC discovery must name the configured issuer and a JWKS URI.')
  }
  // JWT issuer validation uses the provider's exact value. Auth0 includes the trailing slash;
  // discovery comparison above deliberately tolerates whether the checked-in value includes it.
  const issuer = discovery.issuer
  let jwksUrl: URL
  try {
    jwksUrl = new URL(discovery.jwks_uri)
  } catch {
    throw new Error('OIDC discovery returned an invalid JWKS URI.')
  }
  const keys = createRemoteJWKSet(jwksUrl, { [customFetch]: fetcher })
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, { issuer, audience: auth.audience })
    if (typeof payload.sub !== 'string' || !payload.sub)
      throw new Error('Access token has no subject.')
    if (!permitsIdentity(authorizationForAuth(auth), payload.sub, payload)) {
      const error = new Error('Authenticated subject is not allowed to view this dashboard.')
      error.name = 'AccessDeniedError'
      throw error
    }
    return { subject: payload.sub }
  }
}

function permitsIdentity(
  policy: Authorization,
  subject: string,
  claims: Record<string, unknown>,
): boolean {
  if (policy.mode === 'authenticated') return true
  if (policy.mode === 'subjects') return policy.subjects.includes(subject)
  const value = claims[policy.claim]
  const actual =
    typeof value === 'string' && value.length > 0
      ? [value]
      : Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
        ? value
        : undefined
  if (!actual) return false
  return policy.match === 'any'
    ? policy.values.some((expected) => actual.includes(expected))
    : policy.values.every((expected) => actual.includes(expected))
}

async function fetchJson(
  url: string,
  fetcher: Fetcher,
): Promise<{ issuer?: unknown; jwks_uri?: unknown }> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`OIDC discovery request failed: ${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new Error('OIDC discovery did not return JSON.')
  }
}

export function accessDenied(error: unknown): boolean {
  return error instanceof Error && error.name === 'AccessDeniedError'
}
