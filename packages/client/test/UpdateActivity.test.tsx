import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ClientEnv } from '@ze-great-dashboard/shared/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('Update activity', () => {
  it('keeps the footer compact until requested, then exposes the accessible timeline and returns on Close or Escape', () => {
    const diagnosticLog = log()
    diagnosticLog.record({
      kind: 'panel-fetch-start',
      panelId: 'build',
      path: '/api/panel/team/build',
    })
    render(<UpdateActivity board={{ panels: [] }} schedules={[schedule]} log={diagnosticLog} />)
    const trigger = screen.getByRole('button', { name: 'Update activity' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Update activity' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText('Build')).not.toBeNull()
    expect(screen.getByText('● observed · ◇ expected')).not.toBeNull()
    expect(screen.getByLabelText(/Build, panel build; Normal cadence/)).not.toBeNull()
    expect(screen.getByTitle('Observed request: /api/panel/team/build')).not.toBeNull()
    expect(screen.getByTitle('Expected next poll')).not.toBeNull()

    const close = screen.getByRole('button', { name: 'Close' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.click(close)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('dismisses after a minute without interaction and restarts that window on interaction', () => {
    vi.useFakeTimers()
    render(<UpdateActivity board={{ panels: [] }} schedules={[schedule]} log={log()} />)
    const trigger = screen.getByRole('button', { name: 'Update activity' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Update activity' })

    act(() => vi.advanceTimersByTime(59_000))
    expect(screen.queryByRole('dialog')).not.toBeNull()
    fireEvent.pointerDown(dialog)
    act(() => vi.advanceTimersByTime(2_000))
    expect(screen.queryByRole('dialog')).not.toBeNull()
    act(() => vi.advanceTimersByTime(58_000))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
