import type { Auth } from '@ze-great-dashboard/shared'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { accessDenied, createAccessTokenVerifier } from '../src/oidc-auth.ts'

const auth: Auth = {
  issuer: 'https://issuer.example.test',
  client_id: 'dashboard-spa',
  audience: 'https://dashboard-api.example.test',
  allow: { subjects: ['allowed-user'] },
}

const authenticatedAuth: Auth = {
  issuer: auth.issuer,
  client_id: auth.client_id,
  audience: auth.audience,
  authorization: { mode: 'authenticated' },
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
    await verifier(token).catch((error: unknown) => expect(accessDenied(error)).toBe(true))
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

  it('admits an authenticated API token with a subject under authenticated policy', async () => {
    const { verifier, keys } = await verifierFor(authenticatedAuth)
    await expect(verifier(await signedToken(keys, authenticatedAuth, 'person'))).resolves.toEqual({
      subject: 'person',
    })
  })

  it('rejects wrong issuer, audience, signature, expiry, and missing subject before authorization', async () => {
    const { verifier, keys } = await verifierFor(authenticatedAuth)
    const wrongIssuer = await signedToken(
      keys,
      { ...authenticatedAuth, issuer: 'https://other.test' },
      'person',
    )
    const wrongAudience = await signedToken(
      keys,
      { ...authenticatedAuth, audience: 'other-api' },
      'person',
    )
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuer(authenticatedAuth.issuer)
      .setAudience(authenticatedAuth.audience)
      .setSubject('person')
      .setIssuedAt()
      .setExpirationTime('5 seconds ago')
      .sign(keys.privateKey)
    const noSubject = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setIssuer(authenticatedAuth.issuer)
      .setAudience(authenticatedAuth.audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey)
    const otherKeys = await generateKeyPair('RS256')
    const wrongSignature = await signedToken(otherKeys, authenticatedAuth, 'person')

    for (const token of [wrongIssuer, wrongAudience, expired, noSubject, wrongSignature])
      await expect(verifier(token)).rejects.toBeInstanceOf(Error)
  })

  it('evaluates exact Auth0-style role and Okta-style group claims with any and all matching', async () => {
    const roleAuth: Auth = {
      ...authenticatedAuth,
      authorization: {
        mode: 'claim',
        claim: 'https://dashboard.example.test/roles',
        values: ['viewer', 'operator'],
        match: 'all',
      },
    }
    const groupAuth: Auth = {
      ...authenticatedAuth,
      authorization: {
        mode: 'claim',
        claim: 'groups',
        values: ['dashboard-viewers'],
        match: 'any',
      },
    }
    const roles = await verifierFor(roleAuth)
    await expect(
      roles.verifier(
        await signedToken(roles.keys, roleAuth, 'person', {
          'https://dashboard.example.test/roles': ['viewer', 'operator'],
        }),
      ),
    ).resolves.toEqual({ subject: 'person' })
    const groups = await verifierFor(groupAuth)
    await expect(
      groups.verifier(
        await signedToken(groups.keys, groupAuth, 'person', { groups: ['dashboard-viewers'] }),
      ),
    ).resolves.toEqual({ subject: 'person' })
    await expect(
      roles.verifier(
        await signedToken(roles.keys, roleAuth, 'person', {
          'https://dashboard.example.test/roles': ['viewer'],
        }),
      ),
    ).rejects.toMatchObject({ name: 'AccessDeniedError' })
    await expect(
      groups.verifier(await signedToken(groups.keys, groupAuth, 'person', { groups: [1] })),
    ).rejects.toMatchObject({ name: 'AccessDeniedError' })
  })
})

async function verifierFor(config: Auth) {
  const keys = await generateKeyPair('RS256')
  const publicKey = await exportJWK(keys.publicKey)
  publicKey.kid = 'key-1'
  const fetcher = (async (input: string | URL) =>
    Response.json(
      String(input).endsWith('configuration')
        ? { issuer: config.issuer, jwks_uri: `${config.issuer}/keys` }
        : { keys: [publicKey] },
    )) as typeof fetch
  return { verifier: await createAccessTokenVerifier(config, fetcher), keys }
}

function signedToken(
  keys: Awaited<ReturnType<typeof generateKeyPair>>,
  config: Auth,
  subject: string,
  claims: Record<string, unknown> = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey)
}
