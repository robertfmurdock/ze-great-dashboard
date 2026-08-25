import { render } from '@testing-library/react'
import type { Board, ClientEnv } from '@ze-great-dashboard/shared'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticEventInput, DiagnosticSink } from '../src/diagnostics.ts'
import { usePanelSignals } from '../src/usePanelSignals.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  proxyPath: '/api',
  board: 'ze-great-team',
  clientVersion: '1.0.7',
}

const board: Board = {
  panels: [
    {
      id: 'build',
      type: 'pipeline-status',
      refresh: '1s' as Board['panels'][number]['refresh'],
    },
  ],
}

function Probe({
  diagnostics,
  currentBoard = board,
}: {
  diagnostics: DiagnosticSink
  currentBoard?: Board
}) {
  usePanelSignals({ board: currentBoard, env, diagnostics })
  return null
}

function envelope(status: 'passed' | 'failed' = 'passed') {
  return JSON.stringify({
    panelId: 'build',
    state: 'ok',
    observedAt: '2026-08-21T12:00:00.000Z',
    link: 'https://example.com/build',
    signal: {
      type: 'pipeline-status',
      status,
      rawStatus: status,
      name: 'build',
    },
  })
}

function recordingSink() {
  const events: DiagnosticEventInput[] = []
  return { events, record: (event: DiagnosticEventInput) => events.push(event) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('usePanelSignals', () => {
  it('emits typed fetch evidence and the compact rendered transition through its sink', async () => {
    const diagnostics = recordingSink()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(envelope(), { headers: { etag: 'W/"build"' } })),
    )

    render(<Probe diagnostics={diagnostics} />)
    await act(async () => {})

    expect(diagnostics.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'panel-fetch-start', panelId: 'build' }),
        expect.objectContaining({ kind: 'panel-fetch-response', status: 200 }),
        expect.objectContaining({
          kind: 'panel-rendered',
          rendered: { state: 'ok', status: 'passed', link: 'https://example.com/build' },
        }),
      ]),
    )
    const responses = diagnostics.events.filter((event) => event.kind === 'panel-fetch-response')
    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({
      status: 200,
      cache: { etag: 'W/"build"' },
      envelope: { state: 'ok' },
    })
  })

  it('records malformed JSON as a parse failure, not a fetch failure', async () => {
    const diagnostics = recordingSink()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{')),
    )

    render(<Probe diagnostics={diagnostics} />)
    await act(async () => {})

    expect(diagnostics.events.some((event) => event.kind === 'panel-fetch-parse-failure')).toBe(
      true,
    )
    expect(diagnostics.events.some((event) => event.kind === 'panel-fetch-failure')).toBe(false)
  })

  it('cleans up polling and never overlaps a pending request', async () => {
    vi.useFakeTimers()
    const diagnostics = recordingSink()
    let resolveFetch: ((value: Response) => void) | undefined
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const fetcher = vi.fn(() => pending)
    vi.stubGlobal('fetch', fetcher)

    const rendered = render(<Probe diagnostics={diagnostics} />)
    await act(async () => {})
    await act(async () => vi.advanceTimersByTime(2_000))
    expect(fetcher).toHaveBeenCalledTimes(1)

    rendered.unmount()
    await act(async () => vi.advanceTimersByTime(2_000))
    expect(fetcher).toHaveBeenCalledTimes(1)
    resolveFetch?.(new Response(envelope()))
  })
})
