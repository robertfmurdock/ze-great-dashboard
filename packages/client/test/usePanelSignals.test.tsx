import { render } from '@testing-library/react'
import type { Board, ClientEnv, Envelope, PipelineStatus } from '@ze-great-dashboard/shared'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticEventInput, DiagnosticSink } from '../src/diagnostics.ts'
import type { PanelUpdateHealth } from '../src/panel-props.ts'
import { usePanelSignals } from '../src/usePanelSignals.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  assetPathId: 'sha256:3f454a601d3791a603e550652cec7ca1fb4359489df99605e72e051dd5b02731',
  proxyPath: '/api',
  board: 'ze-great-team',
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

const pullRequestBoard: Board = {
  panels: [
    {
      id: 'updates',
      type: 'pull-request-health',
      refresh: '1s' as Board['panels'][number]['refresh'],
      update_workflows: [{ workflow: 'dependency-update.yml' }],
    },
  ],
}

function Probe({
  diagnostics,
  currentBoard = board,
  onSignals,
  onUpdateHealth,
}: {
  diagnostics: DiagnosticSink
  currentBoard?: Board
  onSignals?: (signals: Record<string, Envelope | undefined>) => void
  onUpdateHealth?: (updateHealth: Record<string, PanelUpdateHealth | undefined>) => void
}) {
  const result = usePanelSignals({ board: currentBoard, env, diagnostics })
  onSignals?.(result.signals)
  onUpdateHealth?.(result.updateHealth)
  return null
}

function envelope(
  status: PipelineStatus['status'] = 'passed',
  options: { durationMs?: number; sourceUpdatedAt?: string } = {},
) {
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
      ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
      ...(options.sourceUpdatedAt ? { sourceUpdatedAt: options.sourceUpdatedAt } : {}),
    },
  })
}

function recordingSink() {
  const events: DiagnosticEventInput[] = []
  return {
    events,
    record: (event: DiagnosticEventInput) => events.push(event),
    recordGithubConsistencyIncident: vi.fn(),
  }
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

  it('uses a completed fallback estimate for the next running response', async () => {
    vi.useFakeTimers()
    const diagnostics = recordingSink()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          envelope('failed', { durationMs: 90_000, sourceUpdatedAt: '2026-08-28T11:00:00Z' }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(envelope('running', { sourceUpdatedAt: '2026-08-28T11:30:00Z' })),
      )
    vi.stubGlobal('fetch', fetcher)
    let latestSignals: Record<string, Envelope | undefined> = {}

    render(<Probe diagnostics={diagnostics} onSignals={(signals) => (latestSignals = signals)} />)
    await act(async () => {})
    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    expect(fetcher).toHaveBeenCalledTimes(2)
    const latest = latestSignals.build
    expect(latest?.state).toBe('ok')
    if (latest?.state === 'ok') {
      expect(latest.signal).toMatchObject({ status: 'running', estimatedDurationMs: 90_000 })
    }
  })

  it('surfaces missed updates and clears them when the server returns not modified', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'))
    const diagnostics = recordingSink()
    const offline = Promise.reject(new Error('offline'))
    offline.catch(() => undefined)
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(envelope()))
      .mockReturnValueOnce(offline)
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetcher)
    const healthSnapshots: Array<Record<string, PanelUpdateHealth | undefined>> = []

    render(
      <Probe diagnostics={diagnostics} onUpdateHealth={(value) => healthSnapshots.push(value)} />,
    )
    await act(async () => {})
    await act(async () => {
      vi.setSystemTime(new Date('2026-08-28T12:00:01.000Z'))
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(healthSnapshots.at(-1)?.build).toMatchObject({
      consecutiveFailures: 1,
      message: 'offline',
      lastConfirmedAt: '2026-08-28T12:00:00.000Z',
    })
    await act(async () => {
      vi.setSystemTime(new Date('2026-08-28T12:00:02.000Z'))
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(healthSnapshots.at(-1)?.build).toBeUndefined()
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

  it('aborts pull-request component reads on cleanup before they can fan out to build reads', async () => {
    const diagnostics = recordingSink()
    const aborted: boolean[] = []
    const fetcher = vi.fn((_path: string, init?: RequestInit) => {
      const signal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          aborted.push(true)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetcher)

    const rendered = render(<Probe diagnostics={diagnostics} currentBoard={pullRequestBoard} />)
    await act(async () => {})
    expect(fetcher).toHaveBeenCalledTimes(2)
    rendered.unmount()
    await act(async () => {})

    expect(aborted).toHaveLength(2)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
