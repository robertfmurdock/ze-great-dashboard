import { mint } from '@continuous-excellence/testmints-js/vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { DiagnosticEventInput } from '../src/diagnostics.ts'
import { useBoardConfig } from '../src/useBoardConfig.ts'
import { env } from './client-test-fixture.tsx'

function recordingSink() {
  const events: DiagnosticEventInput[] = []
  return {
    events,
    record: (event: DiagnosticEventInput) => events.push(event),
    recordGithubConsistencyIncident: vi.fn(),
  }
}

describe('useBoardConfig', () => {
  afterEach(() => vi.unstubAllGlobals())

  test(
    'publishes the fetched board and records its compact summary',
    mint({
      setup: () => {
        const diagnostics = recordingSink()
        const board = { panels: [{ id: 'build', type: 'pipeline-status' }] }
        const expectedPath = `${env.proxyPath}/boards/${encodeURIComponent(env.board)}`
        const fetcher = vi.fn<typeof fetch>(async () => Response.json(board))
        vi.stubGlobal('fetch', fetcher)
        return { diagnostics, board, fetcher, expectedPath }
      },
      exercise: ({ diagnostics }) => renderHook(() => useBoardConfig({ env, diagnostics })),
      verify: async ({ result }, { diagnostics, board, fetcher, expectedPath }) => {
        await waitFor(() => {
          expect(result.current.loadedBoardName).toBe(env.board)
          expect(result.current.board).toEqual(board)
        })
        expect(fetcher).toHaveBeenCalledExactlyOnceWith(expectedPath, expect.any(Object))
        expect(diagnostics.events).toContainEqual(
          expect.objectContaining({
            kind: 'board-fetch-start',
            path: expectedPath,
          }),
        )
        expect(diagnostics.events).toContainEqual(
          expect.objectContaining({
            kind: 'board-fetch-response',
            boardSummary: {
              panelCount: board.panels.length,
              panelIds: board.panels.map(({ id }) => id),
            },
          }),
        )
      },
    }),
  )

  test(
    'records malformed JSON as a parse failure and publishes an empty board',
    mint({
      setup: () => {
        const diagnostics = recordingSink()
        const responseBody = '{'
        const fetcher = vi.fn(async () => new Response(responseBody))
        vi.stubGlobal('fetch', fetcher)
        return { diagnostics, fetcher }
      },
      exercise: ({ diagnostics }) => renderHook(() => useBoardConfig({ env, diagnostics })),
      verify: async ({ result }, { diagnostics, fetcher }) => {
        await waitFor(() => {
          expect(result.current.board).toEqual({ panels: [] })
          expect(result.current.loadedBoardName).toBe(env.board)
        })
        expect(fetcher).toHaveBeenCalledTimes(1)
        expect(diagnostics.events.some((event) => event.kind === 'board-fetch-parse-failure')).toBe(
          true,
        )
        expect(diagnostics.events.some((event) => event.kind === 'board-fetch-failure')).toBe(false)
      },
    }),
  )
})
