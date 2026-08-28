import { cleanup, fireEvent, render as rtlRender } from '@testing-library/react'
import type { ClientEnv } from '@ze-great-dashboard/shared'
import { act, StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { ConfigError } from '../src/ConfigError.tsx'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  proxyPath: '/api',
  board: 'ze-great-team',
  clientVersion: '1.0.7',
}

beforeEach(() => {
  // The shell tests do not exercise networking. Keep the request pending so its completion cannot
  // update React after the test's act scope has ended.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  )

  // App instances persist panel memory and diagnostics in browser storage. Clear both before
  // every scenario so one test cannot change reconciliation or rendering in another.
  try {
    window.localStorage.clear()
  } catch {
    // Browser storage may be unavailable; the application treats it as an optional optimization.
  }
})

function render(node: React.ReactNode): HTMLElement {
  return rtlRender(<StrictMode>{node}</StrictMode>).container
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the board shell', () => {
  it('names the board it was told it is', () => {
    expect(render(<App env={env} />).textContent).toContain('ze-great-team')
  })

  it('keeps deployment details available through Diagnostics', () => {
    const rendered = render(<App env={env} />)
    fireEvent.click(rendered.querySelector('button') as HTMLButtonElement)
    const text = rendered.textContent
    expect(text).toContain('1.0.7')
    expect(text).toContain('https://assets.example.com/dashboard/1.0.7')
  })

  it('renders a loading panel until the server provides its board config', () => {
    expect(render(<App env={env} />).textContent).toMatch(/Loading configuration/i)
  })

  it('explains that signals come from their configured authorities', () => {
    expect(render(<App env={env} />).textContent).toMatch(/read live/i)
  })
})

describe('when configuration never arrived', () => {
  it('says so on screen instead of rendering an empty board', () => {
    const text = render(<ConfigError message="assetPath: required" />).textContent

    expect(text).toMatch(/misconfigured/i)
    expect(text).toContain('assetPath: required')
  })

  it('announces itself to assistive technology', () => {
    expect(render(<ConfigError message="broken" />).querySelector('[role="alert"]')).not.toBeNull()
  })
})

