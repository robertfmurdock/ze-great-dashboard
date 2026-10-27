import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const auth = {
  issuer: 'https://issuer.example.test',
  client_id: 'dashboard-spa',
  audience: 'dashboard-api',
  allow: { subjects: ['permitted'] },
}

function authenticatedApp(options: Omit<Parameters<typeof createApp>[0], 'config'>) {
  return createApp({
    config: loadConfig({ ASSET_PATH: 'https://assets.example.test/dashboard' }),
    ...options,
  })
}

function accessTokenVerifier({
  validToken,
  deniedTokens = [],
}: {
  validToken?: string
  deniedTokens?: readonly string[]
}) {
  return async (token: string) => {
    if (deniedTokens.includes(token)) {
      const error = new Error()
      error.name = 'AccessDeniedError'
      throw error
    }
    if (validToken !== undefined && token !== validToken) throw new Error('bad signature')
    return { subject: 'permitted' }
  }
}

describe('API authentication boundary', () => {
  describe('token admission', () => {
    const protectedValueBoard = {
      auth,
      sources: {},
      boards: {
        ops: {
          panels: [
            { id: 'value', type: 'http-value', url: 'https://upstream.example.test/version' },
          ],
        },
      },
    }

    function protectedValueFixture() {
      const fetcher = vi.fn<typeof fetch>()
      return {
        app: authenticatedApp({
          boardConfig: protectedValueBoard,
          fetcher,
          accessTokenVerifier: accessTokenVerifier({
            validToken: 'valid',
            deniedTokens: ['unlisted'],
          }),
        }),
        fetcher,
      }
    }

    test(
      'rejects a missing access token before any adapter fetch',
      mint({
        setup: protectedValueFixture,
        exercise: ({ app }) => app.request('/api/boards/ops'),
        verify: (response, { fetcher }) => {
          expect(response.status).toBe(401)
          expect(fetcher).not.toHaveBeenCalled()
        },
      }),
    )

    test(
      'rejects an invalid access token before any adapter fetch',
      mint({
        setup: () => ({
          ...protectedValueFixture(),
          headers: { authorization: 'Bearer wrong' },
        }),
        exercise: ({ app, headers }) => app.request('/api/boards/ops', { headers }),
        verify: (response, { fetcher }) => {
          expect(response.status).toBe(401)
          expect(fetcher).not.toHaveBeenCalled()
        },
      }),
    )

    test(
      'rejects an unauthorized access token before any adapter fetch',
      mint({
        setup: () => ({
          ...protectedValueFixture(),
          headers: { authorization: 'Bearer unlisted' },
        }),
        exercise: ({ app, headers }) => app.request('/api/boards/ops', { headers }),
        verify: (response, { fetcher }) => {
          expect(response.status).toBe(403)
          expect(fetcher).not.toHaveBeenCalled()
        },
      }),
    )
  })

  describe('bootstrap and board routes', () => {
    function publicBootstrapFixture() {
      return {
        app: authenticatedApp({
          boardConfig: {
            auth,
            sources: {},
            boards: { ops: { panels: [{ id: 'demo', type: 'pipeline-animation-demo' }] } },
          },
          fetcher: (async () =>
            new Response('<html lang="en"><head></head></html>')) as typeof fetch,
          accessTokenVerifier: accessTokenVerifier({}),
        }),
      }
    }

    test(
      'leaves the document route public',
      mint({
        setup: publicBootstrapFixture,
        exercise: ({ app }) => app.request('/'),
        verify: (response) => {
          expect(response.status).toBe(200)
        },
      }),
    )

    test(
      'leaves the health route public',
      mint({
        setup: publicBootstrapFixture,
        exercise: ({ app }) => app.request('/health'),
        verify: (response) => {
          expect(response.status).toBe(200)
        },
      }),
    )

    test(
      'permits a verified token to read a board',
      mint({
        setup: () => ({
          ...publicBootstrapFixture(),
          headers: { authorization: 'Bearer valid' },
        }),
        exercise: ({ app, headers }) => app.request('/api/boards/ops', { headers }),
        verify: (response) => {
          expect(response.status).toBe(200)
        },
      }),
    )
  })

  describe('claim-policy exposure', () => {
    const claimBoard = {
      auth: {
        issuer: auth.issuer,
        client_id: auth.client_id,
        audience: auth.audience,
        authorization: {
          mode: 'claim' as const,
          claim: 'groups',
          values: ['viewers'],
          match: 'all' as const,
        },
      },
      sources: {},
      boards: {
        ops: {
          panels: [
            { id: 'value', type: 'http-value', url: 'https://upstream.example.test/version' },
          ],
        },
      },
    }

    function claimPolicyFixture() {
      const fetcher = vi.fn<typeof fetch>()
      return {
        app: authenticatedApp({
          boardConfig: claimBoard,
          fetcher,
          accessTokenVerifier: accessTokenVerifier({ deniedTokens: ['missing-claim'] }),
        }),
        fetcher,
      }
    }

    test(
      'blocks a missing claim before any upstream access',
      mint({
        setup: () => ({
          ...claimPolicyFixture(),
          headers: { authorization: 'Bearer missing-claim' },
        }),
        exercise: ({ app, headers }) => app.request('/api/panel/ops/value', { headers }),
        verify: (response, { fetcher }) => {
          expect(response.status).toBe(403)
          expect(fetcher).not.toHaveBeenCalled()
        },
      }),
    )

    test(
      'returns only safe policy metadata',
      mint({
        setup: () => ({
          ...claimPolicyFixture(),
          headers: { authorization: 'Bearer valid' },
        }),
        exercise: async ({ app, headers }) => {
          const response = await app.request('/api/boards/ops/security', { headers })
          return response.json()
        },
        verify: (body) => {
          expect(body).toEqual({
            oidc: true,
            policy: { mode: 'claim', claim: 'groups', match: 'all' },
          })
          expect(JSON.stringify(body)).not.toContain('viewers')
        },
      }),
    )

    test(
      'redacts authorization policy from the authored configuration download',
      mint({
        setup: () => ({
          ...claimPolicyFixture(),
          headers: { authorization: 'Bearer valid' },
        }),
        exercise: async ({ app, headers }) => {
          const response = await app.request('/api/boards/ops/authored', { headers })
          return response.text()
        },
        verify: (download) => {
          expect(download).not.toContain('auth:')
          expect(download).not.toContain('viewers')
        },
      }),
    )
  })
})
