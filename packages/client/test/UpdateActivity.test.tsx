import { render, screen } from '@testing-library/react'
import type { ClientEnv } from '@ze-great-dashboard/shared'
import { afterEach, describe, expect, it } from 'vitest'
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
afterEach(() => document.body.replaceChildren())

describe('Update activity', () => {
  it('renders an always-visible browser-local timeline with readable lane semantics', () => {
    const diagnosticLog = log()
    diagnosticLog.record({
      kind: 'panel-fetch-start',
      panelId: 'build',
      path: '/api/panel/team/build',
    })
    render(<UpdateActivity board={{ panels: [] }} schedules={[schedule]} log={diagnosticLog} />)
    expect(screen.queryByRole('button', { name: 'Update activity' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Update activity')).not.toBeNull()
    expect(screen.getByText('Build')).not.toBeNull()
    expect(screen.getByText('● observed · ◇ expected')).not.toBeNull()
    expect(screen.getByLabelText(/Build, panel build; Normal cadence/)).not.toBeNull()
    expect(screen.getByTitle('Observed request: /api/panel/team/build')).not.toBeNull()
    expect(screen.getByTitle('Expected next poll')).not.toBeNull()
  })
})
