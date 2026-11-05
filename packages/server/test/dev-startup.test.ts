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
    'preserves the retry deadline and underlying error when board loading finishes later',
    mint({
      setup: () => {
        const waitMillis = 1000
        const world = startupFixture('http://localhost:5173/__ASSET_PATH__', waitMillis)
        const failure = new Error('ECONNREFUSED')
        const boardConfigUrl = 'https://config.example.test/board.yaml'
        const boardReadDelay = waitMillis + 250
        const boardText =
          '# yaml-language-server: $schema=https://public-assets.zegreatrob.com/dashboard/0.18.0/board-config.schema.json\nboards: {team: {panels: [{id: build, type: pipeline-status}]}}\n'
        vi.stubEnv('BOARD_CONFIG_URL', boardConfigUrl)
        vi.stubEnv('BOARD', 'team')
        const templateAttempts: number[] = []
        const startedAt = Date.now()
        const fetcher = vi.fn<typeof fetch>(async (input) => {
          if (input === boardConfigUrl) {
            await new Promise((resolve) => setTimeout(resolve, boardReadDelay))
            return new Response(boardText)
          }
          templateAttempts.push(Date.now() - startedAt)
          throw failure
        })
        return {
          ...world,
          waitMillis,
          failure,
          fetcher,
          templateAttempts,
          boardReadDelay,
          boardConfigUrl,
        }
      },
      exercise: async ({ fetcher, logger, boardReadDelay }) => {
        const outcome = Promise.allSettled([startup({ fetcher, logger })])
        await vi.advanceTimersByTimeAsync(boardReadDelay)
        return (await outcome)[0]
      },
      verify: (
        outcome,
        { assetPath, failure, waitMillis, templateAttempts, fetcher, boardConfigUrl },
      ) => {
        expect(templateAttempts.at(-1)).toBe(waitMillis)
        expect(fetcher).toHaveBeenCalledWith(boardConfigUrl)
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
