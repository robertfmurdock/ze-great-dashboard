import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Diagnostics } from '../src/Diagnostics.tsx'
import { BrowserDiagnosticStore } from '../src/diagnostics.ts'
import type { UpdateActivitySnapshot } from '../src/update-activity.ts'
import { env } from './client-test-fixture.tsx'

type Retention = { eventsPrunedByAge: number; eventsPrunedByCount: number }

function log(retention?: Retention) {
  const values = new Map<string, string>()
  if (retention)
    values.set(
      'ze-great-dashboard.diagnostics.v2',
      JSON.stringify({
        schemaVersion: 2,
        retention,
        events: [],
      }),
    )
  return new BrowserDiagnosticStore(
    env,
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    () => new Date('2026-08-21T12:00:00Z'),
  )
}

function fixture(retention?: Retention) {
  return { user: userEvent.setup(), diagnosticLog: log(retention) }
}

async function openFixture() {
  const world = fixture()
  render(<Diagnostics log={world.diagnosticLog} />)
  await world.user.click(screen.getByRole('button', { name: /Diagnostics/ }))
  return world
}

describe('Diagnostics control', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test(
    'discloses its retained count and keeps actions hidden while collapsed',
    mint({
      setup: () => fixture(),
      exercise: ({ diagnosticLog }) => render(<Diagnostics log={diagnosticLog} />),
      verify: (_output, { diagnosticLog }) => {
        expect(
          screen
            .getByRole('button', { name: `Diagnostics (${diagnosticLog.count()})` })
            .getAttribute('aria-expanded'),
        ).toBe('false')
        expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
      },
    }),
  )

  test(
    'opens its actions and client summary',
    mint({
      setup: () => {
        const world = fixture()
        render(<Diagnostics log={world.diagnosticLog} />)
        return world
      },
      exercise: ({ user }) => user.click(screen.getByRole('button', { name: /Diagnostics/ })),
      verify: () => {
        expect(screen.getByRole('button', { name: 'Download' })).not.toBeNull()
        expect(screen.getByRole('button', { name: 'Clear' })).not.toBeNull()
        expect(screen.getByText(`Client dev · assets ${env.assetPath}`)).not.toBeNull()
        expect(screen.getByText(/Update failures: 0; board fetch failures: 0/)).not.toBeNull()
      },
    }),
  )

  test(
    'updates the retained count when new evidence arrives',
    mint({
      setup: async () => {
        const world = await openFixture()
        return {
          ...world,
          initialCount: world.diagnosticLog.count(),
          event: {
            kind: 'panel-fetch-start' as const,
            panelId: 'build',
            path: '/api/panel/build',
          },
        }
      },
      exercise: ({ diagnosticLog, event }) => act(() => diagnosticLog.record(event)),
      verify: (_output, { initialCount }) => {
        expect(
          screen.getByRole('button', { name: `Diagnostics (${initialCount + 1})` }),
        ).not.toBeNull()
      },
    }),
  )

  test(
    'downloads JSON evidence with the supplied update activity',
    mint({
      setup: async () => {
        const world = fixture()
        const updateActivity: UpdateActivitySnapshot = {
          capturedAt: '2026-08-21T12:00:00.000Z',
          window: { from: '2026-08-21T11:50:00.000Z', to: '2026-08-21T12:00:00.000Z' },
          schedules: [],
        }
        const url = 'blob:test'
        const createObjectURL = vi.fn((_blob: Blob) => url)
        const revokeObjectURL = vi.fn()
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
        const click = vi
          .spyOn(HTMLAnchorElement.prototype, 'click')
          .mockImplementation(() => undefined)
        render(<Diagnostics log={world.diagnosticLog} updateActivity={() => updateActivity} />)
        await world.user.click(screen.getByRole('button', { name: /Diagnostics/ }))
        return { ...world, updateActivity, url, createObjectURL, revokeObjectURL, click }
      },
      exercise: ({ user }) => user.click(screen.getByRole('button', { name: 'Download' })),
      verify: async (_output, { updateActivity, url, createObjectURL, revokeObjectURL, click }) => {
        expect(createObjectURL).toHaveBeenCalledTimes(1)
        const blob = createObjectURL.mock.calls[0]?.[0]
        if (!blob) throw new Error('Expected diagnostics download blob.')
        expect(blob.type).toBe('application/json')
        expect(JSON.parse(await blob.text())).toMatchObject({ updateActivity })
        expect(click).toHaveBeenCalledTimes(1)
        expect(revokeObjectURL).toHaveBeenCalledWith(url)
      },
    }),
  )

  test(
    'retains evidence when clearing is declined',
    mint({
      setup: async () => {
        const world = await openFixture()
        const confirm = vi.fn(() => false)
        vi.stubGlobal('confirm', confirm)
        return { ...world, confirm, original: world.diagnosticLog.export() }
      },
      exercise: ({ user }) => user.click(screen.getByRole('button', { name: 'Clear' })),
      verify: (_output, { diagnosticLog, confirm, original }) => {
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(diagnosticLog.export()).toEqual(original)
        expect(
          screen.getByRole('button', { name: `Diagnostics (${diagnosticLog.count()})` }),
        ).not.toBeNull()
      },
    }),
  )

  test(
    'clears retained evidence after confirmation',
    mint({
      setup: async () => {
        const world = await openFixture()
        const confirm = vi.fn(() => true)
        vi.stubGlobal('confirm', confirm)
        return { ...world, confirm }
      },
      exercise: ({ user }) => user.click(screen.getByRole('button', { name: 'Clear' })),
      verify: (_output, { diagnosticLog, confirm }) => {
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(diagnosticLog.count()).toBe(0)
        expect(screen.getByRole('button', { name: 'Diagnostics (0)' })).not.toBeNull()
      },
    }),
  )

  test(
    'warns when retention has pruned older evidence',
    mint({
      setup: () => {
        const retention = { eventsPrunedByAge: 2, eventsPrunedByCount: 5 }
        const { user, diagnosticLog } = fixture(retention)
        render(<Diagnostics log={diagnosticLog} />)
        return { user, retention }
      },
      exercise: ({ user }) => user.click(screen.getByRole('button', { name: /Diagnostics/ })),
      verify: (_output, { retention }) => {
        expect(screen.getByRole('alert').textContent).toContain(
          `Earlier evidence was pruned: ${retention.eventsPrunedByCount}`,
        )
      },
    }),
  )

  test(
    'shows per-panel failures in its summary',
    mint({
      setup: () => {
        const world = fixture()
        const event = {
          kind: 'panel-fetch-failure' as const,
          panelId: 'build',
          path: '/api/panel/build',
          message: 'offline',
        }
        world.diagnosticLog.record(event)
        render(<Diagnostics log={world.diagnosticLog} />)
        return { ...world, event }
      },
      exercise: ({ user }) => user.click(screen.getByRole('button', { name: /Diagnostics/ })),
      verify: (_output, { event }) => {
        expect(screen.getByText(/parse\/network failures 0\/1/).textContent).toContain(
          event.panelId,
        )
      },
    }),
  )
})
