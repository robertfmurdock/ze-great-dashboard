import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startup } from '../src/startup.ts'

/**
 * `npm run dev` starts this server and the Vite dev server at the same moment, so whichever loses
 * the race would otherwise kill the loop — and "run it again" is a bad first experience for the
 * thing you are supposed to leave running all day.
 *
 * The retry is narrow on purpose. Everything here is really about proving that narrowness: it is
 * opt-in, bounded, and preserves the original error.
 */
describe('waiting for a client that is still starting up', () => {
  const template = '<html><head></head><body>hi</body></html>'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    // Not covered by restoreAllMocks, and a leaked TEMPLATE_WAIT_MS silently changes what the next
    // test is measuring.
    vi.unstubAllEnvs()
  })

  /** Runs a startup to completion while advancing fake timers past its retry sleeps. */
  async function startupWithTimers(env: Record<string, string>, fetcher: typeof fetch) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)

    const settled = startup({ fetcher })
    // The retries sleep on real setTimeout calls; drive them rather than waiting them out.
    const pumping = vi.advanceTimersByTimeAsync(60_000)
    const result = await Promise.allSettled([settled])
    await pumping
    return result[0]
  }

  it('retries until the client comes up, when a wait is configured', async () => {
    let attempts = 0
    const fetcher = (async () => {
      attempts += 1
      if (attempts < 3) throw new Error('ECONNREFUSED')
      return new Response(template, { status: 200 })
    }) as typeof fetch

    const outcome = await startupWithTimers(
      { ASSET_PATH: 'http://localhost:5173/__ASSET_PATH__', TEMPLATE_WAIT_MS: '5000' },
      fetcher,
    )

    expect(outcome.status).toBe('fulfilled')
    expect(attempts).toBe(3)
  })

  it('gives up at the configured deadline with the underlying error intact', async () => {
    const fetcher = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch

    const outcome = await startupWithTimers(
      { ASSET_PATH: 'http://localhost:5173/__ASSET_PATH__', TEMPLATE_WAIT_MS: '1000' },
      fetcher,
    )

    // Waiting must not blur what went wrong — the message still names the path and the cause.
    expect(outcome.status).toBe('rejected')
    expect((outcome as PromiseRejectedResult).reason).toMatchObject({
      message: expect.stringContaining('ECONNREFUSED'),
    })
  })

  it('does not retry at all without a configured wait', async () => {
    let attempts = 0
    const fetcher = (async () => {
      attempts += 1
      throw new Error('ECONNREFUSED')
    }) as typeof fetch

    const outcome = await startupWithTimers({ ASSET_PATH: 'https://cdn/typo' }, fetcher)

    expect(outcome.status).toBe('rejected')
    expect(attempts).toBe(1)
  })
})
