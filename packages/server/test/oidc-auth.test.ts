import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { Auth } from '@ze-great-dashboard/shared'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, test } from 'vitest'
import {
  type AccessTokenVerifier,
  accessDenied,
  createAccessTokenVerifier,
} from '../src/oidc-auth.ts'

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

describe('OIDC API access-token verification', () => {
  describe('signed API token admission', () => {
    test(
      'accepts a correctly signed allowed API token through discovery and JWKS',
      mint({
        setup: () => verifierTokenFixture(auth, { subject: 'allowed-user' }),
        exercise: ({ verifier, token }) => verifier(token),
        verify: (identity, { calls }) => {
          expect(identity).toEqual({ subject: 'allowed-user' })
          expect(calls).toEqual([
            `${auth.issuer}/.well-known/openid-configuration`,
            `${auth.issuer}/keys`,
          ])
        },
      }),
    )

    test(
      'accepts a provider issuer with a trailing slash when configuration omits it',
      mint({
        setup: () => {
          const providerIssuer = `${auth.issuer}/`
          return verifierTokenFixture(auth, {
            discoveryIssuer: providerIssuer,
            issuer: providerIssuer,
            subject: 'allowed-user',
          })
        },
        exercise: ({ verifier, token }) => verifier(token),
        verify: (identity) => {
          expect(identity).toEqual({ subject: 'allowed-user' })
        },
      }),
    )

    test(
      'admits a subject under the authenticated policy',
      mint({
        setup: () => verifierTokenFixture(authenticatedAuth),
        exercise: ({ verifier, token }) => verifier(token),
        verify: (identity) => {
          expect(identity).toEqual({ subject: 'person' })
        },
      }),
    )
  })

  describe('invalid token rejection', () => {
    test(
      'rejects a token with the wrong issuer before authorization',
      mint({
        setup: () => verifierTokenFixture(authenticatedAuth, { issuer: 'https://other.test' }),
        exercise: rejects(({ verifier, token }) => verifier(token)),
        verify: (error) => {
          expect(error).toBeInstanceOf(Error)
        },
      }),
    )

    test(
      'rejects a token with the wrong audience before authorization',
      mint({
        setup: () => verifierTokenFixture(authenticatedAuth, { audience: 'other-api' }),
        exercise: rejects(({ verifier, token }) => verifier(token)),
        verify: (error) => {
          expect(error).toBeInstanceOf(Error)
        },
      }),
    )

    test(
      'rejects an expired token before authorization',
      mint({
        setup: () => verifierTokenFixture(authenticatedAuth, { expiration: '5 seconds ago' }),
        exercise: rejects(({ verifier, token }) => verifier(token)),
        verify: (error) => {
          expect(error).toBeInstanceOf(Error)
        },
      }),
    )

    test(
      'rejects a token without a subject before authorization',
      mint({
        setup: () => verifierTokenFixture(authenticatedAuth, { subject: null }),
        exercise: rejects(({ verifier, token }) => verifier(token)),
        verify: (error) => {
          expect(error).toBeInstanceOf(Error)
        },
      }),
    )

    test(
      'rejects a token signed by an untrusted key before authorization',
      mint({
        setup: () => untrustedVerifierTokenFixture(authenticatedAuth),
        exercise: rejects(({ verifier, token }) => verifier(token)),
        verify: (error) => {
          expect(error).toBeInstanceOf(Error)
        },
      }),
    )
  })

  describe('authorization policy', () => {
    test(
      'denies an authenticated but unlisted subject',
      mint({
        setup: () => verifierTokenFixture(auth, { subject: 'someone-else' }),
        exercise: rejects(({ verifier, token }) => verifier(token)),
        verify: (error) => {
          expect(accessDenied(error)).toBe(true)
        },
      }),
    )

    test(
      'admits every required Auth0-style role claim',
      mint({
        setup: () =>
          verifierTokenFixture(roleAuth, {
            claims: { 'https://dashboard.example.test/roles': ['viewer', 'operator'] },
          }),
        exercise: ({ verifier, token }) => verifier(token),
        verify: (identity) => {
          expect(identity).toEqual({ subject: 'person' })
        },
      }),
    )

    test(
      'admits an Okta-style group claim matching any allowed group',
      mint({
        setup: () => verifierTokenFixture(groupAuth, { claims: { groups: ['dashboard-viewers'] } }),
        exercise: ({ verifier, token }) => verifier(token),
        verify: (identity) => {
          expect(identity).toEqual({ subject: 'person' })
        },
      }),
    )

    test(
      'denies a role claim missing a required role',
      mint({
        setup: () =>
          verifierTokenFixture(roleAuth, {
            claims: { 'https://dashboard.example.test/roles': ['viewer'] },
          }),
        exercise: rejects(({ verifier, token }) => verifier(token)),
        verify: (error) => {
          expect(accessDenied(error)).toBe(true)
        },
      }),
    )

    test(
      'denies a group claim containing a non-string value',
      mint({
        setup: () => verifierTokenFixture(groupAuth, { claims: { groups: [1] } }),
        exercise: rejects(({ verifier, token }) => verifier(token)),
        verify: (error) => {
          expect(accessDenied(error)).toBe(true)
        },
      }),
    )
  })
})

