import { mint } from '@continuous-excellence/testmints-js/vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ClientEnv } from '@ze-great-dashboard/shared/browser'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { DiagnosticEventInput } from '../src/diagnostics.ts'
import { useClientUpdate } from '../src/useClientUpdate.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  assetPathId: 'sha256:3f454a601d3791a603e550652cec7ca1fb4359489df99605e72e051dd5b02731',
  proxyPath: '/api',
  board: 'ze-great-team',
}

const serverVersion = 'server-dev'
function identity(overrides: Partial<ClientEnv> = {}) {
  return Response.json({
    assetPath: env.assetPath,
    assetPathId: env.assetPathId,
    serverVersion,
    ...overrides,
  })
}
function clientUpdateFixture(fetcher: ReturnType<typeof vi.fn<typeof fetch>>) {
  const events: DiagnosticEventInput[] = []
  return {
    env,
    fetcher,
    reload: vi.fn(),
    diagnostics: {
      events,
      record: (event: DiagnosticEventInput) => events.push(event),
      recordGithubConsistencyIncident: vi.fn(),
    },
  }
}
afterEach(() => vi.useRealTimers())
describe('client identity selection', () => {
  test(
    'checks immediately and retains the current client identity',
    mint({
      setup: () => clientUpdateFixture(vi.fn<typeof fetch>(async () => identity())),
      exercise: (input) => renderHook(() => useClientUpdate(input)),
      verify: async (_, { fetcher, reload, diagnostics }) => {
        await waitFor(() =>
          expect(diagnostics.events).toContainEqual(
            expect.objectContaining({
              kind: 'client-update-response',
              serverVersion,
              assetPathIdMatches: true,
            }),
          ),
        )
        expect(fetcher).toHaveBeenCalledWith('/api/client', expect.anything())
        const init = fetcher.mock.calls[0]?.[1]
        expect(init).toMatchObject({ cache: 'no-store', signal: expect.any(AbortSignal) })
        const headers = new Headers(init?.headers)
        expect(headers.get('x-dashboard-client-version')).toBe('dev')
        expect(headers.get('x-dashboard-client-origin')).toBe(window.location.origin)
        expect(headers.get('x-dashboard-client-asset-id')).toBe(env.assetPathId)
        expect(reload).not.toHaveBeenCalled()
        expect(diagnostics.events).toContainEqual(
          expect.objectContaining({ kind: 'client-update-check' }),
        )
      },
    }),
  )
  test(
    'reloads when the server selects another client',
    mint({
      setup: () => {
        const nextAssetPath = 'https://assets.example.com/dashboard/1.0.8'
        return {
          ...clientUpdateFixture(
            vi.fn<typeof fetch>(async () => identity({ assetPath: nextAssetPath })),
          ),
          nextAssetPath,
        }
      },
      exercise: (input) => renderHook(() => useClientUpdate(input)),
      verify: async (_, { diagnostics, reload, nextAssetPath }) => {
        await waitFor(() => expect(reload).toHaveBeenCalledOnce())
        expect(diagnostics.events).toContainEqual(
          expect.objectContaining({
            kind: 'client-update-detected',
            next: expect.objectContaining({ assetPath: nextAssetPath }),
          }),
        )
      },
    }),
  )
  test(
    'records a failed identity response without reloading',
    mint({
      setup: () =>
        clientUpdateFixture(vi.fn<typeof fetch>(async () => new Response('nope', { status: 503 }))),
      exercise: (input) => renderHook(() => useClientUpdate(input)),
      verify: async (_, { diagnostics, reload }) => {
        await waitFor(() =>
          expect(diagnostics.events).toContainEqual(
            expect.objectContaining({ kind: 'client-update-failure' }),
          ),
        )
        expect(reload).not.toHaveBeenCalled()
      },
    }),
  )
})
describe('identity check lifecycle', () => {
  async function settledFixture() {
    vi.useFakeTimers()
    const world = clientUpdateFixture(vi.fn<typeof fetch>(async () => identity()))
    const hook = renderHook(() => useClientUpdate(world))
    await vi.waitUntil(
      () => world.diagnostics.events.some((event) => event.kind === 'client-update-response'),
      { interval: 1, timeout: 500 },
    )
    return { ...world, hook }
  }
  test(
    'checks again sixty seconds after settlement',
    mint({
      setup: settledFixture,
      exercise: async () => {
        await act(async () => vi.advanceTimersByTimeAsync(60000))
      },
      verify: async (_, { fetcher, diagnostics }) => {
        await vi.waitFor(
          () => {
            expect(fetcher).toHaveBeenCalledTimes(2)
            expect(
              diagnostics.events.filter((event) => event.kind === 'client-update-response'),
            ).toHaveLength(2)
          },
          { interval: 1, timeout: 500 },
        )
      },
    }),
  )
  test(
    'keeps its existing schedule through a hook rerender',
    mint({
      setup: async () => {
        const world = await settledFixture()
        await act(async () => vi.advanceTimersByTimeAsync(30000))
        return world
      },
      exercise: async ({ hook }) => {
        hook.rerender()
        await act(async () => vi.advanceTimersByTimeAsync(30000))
      },
      verify: async (_, { fetcher, diagnostics }) => {
        await vi.waitFor(
          () => {
            expect(fetcher).toHaveBeenCalledTimes(2)
            expect(
              diagnostics.events.filter((event) => event.kind === 'client-update-response'),
            ).toHaveLength(2)
          },
          { interval: 1, timeout: 500 },
        )
      },
    }),
  )
  function pendingFixture() {
    vi.useFakeTimers()
    const pending = vi.fn<typeof fetch>(
      (_path, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(pending)
      .mockImplementation(async () => identity())
    const world = clientUpdateFixture(fetcher)
    return { ...world, hook: renderHook(() => useClientUpdate(world)) }
  }
  test(
    'aborts an in-flight identity request and stops checking after unmount',
    mint({
      setup: pendingFixture,
      exercise: async ({ hook }) => {
        hook.unmount()
        await act(async () => vi.advanceTimersByTimeAsync(60000))
      },
      verify: (_, { fetcher, diagnostics }) => {
        expect(fetcher).toHaveBeenCalledOnce()
        expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
        expect(diagnostics.events.some((event) => event.kind === 'client-update-failure')).toBe(
          false,
        )
      },
    }),
  )
  test(
    'aborts a hung request at its deadline',
    mint({
      setup: pendingFixture,
      exercise: async () => {
        await act(async () => vi.advanceTimersByTimeAsync(10000))
      },
      verify: (_, { fetcher, diagnostics, reload }) => {
        expect(fetcher).toHaveBeenCalledOnce()
        expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
        expect(reload).not.toHaveBeenCalled()
        expect(diagnostics.events.some((event) => event.kind === 'client-update-failure')).toBe(
          false,
        )
      },
    }),
  )
  test(
    'continues checking after a timed-out request',
    mint({
      setup: async () => {
        const world = pendingFixture()
        await act(async () => vi.advanceTimersByTimeAsync(10000))
        return world
      },
      exercise: async () => {
        await act(async () => vi.advanceTimersByTimeAsync(60000))
      },
      verify: async (_, { fetcher, diagnostics, reload }) => {
        await vi.waitFor(
          () => {
            expect(fetcher).toHaveBeenCalledTimes(2)
            expect(diagnostics.events).toContainEqual(
              expect.objectContaining({ kind: 'client-update-response' }),
            )
          },
          { interval: 1, timeout: 500 },
        )
        expect(reload).not.toHaveBeenCalled()
        expect(diagnostics.events.some((event) => event.kind === 'client-update-failure')).toBe(
          false,
        )
      },
    }),
  )
})
