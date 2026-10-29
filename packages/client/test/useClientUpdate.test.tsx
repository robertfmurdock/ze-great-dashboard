import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render } from '@testing-library/react'
import type { ClientEnv } from '@ze-great-dashboard/shared/browser'
import { act } from 'react'
import { describe, expect, test, vi } from 'vitest'
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

function deferredResponse() {
  let resolve!: (response: Response) => void
  const response = new Promise<Response>((resolveResponse) => {
    resolve = resolveResponse
  })
  return { response, resolve }
}

type Fetcher = ReturnType<typeof vi.fn<typeof fetch>>

function clientUpdateFixture(scope: ResourceScope, fetcher: Fetcher, fakeTimers = false) {
  if (fakeTimers) vi.useFakeTimers()
  scope.defer('restore client update timers', () => vi.useRealTimers())
  return { diagnostics: recordingSink(), fetcher, reload: vi.fn() }
}

describe('useClientUpdate', () => {
  describe('client identity selection', () => {
    test(
      'checks the server immediately and does not reload for the current identity',
      mint({
        setup: ({ scope }) => {
          const response = deferredResponse()
          return {
            ...clientUpdateFixture(
              scope,
              vi.fn<typeof fetch>(() => response.response),
            ),
            response,
          }
        },
        exercise: async ({ diagnostics, fetcher, reload, response }) => {
          render(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
          await act(async () => response.resolve(identity()))
        },
        verify: (_result, { diagnostics, fetcher, reload }) => {
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
        },
      }),
    )

    test(
      'reloads when the server selects a different client',
      mint({
        setup: ({ scope }) => {
          const nextAssetPath = 'https://assets.example.com/dashboard/1.0.8'
          const response = deferredResponse()
          return {
            ...clientUpdateFixture(
              scope,
              vi.fn<typeof fetch>(() => response.response),
            ),
            response,
            nextAssetPath,
          }
        },
        exercise: async ({ diagnostics, fetcher, reload, response, nextAssetPath }) => {
          render(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
          await act(async () => response.resolve(identity({ assetPath: nextAssetPath })))
        },
        verify: (_result, { diagnostics, reload, nextAssetPath }) => {
          expect(reload).toHaveBeenCalledOnce()
          expect(diagnostics.events).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind: 'client-update-detected',
                next: expect.objectContaining({ assetPath: nextAssetPath }),
              }),
            ]),
          )
        },
      }),
    )
  })

  describe('check lifecycle', () => {
    test(
      'checks again after 60 seconds',
      mint({
        setup: async ({ scope }) => {
          const response = deferredResponse()
          const fetcher: Fetcher = vi.fn<typeof fetch>(() =>
            fetcher.mock.calls.length === 1 ? response.response : Promise.resolve(identity()),
          )
          const fixture = clientUpdateFixture(scope, fetcher, true)
          render(
            <Probe
              diagnostics={fixture.diagnostics}
              fetcher={fixture.fetcher}
              reload={fixture.reload}
            />,
          )
          await act(async () => response.resolve(identity()))
          return fixture
        },
        exercise: async () => {
          await act(async () => {
            vi.advanceTimersByTime(60_000)
            await Promise.resolve()
          })
        },
        verify: (_result, { fetcher }) => expect(fetcher).toHaveBeenCalledTimes(2),
      }),
    )

    test(
      'stops polling after unmount',
      mint({
        setup: ({ scope }) => {
          const fixture = clientUpdateFixture(
            scope,
            vi.fn<typeof fetch>(
              (_path, options?: RequestInit) =>
                new Promise<Response>((_, reject) => {
                  options?.signal?.addEventListener('abort', () =>
                    reject(new DOMException('aborted', 'AbortError')),
                  )
                }),
            ),
            true,
          )
          const rendered = render(
            <Probe
              diagnostics={fixture.diagnostics}
              fetcher={fixture.fetcher}
              reload={fixture.reload}
            />,
          )
          return { ...fixture, rendered }
        },
        exercise: async ({ rendered }) => {
          await act(async () => rendered.unmount())
          await act(async () => {
            vi.advanceTimersByTime(60_000)
            await Promise.resolve()
          })
        },
        verify: (_result, { diagnostics, fetcher }) => {
          expect(fetcher).toHaveBeenCalledOnce()
          expect(diagnostics.events).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ kind: 'client-update-failure' })]),
          )
        },
      }),
    )

    test(
      'does not restart the schedule when the component rerenders',
      mint({
        setup: async ({ scope }) => {
          const response = deferredResponse()
          const fetcher: Fetcher = vi.fn<typeof fetch>(() =>
            fetcher.mock.calls.length === 1 ? response.response : Promise.resolve(identity()),
          )
          const fixture = clientUpdateFixture(scope, fetcher, true)
          const rendered = render(
            <Probe
              diagnostics={fixture.diagnostics}
              fetcher={fixture.fetcher}
              reload={fixture.reload}
            />,
          )
          await act(async () => response.resolve(identity()))
          await act(async () => {
            vi.advanceTimersByTime(30_000)
            await Promise.resolve()
          })
          return { ...fixture, rendered }
        },
        exercise: async ({ diagnostics, fetcher, reload, rendered }) => {
          await act(async () =>
            rendered.rerender(
              <Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />,
            ),
          )
          await act(async () => {
            vi.advanceTimersByTime(30_000)
            await Promise.resolve()
          })
        },
        verify: (_result, { fetcher }) => expect(fetcher).toHaveBeenCalledTimes(2),
      }),
    )

    test(
      'records failures and keeps the radiator running',
      mint({
        setup: ({ scope }) => {
          const response = deferredResponse()
          return {
            ...clientUpdateFixture(
              scope,
              vi.fn<typeof fetch>(() => response.response),
            ),
            response,
          }
        },
        exercise: async ({ diagnostics, fetcher, reload, response }) => {
          render(<Probe diagnostics={diagnostics} fetcher={fetcher} reload={reload} />)
          await act(async () => response.resolve(new Response('nope', { status: 503 })))
        },
        verify: (_result, { diagnostics, reload }) => {
          expect(reload).not.toHaveBeenCalled()
          expect(diagnostics.events).toEqual(
            expect.arrayContaining([expect.objectContaining({ kind: 'client-update-failure' })]),
          )
        },
      }),
    )

    test(
      'times out a hung request and continues checking later',
      mint({
        setup: ({ scope }) => {
          const fetcher = vi.fn<typeof fetch>((_path, options?: RequestInit) => {
            if (fetcher.mock.calls.length > 1) return Promise.resolve(identity())
            return new Promise<Response>((_, reject) => {
              options?.signal?.addEventListener('abort', () =>
                reject(new DOMException('timed out', 'AbortError')),
              )
            })
          })
          const fixture = clientUpdateFixture(scope, fetcher, true)
          render(
            <Probe
              diagnostics={fixture.diagnostics}
              fetcher={fixture.fetcher}
              reload={fixture.reload}
            />,
          )
          return fixture
        },
        exercise: async () => {
          await act(async () => {
            vi.advanceTimersByTime(10_000)
            await Promise.resolve()
          })
          await act(async () => {
            vi.advanceTimersByTime(60_000)
            await Promise.resolve()
          })
        },
        verify: (_result, { diagnostics, fetcher, reload }) => {
          expect(fetcher).toHaveBeenCalledTimes(2)
          expect(reload).not.toHaveBeenCalled()
          expect(diagnostics.events).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ kind: 'client-update-failure' })]),
          )
        },
      }),
    )
  })
})
