import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { fetchGithubActionsPipeline } from '../src/adapters/github-actions.ts'
import { createAppJwt, createGithubClient } from '../src/github-auth.ts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const source = {
  type: 'github-actions',
  repo: 'example-org/example-repo',
  github_app: {
    app_id_env: 'GITHUB_APP_ID',
    private_key_env: 'GITHUB_APP_PRIVATE_KEY',
    installation_id_env: 'GITHUB_APP_INSTALLATION_ID',
  },
} as const
const panel = {
  id: 'build',
  type: 'pipeline-status',
  source: 'github',
  pipeline: 'build.yml',
} as const

describe('GitHub App authentication', () => {
  it('creates a verifiable JWT with GitHub App claims', () => {
    const jwt = createAppJwt('12345', privateKeyPem, Date.parse('2026-08-29T12:00:00Z'))
    const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.')
    const payload = JSON.parse(Buffer.from(encodedPayload ?? '', 'base64url').toString())
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${encodedHeader}.${encodedPayload}`)

    expect(payload).toEqual({ iat: 1788004740, exp: 1788005280, iss: '12345' })
    expect(verifier.verify(publicKey, Buffer.from(encodedSignature ?? '', 'base64url'))).toBe(true)
  })

  it('exchanges an app JWT for an installation token and reuses it for GitHub calls', async () => {
    let now = Date.parse('2026-08-29T12:00:00Z')
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/access_tokens')) {
        return new Response(
          JSON.stringify({ token: 'installation-token', expires_at: '2026-08-29T13:00:00Z' }),
        )
      }
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              status: 'completed',
              conclusion: 'success',
              name: 'Build',
              html_url: 'https://github.com/example-org/example-repo/actions/runs/1',
            },
          ],
        }),
      )
    }) as unknown as typeof fetch
    const githubClient = createGithubClient(
      {
        get: (name) =>
          ({
            GITHUB_APP_ID: '12345',
            GITHUB_APP_PRIVATE_KEY: privateKeyPem,
            GITHUB_APP_INSTALLATION_ID: '67890',
          })[name],
      },
      () => now,
    )

    await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers(),
      fetcher,
      githubClient,
    })
    now += 10_000
    await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers(),
      fetcher,
      githubClient,
    })

    expect(fetcher).toHaveBeenCalledTimes(3)
    const tokenRequest = vi.mocked(fetcher).mock.calls[0]
    expect(tokenRequest?.[0]).toBe('https://api.github.com/app/installations/67890/access_tokens')
    expect(tokenRequest?.[1]).toMatchObject({ method: 'POST' })
    for (const [, options] of vi.mocked(fetcher).mock.calls.slice(1)) {
      if (!options?.headers) throw new Error('GitHub call had no headers')
      expect((options.headers as Headers).get('authorization')).toBe('Bearer installation-token')
    }
  })

  it('fails without naming or exposing a missing app credential value', async () => {
    const githubClient = createGithubClient({ get: () => undefined })
    await expect(
      githubClient.get({
        source,
        url: 'https://api.github.com/repos/example-org/example-repo/actions/workflows/build.yml/runs',
        requestHeaders: new Headers(),
        fetcher: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow('GitHub authentication could not be completed.')
  })

  it('refreshes an App installation token once after a 401 and preserves validators', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'first', expires_at: '2026-08-29T13:00:00Z' })),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'second', expires_at: '2026-08-29T13:00:00Z' })),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 })) as unknown as typeof fetch
    const githubClient = createGithubClient({
      get: (name: string) =>
        ({
          GITHUB_APP_ID: '12345',
          GITHUB_APP_PRIVATE_KEY: privateKeyPem,
          GITHUB_APP_INSTALLATION_ID: '67890',
        })[name],
    })

    const response = await githubClient.get({
      source,
      url: 'https://api.github.com/repos/example-org/example-repo/actions/workflows/build.yml/runs',
      requestHeaders: new Headers({ 'if-none-match': 'W/"fixture"' }),
      fetcher,
    })

    expect(response.status).toBe(401)
    expect(fetcher).toHaveBeenCalledTimes(4)
    const firstGet = vi.mocked(fetcher).mock.calls[1]
    const replay = vi.mocked(fetcher).mock.calls[3]
    if (!replay?.[1]?.headers) throw new Error('replayed GitHub request had no headers')
    expect(firstGet?.[0]).toBe(replay?.[0])
    expect((replay[1].headers as Headers).get('if-none-match')).toBe('W/"fixture"')
    expect((replay[1].headers as Headers).get('authorization')).toBe('Bearer second')
  })
})
