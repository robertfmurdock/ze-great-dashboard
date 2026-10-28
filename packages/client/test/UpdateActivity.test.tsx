import { mint } from '@continuous-excellence/testmints-js/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ClientEnv } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test, vi } from 'vitest'
import { BrowserDiagnosticStore } from '../src/diagnostics.ts'
import type { PollingScheduleSnapshot } from '../src/polling-schedule.ts'
import { UpdateActivity } from '../src/UpdateActivity.tsx'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1',
  assetPathId: 'id',
  proxyPath: '/api',
  board: 'team',
}
const schedule: PollingScheduleSnapshot = {
  panelId: 'build',
  label: 'Build',
  cadence: 'normal',
  inFlight: false,
  lastRequestStartedAt: '2026-09-03T11:59:00.000Z',
  nextDueAt: '2026-09-03T12:01:00.000Z',
  knownPaths: ['/api/panel/team/build'],
  settings: {
    refreshMillis: 60_000,
    runningRefreshMillis: 15_000,
    runningCompletionRefreshMillis: 5_000,
    runningCompletionWindowMillis: 120_000,
  },
}
function log() {
  const values = new Map<string, string>()
  return new BrowserDiagnosticStore(env, {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  })
}
describe('Update activity', () => {
  describe('dialog disclosure', () => {
    test(
      'keeps the timeline hidden until requested',
      mint({
        setup: () => ({ diagnosticLog: log() }),
        exercise: ({ diagnosticLog }) =>
          render(
            <UpdateActivity board={{ panels: [] }} schedules={[schedule]} log={diagnosticLog} />,
          ),
        verify: () => {
          expect(screen.queryByRole('dialog')).toBeNull()
        },
      }),
    )

    test(
      'exposes the accessible timeline when requested',
      mint({
        setup: () => {
          const diagnosticLog = log()
          diagnosticLog.record({
            kind: 'panel-fetch-start',
            panelId: 'build',
            path: '/api/panel/team/build',
          })
          render(
            <UpdateActivity board={{ panels: [] }} schedules={[schedule]} log={diagnosticLog} />,
          )
          return { user: userEvent.setup() }
        },
        exercise: async ({ user }) => {
          await user.click(screen.getByRole('button', { name: 'Update activity' }))
        },
        verify: () => {
          const dialog = screen.getByRole('dialog', { name: 'Update activity' })
          const close = screen.getByRole('button', { name: 'Close' })
          expect(dialog.getAttribute('aria-modal')).toBe('true')
          expect(screen.getByText('Build')).not.toBeNull()
          expect(screen.getByText('● observed · ◇ expected')).not.toBeNull()
          expect(screen.getByLabelText(/Build, panel build; Normal cadence/)).not.toBeNull()
          expect(screen.getByTitle('Observed request: /api/panel/team/build')).not.toBeNull()
          expect(screen.getByTitle('Expected next poll')).not.toBeNull()
          expect(document.activeElement).toBe(close)
        },
      }),
    )

    test(
      'contains Tab focus on the close control while open',
      mint({
        setup: () => {
          const diagnosticLog = log()
          render(
            <UpdateActivity board={{ panels: [] }} schedules={[schedule]} log={diagnosticLog} />,
          )
          return { user: userEvent.setup() }
        },
        exercise: async ({ user }) => {
          await user.click(screen.getByRole('button', { name: 'Update activity' }))
          await user.tab()
        },
        verify: () => {
          expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
        },
      }),
    )
  })

  describe('explicit dismissal', () => {
    test(
      'returns focus to its trigger after Close',
      mint({
        setup: () => {
          const diagnosticLog = log()
          render(
            <UpdateActivity board={{ panels: [] }} schedules={[schedule]} log={diagnosticLog} />,
          )
          return { user: userEvent.setup() }
        },
        exercise: async ({ user }) => {
          const trigger = screen.getByRole('button', { name: 'Update activity' })
          await user.click(trigger)
          await user.click(screen.getByRole('button', { name: 'Close' }))
          return trigger
        },
        verify: (trigger) => {
          expect(screen.queryByRole('dialog')).toBeNull()
          expect(document.activeElement).toBe(trigger)
        },
      }),
    )

    test(
      'returns focus to its trigger after Escape',
      mint({
        setup: () => {
          const diagnosticLog = log()
          render(
            <UpdateActivity board={{ panels: [] }} schedules={[schedule]} log={diagnosticLog} />,
          )
          return { user: userEvent.setup() }
        },
        exercise: async ({ user }) => {
          const trigger = screen.getByRole('button', { name: 'Update activity' })
          await user.click(trigger)
          await user.keyboard('{Escape}')
          return trigger
        },
        verify: (trigger) => {
          expect(screen.queryByRole('dialog')).toBeNull()
          expect(document.activeElement).toBe(trigger)
        },
      }),
    )
  })

  describe('automatic dismissal', () => {
    test(
      'dismisses after a minute without interaction',
      mint({
        setup: ({ scope }) => {
          vi.useFakeTimers()
          scope.defer('restore real timers', () => vi.useRealTimers())
          render(<UpdateActivity board={{ panels: [] }} schedules={[schedule]} log={log()} />)
        },
        exercise: () => {
          const trigger = screen.getByRole('button', { name: 'Update activity' })
          // This controlled-time scenario is about the component's minute timer; avoid user-event's
          // own scheduled interaction timers becoming part of that clock contract.
          fireEvent.click(trigger)
          act(() => vi.advanceTimersByTime(60_000))
          return trigger
        },
        verify: (trigger) => {
          expect(screen.queryByRole('dialog')).toBeNull()
          expect(document.activeElement).toBe(trigger)
        },
      }),
    )

    test(
      'remains open past the original minute when interaction resets dismissal',
      mint({
        setup: ({ scope }) => {
          vi.useFakeTimers()
          scope.defer('restore real timers', () => vi.useRealTimers())
          render(<UpdateActivity board={{ panels: [] }} schedules={[schedule]} log={log()} />)
        },
        exercise: () => {
          const trigger = screen.getByRole('button', { name: 'Update activity' })
          fireEvent.click(trigger)
          const dialog = screen.getByRole('dialog', { name: 'Update activity' })

          act(() => vi.advanceTimersByTime(59_000))
          fireEvent.pointerDown(dialog)
          act(() => vi.advanceTimersByTime(2_000))
        },
        verify: () => {
          expect(screen.getByRole('dialog', { name: 'Update activity' })).not.toBeNull()
        },
      }),
    )

    test(
      'dismisses after the reset minute window',
      mint({
        setup: ({ scope }) => {
          vi.useFakeTimers()
          scope.defer('restore real timers', () => vi.useRealTimers())
          render(<UpdateActivity board={{ panels: [] }} schedules={[schedule]} log={log()} />)
        },
        exercise: () => {
          const trigger = screen.getByRole('button', { name: 'Update activity' })
          fireEvent.click(trigger)
          const dialog = screen.getByRole('dialog', { name: 'Update activity' })

          act(() => vi.advanceTimersByTime(59_000))
          fireEvent.pointerDown(dialog)
          act(() => vi.advanceTimersByTime(60_000))
          return trigger
        },
        verify: (trigger) => {
          expect(screen.queryByRole('dialog')).toBeNull()
          expect(document.activeElement).toBe(trigger)
        },
      }),
    )
  })
})
