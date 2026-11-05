import { mint } from '@continuous-excellence/testmints-js/vitest'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { startup } from '../src/startup.ts'

function startupFixture(assetPath: string, waitMillis?: number) {
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubEnv('ASSET_PATH', assetPath)
  vi.stubEnv('TEMPLATE_WAIT_MS', waitMillis?.toString())
  return { assetPath, logger: { log: vi.fn() } }
}

describe('waiting for a client that is still starting up', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  test(
    'retries until the client comes up, when a wait is configured',
    mint({
      setup: () => {
        const world = startupFixture('http://localhost:5173/__ASSET_PATH__', 5000)
        const template = '<html><head></head><body>hi</body></html>'
        const fetcher = vi
          .fn<typeof fetch>()
          .mockRejectedValueOnce(new Error('ECONNREFUSED'))
          .mockRejectedValueOnce(new Error('ECONNREFUSED'))
          .mockResolvedValue(new Response(template))
        return { ...world, fetcher }
      },
      exercise: async ({ fetcher, logger }) => {
        const outcome = Promise.allSettled([startup({ fetcher, logger })])
        await vi.advanceTimersByTimeAsync(500)
        return (await outcome)[0]
      },
      verify: (outcome, { fetcher, assetPath }) => {
        expect(outcome.status).toBe('fulfilled')
        expect(fetcher.mock.calls).toEqual(
          Array.from({ length: 3 }, () => [`${assetPath}/index.html`]),
        )
      },
    }),
  )

  test(
    'gives up at the configured deadline with the underlying error intact',
    mint({
      setup: () => {
        const waitMillis = 1000
        const world = startupFixture('http://localhost:5173/__ASSET_PATH__', waitMillis)
        const failure = new Error('ECONNREFUSED')
        const fetcher = vi.fn<typeof fetch>().mockRejectedValue(failure)
        return { ...world, waitMillis, failure, fetcher }
      },
      exercise: async ({ fetcher, logger, waitMillis }) => {
        const startedAt = Date.now()
        let settledAfter: number | undefined
        let outcome: PromiseSettledResult<Awaited<ReturnType<typeof startup>>> | undefined
        void startup({ fetcher, logger }).then(
          (value) => {
            settledAfter = Date.now() - startedAt
            outcome = { status: 'fulfilled', value }
          },
          (reason: unknown) => {
            settledAfter = Date.now() - startedAt
            outcome = { status: 'rejected', reason }
          },
        )
        await vi.advanceTimersByTimeAsync(waitMillis)
        return { outcome, settledAfter }
      },
      verify: ({ outcome, settledAfter }, { assetPath, failure, waitMillis }) => {
        expect(settledAfter).toBe(waitMillis)
        expect(outcome).toMatchObject({
          status: 'rejected',
          reason: {
            message: expect.stringContaining(`${assetPath}/index.html`),
          },
        })
        expect(outcome).toMatchObject({
          reason: { message: expect.stringContaining(failure.message) },
        })
      },
    }),
  )

  test(
    'does not retry at all without a configured wait',
    mint({
      setup: () => {
        const world = startupFixture('https://cdn/typo')
        const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED'))
        return { ...world, fetcher }
      },
      exercise: async ({ fetcher, logger }) => {
        const outcome = Promise.allSettled([startup({ fetcher, logger })])
        await vi.advanceTimersByTimeAsync(1000)
        return (await outcome)[0]
      },
      verify: (outcome, { fetcher, assetPath }) => {
        expect(outcome.status).toBe('rejected')
        expect(fetcher).toHaveBeenCalledExactlyOnceWith(`${assetPath}/index.html`)
      },
    }),
  )
})
