import { render } from '@testing-library/react'
import type { ClientEnv } from '@ze-great-dashboard/shared'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticEventInput, DiagnosticSink } from '../src/diagnostics.ts'
import { useClientUpdate } from '../src/useClientUpdate.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  proxyPath: '/api',
  board: 'ze-great-team',
  clientVersion: '1.0.7',
}

function Probe({
  diagnostics,
  fetcher,
  reload,
}: {
  diagnostics: DiagnosticSink
  fetcher: typeof fetch
  reload: () => void
}) {
  useClientUpdate({ env, diagnostics, fetcher, reload })
  return null
}

function recordingSink() {
  const events: DiagnosticEventInput[] = []
  return { events, record: (event: DiagnosticEventInput) => events.push(event) }
}

function identity(overrides: Partial<ClientEnv> = {}) {
  return new Response(
    JSON.stringify({ assetPath: env.assetPath, clientVersion: env.clientVersion, ...overrides }),
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useClientUpdate', () => {
  it('checks the server immediately and does not reload for the current identity', async () => {
    const diagnostics = recordingSink()
    const fetcher = vi.fn(async () => identity())
    const reload = vi.fn()

    render(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
    await act(async () => {})

    expect(fetcher).toHaveBeenCalledWith(
      '/api/client',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    )
    expect(reload).not.toHaveBeenCalled()
    expect(diagnostics.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'client-update-check' })]),
    )
  })

  it('reloads when the server selects a different client', async () => {
    const diagnostics = recordingSink()
    const fetcher = vi.fn(async () =>
      identity({ assetPath: 'https://assets.example.com/dashboard/1.0.8' }),
    )
    const reload = vi.fn()

    render(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
    await act(async () => {})

    expect(reload).toHaveBeenCalledOnce()
    expect(diagnostics.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'client-update-detected' })]),
    )
  })

  it('checks again after 60 seconds and cleans up the timer', async () => {
    vi.useFakeTimers()
    const diagnostics = recordingSink()
    const fetcher = vi.fn(async () => identity())
    const reload = vi.fn()
    const rendered = render(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
    await act(async () => {})
    expect(fetcher).toHaveBeenCalledOnce()

    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
    })
    expect(fetcher).toHaveBeenCalledTimes(2)

    rendered.unmount()
    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not restart the schedule when the component rerenders', async () => {
    vi.useFakeTimers()
    const diagnostics = recordingSink()
    const fetcher = vi.fn(async () => identity())
    const reload = vi.fn()
    const rendered = render(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
    await act(async () => {})

    rendered.rerender(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
    await act(async () => {})
    expect(fetcher).toHaveBeenCalledOnce()

    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('records failures and keeps the radiator running', async () => {
    const diagnostics = recordingSink()
    const fetcher = vi.fn(async () => new Response('nope', { status: 503 }))
    const reload = vi.fn()

    render(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
    await act(async () => {})

    expect(reload).not.toHaveBeenCalled()
    expect(diagnostics.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'client-update-failure' })]),
    )
  })

  it('aborts an in-flight request on unmount without recording a failure', async () => {
    const diagnostics = recordingSink()
    const fetcher = vi.fn<typeof fetch>(
      (_path, options?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const reload = vi.fn()
    const rendered = render(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
    rendered.unmount()
    await act(async () => {})

    expect(diagnostics.events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'client-update-failure' })]),
    )
  })

  it('times out a hung request and continues checking later', async () => {
    vi.useFakeTimers()
    const diagnostics = recordingSink()
    const fetcher = vi.fn<typeof fetch>((_path, options?: RequestInit) => {
      if (fetcher.mock.calls.length > 1) return Promise.resolve(identity())
      return new Promise<Response>((_, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('timed out', 'AbortError')),
        )
      })
    })
    const reload = vi.fn()

    render(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
    await act(async () => {})
    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
    })

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
  })
})
