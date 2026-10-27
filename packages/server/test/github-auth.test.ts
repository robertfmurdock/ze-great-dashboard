import { createVerify, generateKeyPairSync } from 'node:crypto'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test, vi } from 'vitest'
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
const workflowRunsUrl =
  'https://api.github.com/repos/example-org/example-repo/actions/workflows/build.yml/runs'
const appCredentials: Record<string, string> = {
  GITHUB_APP_ID: '12345',
  GITHUB_APP_PRIVATE_KEY: privateKeyPem,
  GITHUB_APP_INSTALLATION_ID: '67890',
}

describe('GitHub App authentication', () => {
  test(
    'creates a verifiable JWT with GitHub App claims',
    mint({
      setup: () => ({
        appId: '12345',
        privateKey: privateKeyPem,
        now: Date.parse('2026-08-29T12:00:00Z'),
        publicKey,
      }),
      exercise: ({ appId, privateKey, now }) => createAppJwt(appId, privateKey, now),
      verify: (jwt, { appId, publicKey }) => {
        const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.')
        const payload = JSON.parse(Buffer.from(encodedPayload ?? '', 'base64url').toString())
        const verifier = createVerify('RSA-SHA256')
        verifier.update(`${encodedHeader}.${encodedPayload}`)

        expect(payload).toEqual({ iat: 1788004740, exp: 1788005280, iss: appId })
        expect(verifier.verify(publicKey, Buffer.from(encodedSignature ?? '', 'base64url'))).toBe(
          true,
        )
      },
    }),
  )

  test(
    'exchanges an app JWT once and reuses its installation token for two GitHub calls',
    mint({
      setup: () => {
        const clock = { now: Date.parse('2026-08-29T12:00:00Z') }
        const fetcher = vi.fn(async (url: string) => {
          if (url.includes('/access_tokens')) {
            return new Response(
              JSON.stringify({ token: 'installation-token', expires_at: '2026-08-29T13:00:00Z' }),
            )
          }
          return pipelineResponse()
        }) as unknown as typeof fetch
        return { clock, fetcher, githubClient: githubClientFixture(clock) }
      },
      exercise: async ({ clock, fetcher, githubClient }) => {
        const first = await fetchGithubActionsPipeline({
          panel,
          source,
          requestHeaders: new Headers(),
          fetcher,
          githubClient,
        })
        clock.now += 10_000
        const second = await fetchGithubActionsPipeline({
          panel,
          source,
          requestHeaders: new Headers(),
          fetcher,
          githubClient,
        })
        return { first, second }
      },
      verify: ({ first, second }, { fetcher }) => {
        expect(first.response.status).toBe(200)
        expect(second.response.status).toBe(200)
        expect(fetcher).toHaveBeenCalledTimes(3)
        const tokenRequest = vi.mocked(fetcher).mock.calls[0]
        expect(tokenRequest?.[0]).toBe(
          'https://api.github.com/app/installations/67890/access_tokens',
        )
        expect(tokenRequest?.[1]).toMatchObject({ method: 'POST' })
        for (const [, options] of vi.mocked(fetcher).mock.calls.slice(1)) {
          if (!options?.headers) throw new Error('GitHub call had no headers')
          expect((options.headers as Headers).get('authorization')).toBe(
            'Bearer installation-token',
          )
        }
      },
    }),
  )

  test(
    'fails without naming or exposing a missing app credential value',
    mint({
      setup: () => ({
        fetcher: vi.fn() as unknown as typeof fetch,
        githubClient: createGithubClient({ get: () => undefined }),
      }),
      exercise: rejects(({ githubClient, fetcher }) =>
        githubClient.get({
          source,
          url: workflowRunsUrl,
          requestHeaders: new Headers(),
          fetcher,
        }),
      ),
      verify: (error) => {
        expect(error).toMatchObject({ message: 'GitHub authentication could not be completed.' })
      },
    }),
  )

  test(
    'refreshes an App installation token once after a 401 and preserves validators',
    mint({
      setup: () => {
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
        return {
          fetcher,
          githubClient: githubClientFixture({ now: Date.parse('2026-08-29T12:00:00Z') }),
          requestHeaders: new Headers({ 'if-none-match': 'W/"fixture"' }),
        }
      },
      exercise: ({ fetcher, githubClient, requestHeaders }) =>
        githubClient.get({ source, url: workflowRunsUrl, requestHeaders, fetcher }),
      verify: (response, { fetcher }) => {
        expect(response.status).toBe(401)
        expect(fetcher).toHaveBeenCalledTimes(4)
        const firstGet = vi.mocked(fetcher).mock.calls[1]
        const replay = vi.mocked(fetcher).mock.calls[3]
        if (!replay?.[1]?.headers) throw new Error('replayed GitHub request had no headers')
        expect(firstGet?.[0]).toBe(replay?.[0])
        expect((replay[1].headers as Headers).get('if-none-match')).toBe('W/"fixture"')
        expect((replay[1].headers as Headers).get('authorization')).toBe('Bearer second')
      },
    }),
  )
})

function githubClientFixture(clock: { now: number }) {
  return createGithubClient({ get: (name) => appCredentials[name] }, () => clock.now)
}

function pipelineResponse() {
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
}

function rejects<Input, Output>(exercise: (input: Input) => Promise<Output>) {
  return async (input: Input): Promise<unknown> => {
    try {
      await exercise(input)
    } catch (error) {
      return error
    }
    throw new Error('Expected GitHub authentication to reject.')
  }
}