type VerificationInput = { token: string; verifier: AccessTokenVerifier }

/**
 * Local prototype of a Testmints expected-rejection exercise. A resolution violates the declared
 * exercise contract and fails the exercise phase; a rejection becomes the output for verification.
 */
function rejects(exercise: (input: VerificationInput) => Promise<unknown>) {
  return async (input: VerificationInput) => {
    try {
      await exercise(input)
    } catch (error) {
      return error
    }
    throw new Error('Expected OIDC token verification to reject.')
  }
}

async function verifierFixture(config: Auth, providerIssuer = config.issuer) {
  const keys = await generateKeyPair('RS256')
  const publicKey = await exportJWK(keys.publicKey)
  publicKey.kid = 'key-1'
  const calls: string[] = []
  const jwksUri = providerIssuer.endsWith('/') ? `${providerIssuer}keys` : `${providerIssuer}/keys`
  const fetcher = (async (input: string | URL) => {
    calls.push(String(input))
    return Response.json(
      String(input).endsWith('configuration')
        ? { issuer: providerIssuer, jwks_uri: jwksUri }
        : { keys: [publicKey] },
    )
  }) as typeof fetch
  return { verifier: await createAccessTokenVerifier(config, fetcher), keys, calls }
}

type TokenOptions = {
  audience?: string
  claims?: Record<string, unknown>
  discoveryIssuer?: string
  expiration?: string
  issuer?: string
  signingKeys?: Awaited<ReturnType<typeof generateKeyPair>>
  subject?: string | null
}

async function verifierTokenFixture(
  verificationAuth: Auth,
  {
    audience = verificationAuth.audience,
    claims = {},
    discoveryIssuer = verificationAuth.issuer,
    expiration = '5m',
    issuer = verificationAuth.issuer,
    signingKeys,
    subject = 'person',
  }: TokenOptions = {},
) {
  const fixture = await verifierFixture(verificationAuth, discoveryIssuer)
  return {
    ...fixture,
    token: await signedToken(
      signingKeys ?? fixture.keys,
      { ...verificationAuth, audience, issuer },
      subject ?? undefined,
      claims,
      expiration,
    ),
  }
}

async function untrustedVerifierTokenFixture(verificationAuth: Auth) {
  return verifierTokenFixture(verificationAuth, { signingKeys: await generateKeyPair('RS256') })
}

function signedToken(
  keys: Awaited<ReturnType<typeof generateKeyPair>>,
  config: Auth,
  subject: string | undefined,
  claims: Record<string, unknown> = {},
  expiration = '5m',
) {
  const token = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime(expiration)
  if (subject !== undefined) token.setSubject(subject)
  return token.sign(keys.privateKey)
}
