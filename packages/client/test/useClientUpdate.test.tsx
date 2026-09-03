import { render } from '@testing-library/react'
import type { ClientEnv } from '@ze-great-dashboard/shared'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticEventInput, DiagnosticSink } from '../src/diagnostics.ts'
import { useClientUpdate } from '../src/useClientUpdate.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  assetPathId: 'sha256:3f454a601d3791a603e550652cec7ca1fb4359489df99605e72e051dd5b02731',
  proxyPath: '/api',
  board: 'ze-great-team',
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
  return {
    events,
    record: (event: DiagnosticEventInput) => events.push(event),
    recordGithubConsistencyIncident: vi.fn(),
  }
}

function identity(overrides: Partial<ClientEnv> & { serverVersion?: string } = {}) {
  return new Response(
    JSON.stringify({
      assetPath: env.assetPath,
      assetPathId: env.assetPathId,
      serverVersion: 'server-dev',
      ...overrides,
    }),
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useClientUpdate', () => {
  it('checks the server immediately and does not reload for the current identity', async () => {
    const diagnostics = recordingSink()
    const fetcher = vi.fn<typeof fetch>(async () => identity())
    const reload = vi.fn()

    render(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
    await act(async () => {})

    expect(fetcher).toHaveBeenCalledWith('/api/client', expect.anything())
    const init = fetcher.mock.calls[0]?.[1]
    expect(init).toMatchObject({ cache: 'no-store', signal: expect.any(AbortSignal) })
    const headers = new Headers(init?.headers)
    expect(headers.get('x-dashboard-client-version')).toBe('dev')
    expect(headers.get('x-dashboard-client-origin')).toBe(window.location.origin)
    expect(headers.get('x-dashboard-client-asset-id')).toBe(env.assetPathId)
    expect(reload).not.toHaveBeenCalled()
    expect(diagnostics.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'client-update-check' }),
        expect.objectContaining({
          kind: 'client-update-response',
          serverVersion: 'server-dev',
          assetPathIdMatches: true,
        }),
      ]),
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
