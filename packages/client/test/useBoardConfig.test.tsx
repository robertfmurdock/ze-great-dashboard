import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { DiagnosticEventInput, DiagnosticSink } from '../src/diagnostics.ts'
import { useBoardConfig } from '../src/useBoardConfig.ts'
import { env } from './client-test-fixture.tsx'

function Probe({
  diagnostics,
  onChange,
}: {
  diagnostics: DiagnosticSink
  onChange: (value: ReturnType<typeof useBoardConfig>) => void
}) {
  onChange(useBoardConfig({ env, diagnostics }))
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
      exercise: async ({ diagnostics }) => {
        let current: ReturnType<typeof useBoardConfig> | undefined
        render(<Probe diagnostics={diagnostics} onChange={(value) => (current = value)} />)
        await act(async () => {})
        return current
      },
      verify: (current, { diagnostics, board, fetcher, expectedPath }) => {
        expect(current?.loadedBoardName).toBe(env.board)
        expect(current?.board).toEqual(board)
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
      exercise: async ({ diagnostics }) => {
        let current: ReturnType<typeof useBoardConfig> | undefined
        render(<Probe diagnostics={diagnostics} onChange={(value) => (current = value)} />)
        await act(async () => {})
        return current
      },
      verify: (current, { diagnostics, fetcher }) => {
        expect(current?.board).toEqual({ panels: [] })
        expect(current?.loadedBoardName).toBe(env.board)
        expect(fetcher).toHaveBeenCalledTimes(1)
        expect(diagnostics.events.some((event) => event.kind === 'board-fetch-parse-failure')).toBe(
          true,
        )
        expect(diagnostics.events.some((event) => event.kind === 'board-fetch-failure')).toBe(false)
      },
    }),
  )
})