describe('pipeline-status refresh scheduling', () => {
  const okEnvelope = (
    panelId: string,
    status: 'passed' | 'failed' | 'running',
    durationMs?: number,
  ) =>
    JSON.stringify({
      panelId,
      state: 'ok',
      observedAt: '2026-08-18T12:00:00.000Z',
      link: null,
      signal: {
        type: 'pipeline-status',
        status,
        rawStatus: status,
        name: panelId,
        branch: 'main',
        sourceUpdatedAt: '2026-08-18T11:00:00.000Z',
        ...(durationMs === undefined ? {} : { durationMs }),
      },
    })

  function setup(
    board: Record<string, unknown>,
    responses: Record<string, Array<Response | Promise<Response>>> = {},
  ) {
    const requests: string[] = []
    const fetcher = vi.fn((input: string | URL) => {
      const url = String(input)
      requests.push(url)
      if (url.startsWith('/api/boards/'))
        return Promise.resolve(new Response(JSON.stringify(board)))
      const panelId = decodeURIComponent(url.split('/').at(-1) ?? '')
      const panelResponses = responses[panelId] ?? [new Response(okEnvelope(panelId, 'passed'))]
      const response = panelResponses.shift()
      return response
        ? Promise.resolve(response)
        : Promise.resolve(new Response(okEnvelope(panelId, 'passed')))
    })
    vi.stubGlobal('fetch', fetcher)
    return { fetcher, requests }
  }

  async function settle() {
    await act(async () => {})
  }

  it('fetches each supported panel immediately and does not fetch unsupported panels', async () => {
    const { requests } = setup({
      panels: [
        { id: 'build', type: 'pipeline-status' },
        { id: 'note', type: 'markdown' },
        { id: 'deploy', type: 'pipeline-status' },
      ],
    })

    render(<App env={env} />)
    await settle()

    expect(requests.filter((url) => url.includes('/panel/'))).toHaveLength(2)
    expect(requests.some((url) => url.endsWith('/note'))).toBe(false)
  })

  it('renders the local animation demo without creating a panel request', async () => {
    const { requests } = setup({
      panels: [{ id: 'active-run-treatments', type: 'pipeline-animation-demo' }],
    })

    const rendered = render(<App env={env} />)
    await settle()

    expect(rendered.textContent).toContain('Demo treatment ·')
    expect(rendered.querySelector('[data-running-field], [data-running-progress]')).not.toBeNull()
    expect(requests.filter((url) => url.includes('/panel/'))).toEqual([])
  })

  it('shows a brief duration for completed runs only', async () => {
    const { requests } = setup(
      { panels: [{ id: 'build', type: 'pipeline-status' }] },
      {
        build: [new Response(okEnvelope('build', 'passed', 134_000))],
      },
    )

    const rendered = render(<App env={env} />)
    await settle()

    expect(requests.some((url) => url.endsWith('/build'))).toBe(true)
    expect(rendered.textContent).toContain('Took 2m 14s')
    expect(rendered.textContent).toContain('Run updated')
    expect(rendered.textContent).toContain('Checked')
  })

  it('shows concise live activity only for in-progress runs', async () => {
    setup(
      { panels: [{ id: 'build', type: 'pipeline-status' }] },
      {
        build: [
          new Response(
            okEnvelope('build', 'running').replace(
              '"sourceUpdatedAt":"2026-08-18T11:00:00.000Z"',
              '"sourceUpdatedAt":"2026-08-18T11:00:00.000Z","activity":{"kind":"step","name":"integration tests","parent":"build"}',
            ),
          ),
        ],
      },
    )
    const rendered = render(<App env={env} />)
    await settle()
    expect(rendered.textContent).toContain('build › integration tests')
    expect(rendered.textContent).not.toContain('in_progress')
  })

  it('uses check age as the only stale presentation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T12:10:00.000Z'))
    setup(
      { panels: [{ id: 'build', type: 'pipeline-status' }] },
      {
        build: [
          new Response(
            JSON.stringify({
              panelId: 'build',
              state: 'ok',
              observedAt: '2026-08-28T12:00:00.000Z',
              link: null,
              signal: {
                type: 'pipeline-status',
                status: 'passed',
                rawStatus: 'success',
                name: 'Build',
                sourceUpdatedAt: '2026-08-28T11:00:00.000Z',
              },
            }),
          ),
        ],
      },
    )
    const rendered = render(<App env={env} />)
    await settle()
    expect(rendered.textContent).toContain('Checked 10m ago')
    expect(
      Array.from(rendered.querySelectorAll('p')).filter((element) =>
        element.className.includes('stale'),
      ),
    ).toHaveLength(1)
    expect(rendered.textContent).toContain('Run updated 1h 10m ago')
  })

  it('does not show duration while a run is in progress', async () => {
    setup(
      { panels: [{ id: 'build', type: 'pipeline-status' }] },
      { build: [new Response(okEnvelope('build', 'running', 134_000))] },
    )

    const rendered = render(<App env={env} />)
    await settle()

    expect(rendered.textContent).not.toContain('Took')
  })

  function runningEnvelope(
    panelId: string,
    options: { startedAt?: string; estimateMs?: number } = {},
  ) {
    return new Response(
      JSON.stringify({
        panelId,
        state: 'ok',
        observedAt: '2026-08-18T12:00:00.000Z',
        link: null,
        signal: {
          type: 'pipeline-status',
          status: 'running',
          rawStatus: 'in_progress',
          name: panelId,
          ...(options.startedAt ? { runStartedAt: options.startedAt } : {}),
          ...(options.estimateMs ? { estimatedDurationMs: options.estimateMs } : {}),
        },
      }),
    )
  }

  async function renderRunningPanel(
    animation:
      | 'radial'
      | 'runway'
      | 'orbit'
      | 'signal-field'
      | 'telemetry-bloom'
      | 'release-transit'
      | 'status-weather',
  ) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T12:02:00.000Z'))
    setup(
      { panels: [{ id: 'build', type: 'pipeline-status', running_animation: animation }] },
      {
        build: [
          runningEnvelope('build', {
            startedAt: '2026-08-18T12:00:00.000Z',
            estimateMs: 300_000,
          }),
        ],
      },
    )
    const rendered = render(<App env={env} />)
    await settle()
    return rendered
  }

  it.each(['radial', 'orbit'] as const)(
    'renders the %s active-run treatment with local elapsed progress',
    async (animation) => {
      const rendered = await renderRunningPanel(animation)

      expect(rendered.querySelector(`[data-running-progress="${animation}"]`)).not.toBeNull()
      expect(rendered.textContent).toContain('Elapsed 2m 0s')
      expect(rendered.textContent).toContain('Expected ≈ ')

      await act(async () => vi.advanceTimersByTime(1_000))
      expect(rendered.textContent).toContain('Elapsed 2m 1s')
    },
  )

  it.each(['runway', 'signal-field'] as const)(
    'renders the %s compact active-run readout with local elapsed progress',
    async (animation) => {
      const rendered = await renderRunningPanel(animation)

      expect(rendered.querySelector(`[data-running-progress="${animation}"]`)).not.toBeNull()
      expect(rendered.textContent).toMatch(/2:00\/~\d+:\d{2}/)

      await act(async () => vi.advanceTimersByTime(1_000))
      expect(rendered.textContent).toMatch(/2:01\/~\d+:\d{2}/)
    },
  )

  it('renders the signal-field markers alongside its compact active-run readout', async () => {
    const rendered = await renderRunningPanel('signal-field')

    expect(rendered.querySelectorAll('[data-running-part="signal-track"]')).toHaveLength(5)
    expect(rendered.querySelector('[data-running-visual]')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
  })

  it.each(['telemetry-bloom', 'release-transit', 'status-weather'] as const)(
    'renders the %s active-run field with local elapsed progress',
    async (animation) => {
      const rendered = await renderRunningPanel(animation)

      expect(
        rendered.querySelector(`[data-running-field][data-animation="${animation}"]`),
      ).not.toBeNull()
      expect(rendered.textContent).toMatch(/2:00\/~\d+:\d{2}/)

      await act(async () => vi.advanceTimersByTime(1_000))
      expect(rendered.textContent).toMatch(/2:01\/~\d+:\d{2}/)
    },
  )

  it('keeps an overdue run visibly active and can disable the treatment per panel', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T12:05:00.000Z'))
    setup(
      {
        panels: [
          { id: 'late', type: 'pipeline-status', running_animation: 'runway' },
          { id: 'plain', type: 'pipeline-status', running_animation: 'off' },
        ],
      },
      {
        late: [
          runningEnvelope('late', {
            startedAt: '2026-08-18T12:00:00.000Z',
            estimateMs: 60_000,
          }),
        ],
        plain: [runningEnvelope('plain')],
      },
    )
    const rendered = render(<App env={env} />)
    await settle()

    expect(rendered.querySelector('[data-running-progress][data-overdue="true"]')).not.toBeNull()
    expect(rendered.textContent).toContain('⚠5:00/~1:00')
    expect(rendered.textContent).toContain('Running')
    expect(rendered.querySelectorAll('[data-running-progress]')).toHaveLength(1)
  })

  it('renders an indeterminate active treatment when timing history is unavailable', async () => {
    setup(
      { panels: [{ id: 'build', type: 'pipeline-status', running_animation: 'telemetry-bloom' }] },
      { build: [runningEnvelope('build')] },
    )
    const rendered = render(<App env={env} />)
    await settle()

    expect(
      rendered.querySelector(
        '[data-running-field][data-animation="telemetry-bloom"][data-indeterminate="true"]',
      ),
    ).not.toBeNull()
    expect(rendered.textContent).toContain('Expected duration unavailable')
  })

  it('uses panel refresh before the board refresh', async () => {
    vi.useFakeTimers()
    const { requests } = setup({
      refresh: '200ms',
      panels: [
        { id: 'board-default', type: 'pipeline-status' },
        { id: 'panel-override', type: 'pipeline-status', refresh: '100ms' },
        { id: 'fallback', type: 'pipeline-status' },
      ],
    })

    render(<App env={env} />)
    await settle()
    const panelRequests = () => requests.filter((url) => url.includes('/panel/'))

    await act(async () => vi.advanceTimersByTime(99))
    expect(panelRequests()).toHaveLength(3)
    await act(async () => vi.advanceTimersByTime(1))
    expect(panelRequests().filter((url) => url.endsWith('/panel-override'))).toHaveLength(2)
    await act(async () => vi.advanceTimersByTime(100))
    expect(panelRequests().filter((url) => url.endsWith('/board-default'))).toHaveLength(2)
  })

  it('uses a 60-second default when neither board nor panel sets refresh', async () => {
    vi.useFakeTimers()
    const { requests } = setup({ panels: [{ id: 'fallback', type: 'pipeline-status' }] })

    render(<App env={env} />)
    await settle()
    await act(async () => vi.advanceTimersByTime(59_999))
    expect(requests.filter((url) => url.endsWith('/fallback'))).toHaveLength(1)
    await act(async () => vi.advanceTimersByTime(1))
    expect(requests.filter((url) => url.endsWith('/fallback'))).toHaveLength(2)
  })

  it('updates the rendered signal on refresh', async () => {
    vi.useFakeTimers()
    setup(
      { refresh: '1s', panels: [{ id: 'build', type: 'pipeline-status' }] },
      {
        build: [
          new Response(okEnvelope('build', 'passed')),
          new Response(okEnvelope('build', 'failed')),
        ],
      },
    )

    const rendered = render(<App env={env} />)
    await settle()
    expect(rendered.textContent).toContain('Passed')
    expect(rendered.textContent).toContain('main')
    await act(async () => vi.advanceTimersByTime(1_000))
    await settle()
    expect(rendered.textContent).toContain('Failed')
  })

  it('records responses, 304s, invalid envelopes, failures, and rendered changes locally', async () => {
    vi.useFakeTimers()
    const values = new Map<string, string>()
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    }
    vi.stubGlobal('localStorage', store)
    const rejected = Promise.reject(new Error('offline'))
    rejected.catch(() => undefined)
    setup(
      { refresh: '1s', panels: [{ id: 'build', type: 'pipeline-status' }] },
      {
        build: [
          new Response(okEnvelope('build', 'passed'), { headers: { etag: 'W/"first"' } }),
          new Response(null, { status: 304 }),
          new Response(JSON.stringify({ nope: true })),
          rejected,
        ],
      },
    )
    render(<App env={env} />)
    await settle()
    for (let index = 0; index < 3; index++) {
      await act(async () => vi.advanceTimersByTime(1_000))
      await settle()
    }
    const saved = JSON.parse(store.getItem('ze-great-dashboard.diagnostics.v1') ?? '{}')
    const kinds = saved.events.map((event: { kind: string }) => event.kind)
    expect(kinds).toContain('panel-fetch-response')
    expect(kinds).toContain('panel-fetch-parse-failure')
    expect(kinds).toContain('panel-fetch-failure')
    expect(kinds).toContain('panel-rendered')
    expect(saved.events.some((event: { status?: number }) => event.status === 304)).toBe(true)
  })

  it('makes an empty workflow result clear on the panel', async () => {
    setup(
      { panels: [{ id: 'build', type: 'pipeline-status' }] },
      {
        build: [
          new Response(
            JSON.stringify({
              panelId: 'build',
              state: 'error',
              observedAt: '2026-08-18T12:00:00.000Z',
              link: 'https://github.com/example-org/example-repo/actions/workflows/build.yml',
              error: {
                kind: 'no-runs',
                message:
                  'No workflow runs found for branch "master". Check the source\'s branch setting.',
              },
            }),
          ),
        ],
      },
    )

    const rendered = render(<App env={env} />)
    await settle()
    expect(rendered.textContent).toContain('No workflow runs')
    expect(rendered.textContent).toContain('branch "master"')
    const link = rendered.querySelector('[data-panel-link]')
    expect(link?.getAttribute('aria-label')).toBe('View source for build (opens in a new tab)')
    expect(link?.getAttribute('href')).toBe(
      'https://github.com/example-org/example-repo/actions/workflows/build.yml',
    )
  })

  it('keeps the source link when a pipeline signal is invalid', async () => {
    setup(
      { panels: [{ id: 'build', type: 'pipeline-status' }] },
      {
        build: [
          new Response(
            JSON.stringify({
              panelId: 'build',
              state: 'ok',
              observedAt: '2026-08-18T12:00:00.000Z',
              link: 'https://github.com/example-org/example-repo/actions/workflows/build.yml',
              signal: { type: 'pipeline-status', status: 'surprising' },
            }),
          ),
        ],
      },
    )

    const rendered = render(<App env={env} />)
    await settle()
    expect(rendered.textContent).toContain('Invalid signal')
    expect(rendered.querySelector('[data-panel-link]')?.getAttribute('href')).toBe(
      'https://github.com/example-org/example-repo/actions/workflows/build.yml',
    )
  })

  it('cleans up timers and ignores an in-flight response on unmount', async () => {
    vi.useFakeTimers()
    let resolvePanel: ((response: Response) => void) | undefined
    const pending = new Promise<Response>((resolve) => {
      resolvePanel = resolve
    })
    const { requests } = setup(
      { refresh: '1s', panels: [{ id: 'build', type: 'pipeline-status' }] },
      { build: [pending] },
    )

    render(<App env={env} />)
    await settle()
    cleanup()
    const countAfterUnmount = requests.length
    await act(async () => vi.advanceTimersByTime(2_000))
    resolvePanel?.(new Response(okEnvelope('build', 'failed')))
    await settle()
    expect(requests).toHaveLength(countAfterUnmount)
  })

  it('polls panels independently and never overlaps a pending request', async () => {
    vi.useFakeTimers()
    const pending = new Promise<Response>(() => {})
    const { requests } = setup(
      {
        panels: [
          { id: 'slow', type: 'pipeline-status', refresh: '1s' },
          { id: 'fast', type: 'pipeline-status', refresh: '2s' },
        ],
      },
      { slow: [pending] },
    )

    render(<App env={env} />)
    await settle()
    await act(async () => vi.advanceTimersByTime(2_000))
    expect(requests.filter((url) => url.endsWith('/slow'))).toHaveLength(1)
    expect(requests.filter((url) => url.endsWith('/fast'))).toHaveLength(2)
  })
})

