import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const auth = {
  issuer: 'https://issuer.example.test',
  client_id: 'dashboard-spa',
  audience: 'dashboard-api',
  allow: { subjects: ['permitted'] },
}

describe('API authentication boundary', () => {
  it('rejects missing, invalid, and unauthorized access before any adapter fetch', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.test/dashboard' }),
      boardConfig: {
        auth,
        sources: {},
        boards: {
          ops: {
            panels: [
              { id: 'value', type: 'http-value', url: 'https://upstream.example.test/version' },
            ],
          },
        },
      },
      fetcher,
      accessTokenVerifier: async (token) => {
        if (token === 'unlisted') {
          const error = new Error()
          error.name = 'AccessDeniedError'
          throw error
        }
        if (token !== 'valid') throw new Error('bad signature')
        return { subject: 'permitted' }
      },
    })
    expect((await app.request('/api/boards/ops')).status).toBe(401)
    expect(
      (await app.request('/api/boards/ops', { headers: { authorization: 'Bearer wrong' } })).status,
    ).toBe(401)
    expect(
      (await app.request('/api/boards/ops', { headers: { authorization: 'Bearer unlisted' } }))
        .status,
    ).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('permits a verified token and leaves bootstrap routes public', async () => {
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.test/dashboard' }),
      boardConfig: {
        auth,
        sources: {},
        boards: { ops: { panels: [{ id: 'demo', type: 'pipeline-animation-demo' }] } },
      },
      fetcher: (async () => new Response('<html><head></head></html>')) as typeof fetch,
      accessTokenVerifier: async () => ({ subject: 'permitted' }),
    })
    expect((await app.request('/')).status).toBe(200)
    expect((await app.request('/health')).status).toBe(200)
    expect(
      (await app.request('/api/boards/ops', { headers: { authorization: 'Bearer valid' } })).status,
    ).toBe(200)
  })

  it('returns only safe policy metadata and blocks a missing claim before upstream access', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.test/dashboard' }),
      boardConfig: {
        auth: {
          issuer: auth.issuer,
          client_id: auth.client_id,
          audience: auth.audience,
          authorization: { mode: 'claim', claim: 'groups', values: ['viewers'], match: 'all' },
        },
        sources: {},
        boards: {
          ops: {
            panels: [
              { id: 'value', type: 'http-value', url: 'https://upstream.example.test/version' },
            ],
          },
        },
      },
      fetcher,
      accessTokenVerifier: async (token) => {
        if (token === 'missing-claim') {
          const error = new Error()
          error.name = 'AccessDeniedError'
          throw error
        }
        return { subject: 'permitted' }
      },
    })
    expect(
      (
        await app.request('/api/panel/ops/value', {
          headers: { authorization: 'Bearer missing-claim' },
        })
      ).status,
    ).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
    const body = await (
      await app.request('/api/boards/ops/security', { headers: { authorization: 'Bearer valid' } })
    ).json()
    expect(body).toEqual({ oidc: true, policy: { mode: 'claim', claim: 'groups', match: 'all' } })
    expect(JSON.stringify(body)).not.toContain('viewers')
    const download = await (
      await app.request('/api/boards/ops/authored', { headers: { authorization: 'Bearer valid' } })
    ).text()
    expect(download).not.toContain('auth:')
    expect(download).not.toContain('viewers')
  })
})
