import type { Auth } from '@ze-great-dashboard/shared'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { createAccessTokenVerifier, unauthorizedSubject } from '../src/oidc-auth.ts'

const auth: Auth = {
  issuer: 'https://issuer.example.test',
  client_id: 'dashboard-spa',
  audience: 'https://dashboard-api.example.test',
  allow: { subjects: ['allowed-user'] },
}

describe('OIDC API access-token verification', () => {
  it('uses discovery and JWKS to accept only a correctly signed allowed API token', async () => {
    const keys = await generateKeyPair('RS256')
    const publicKey = await exportJWK(keys.publicKey)
    publicKey.kid = 'key-1'
    const calls: string[] = []
    const fetcher = (async (input: string | URL) => {
      calls.push(String(input))
      if (String(input).endsWith('/.well-known/openid-configuration'))
        return Response.json({ issuer: auth.issuer, jwks_uri: `${auth.issuer}/keys` })
      return Response.json({ keys: [publicKey] })
    }) as typeof fetch
    const verifier = await createAccessTokenVerifier(auth, fetcher)
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuer(auth.issuer)
      .setAudience(auth.audience)
      .setSubject('allowed-user')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey)

    await expect(verifier(token)).resolves.toEqual({ subject: 'allowed-user' })
    expect(calls).toEqual([
      `${auth.issuer}/.well-known/openid-configuration`,
      `${auth.issuer}/keys`,
    ])
  })

  it('distinguishes an authenticated but unlisted subject from an invalid token', async () => {
    const keys = await generateKeyPair('RS256')
    const publicKey = await exportJWK(keys.publicKey)
    publicKey.kid = 'key-1'
    const fetcher = (async (input: string | URL) =>
      Response.json(
        String(input).endsWith('configuration')
          ? { issuer: auth.issuer, jwks_uri: `${auth.issuer}/keys` }
          : { keys: [publicKey] },
      )) as typeof fetch
    const verifier = await createAccessTokenVerifier(auth, fetcher)
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuer(auth.issuer)
      .setAudience(auth.audience)
      .setSubject('someone-else')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey)
    await verifier(token).catch((error: unknown) => expect(unauthorizedSubject(error)).toBe(true))
  })

  it('accepts a provider issuer with a trailing slash when configuration omits it', async () => {
    const keys = await generateKeyPair('RS256')
    const publicKey = await exportJWK(keys.publicKey)
    publicKey.kid = 'key-1'
    const providerIssuer = `${auth.issuer}/`
    const fetcher = (async (input: string | URL) =>
      String(input).endsWith('configuration')
        ? Response.json({ issuer: providerIssuer, jwks_uri: `${providerIssuer}keys` })
        : Response.json({ keys: [publicKey] })) as typeof fetch
    const verifier = await createAccessTokenVerifier(auth, fetcher)
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuer(providerIssuer)
      .setAudience(auth.audience)
      .setSubject('allowed-user')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey)

    await expect(verifier(token)).resolves.toEqual({ subject: 'allowed-user' })
  })
})