describe('http-value panels', () => {
  it('fetches and renders a configured value', async () => {
    const requests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        requests.push(url)
        if (url.startsWith('/api/boards/')) {
          return new Response(JSON.stringify({ panels: [{ id: 'version', type: 'http-value' }] }))
        }
        return new Response(
          JSON.stringify({
            panelId: 'version',
            state: 'ok',
            observedAt: '2026-08-18T12:00:00.000Z',
            link: 'https://service.example.com/version',
            signal: { type: 'http-value', value: '1.2.3' },
          }),
        )
      }),
    )

    const rendered = render(<App env={env} />)
    await act(async () => {})
    expect(requests.some((url) => url.endsWith('/version'))).toBe(true)
    expect(rendered.textContent).toContain('1.2.3')
    expect(rendered.querySelector('[data-panel-link]')?.getAttribute('href')).toBe(
      'https://service.example.com/version',
    )
    expect(rendered.querySelector('[data-panel-link]')?.getAttribute('aria-label')).toBe(
      'View source for version (opens in a new tab)',
    )
  })

  it('keeps the configured fallback link when the value cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) =>
        String(input).startsWith('/api/boards/')
          ? new Response(JSON.stringify({ panels: [{ id: 'version', type: 'http-value' }] }))
          : new Response(
              JSON.stringify({
                panelId: 'version',
                state: 'error',
                observedAt: '2026-08-18T12:00:00.000Z',
                link: 'https://service.example.com/status',
                error: { kind: 'unreachable', message: 'offline' },
              }),
            ),
      ),
    )

    const rendered = render(<App env={env} />)
    await act(async () => {})
    expect(rendered.textContent).toContain('Unable to read')
    expect(rendered.querySelector('[data-panel-link]')?.getAttribute('href')).toBe(
      'https://service.example.com/status',
    )
  })

  it('uses configured panel positions in the board grid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) =>
        String(input).startsWith('/api/boards/')
          ? new Response(
              JSON.stringify({
                panels: [
                  { id: 'build', type: 'pipeline-status', position: { x: 6, y: 4, w: 6, h: 3 } },
                ],
              }),
            )
          : new Response(
              JSON.stringify({
                panelId: 'build',
                state: 'ok',
                observedAt: '2026-08-18T12:00:00.000Z',
                link: null,
                signal: {
                  type: 'pipeline-status',
                  status: 'passed',
                  rawStatus: 'passed',
                  name: 'build',
                },
              }),
            ),
      ),
    )

    const rendered = render(<App env={env} />)
    await act(async () => {})
    const panel = rendered.querySelector('[data-panel]')
    expect(panel?.getAttribute('style')).toContain('--panel-column: 7 / span 6')
    expect(panel?.getAttribute('style')).toContain('--panel-row: 5 / span 3')
  })

  it('warns when panel positions exceed the intended canvas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) =>
        String(input).startsWith('/api/boards/')
          ? new Response(
              JSON.stringify({
                panels: [
                  { id: 'first', type: 'pipeline-status', position: { x: 0, y: 0, w: 8, h: 3 } },
                  { id: 'second', type: 'pipeline-status', position: { x: 4, y: 12, w: 8, h: 2 } },
                ],
              }),
            )
          : new Response('{}'),
      ),
    )

    const rendered = render(<App env={env} />)
    await act(async () => {})

    expect(rendered.querySelector('[data-layout-warning]')).not.toBeNull()
    expect(rendered.textContent).not.toContain('second: out-of-bounds')
    const warningButton = rendered.querySelector(
      '[data-layout-warning] button[aria-label="Layout warnings (1)"]',
    ) as HTMLButtonElement
    expect(warningButton).not.toBeNull()
    fireEvent.click(warningButton)
    expect(rendered.textContent).toContain(
      '1 layout issue detected against the intended 12×12 space',
    )
    expect(rendered.textContent).toContain('second: out-of-bounds at (4, 12), 8×2')
    expect(rendered.querySelector('a[href="/api/boards/ze-great-team/rendered"]')).not.toBeNull()
    expect(rendered.querySelector('a[href="/api/boards/ze-great-team/authored"]')).not.toBeNull()
    expect(rendered.textContent).toContain('Download legal rendered layout')
    expect(rendered.textContent).toContain('Download authored layout')
  })
})
