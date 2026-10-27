import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => vi.unstubAllGlobals())

describe('useBoardConfig', () => {
  it('publishes the fetched board and records its compact summary', async () => {
    const diagnostics = recordingSink()
    let current: ReturnType<typeof useBoardConfig> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ panels: [{ id: 'build', type: 'pipeline-status' }] })),
    )

    render(<Probe diagnostics={diagnostics} onChange={(value) => (current = value)} />)
    await act(async () => {})

    expect(current?.loadedBoardName).toBe(env.board)
    expect(current?.board).toMatchObject({ panels: [{ id: 'build' }] })
    expect(diagnostics.events).toContainEqual(
      expect.objectContaining({ kind: 'board-fetch-start', path: `/api/boards/${env.board}` }),
    )
    expect(diagnostics.events).toContainEqual(
      expect.objectContaining({
        kind: 'board-fetch-response',
        boardSummary: { panelCount: 1, panelIds: ['build'] },
      }),
    )
  })

  it('records malformed JSON as a parse failure and publishes an empty board', async () => {
    const diagnostics = recordingSink()
    let current: ReturnType<typeof useBoardConfig> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{')),
    )

    render(<Probe diagnostics={diagnostics} onChange={(value) => (current = value)} />)
    await act(async () => {})

    expect(current?.board).toEqual({ panels: [] })
    expect(diagnostics.events.some((event) => event.kind === 'board-fetch-parse-failure')).toBe(
      true,
    )
    expect(diagnostics.events.some((event) => event.kind === 'board-fetch-failure')).toBe(false)
  })
})
