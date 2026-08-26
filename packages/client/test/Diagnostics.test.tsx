import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ClientEnv } from '@ze-great-dashboard/shared'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Diagnostics } from '../src/Diagnostics.tsx'
import { BrowserDiagnosticStore } from '../src/diagnostics.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  proxyPath: '/api',
  board: 'ze-great-team',
  clientVersion: '1.0.7',
}

function log() {
  const values = new Map<string, string>()
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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Diagnostics control', () => {
  it('discloses its retained count and keeps actions hidden until opened', () => {
    const diagnosticLog = log()
    render(<Diagnostics log={diagnosticLog} />)
    expect(
      screen.getByRole('button', { name: /Diagnostics \(1\)/ }).getAttribute('aria-expanded'),
    ).toBe('false')
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Diagnostics/ }))
    expect(screen.getByRole('button', { name: 'Download' })).not.toBeNull()
    expect(
      screen.getByText(/Client 1\.0\.7 · assets https:\/\/assets\.example\.com/),
    ).not.toBeNull()
    expect(screen.getByText(/Update failures: 0; board fetch failures: 0/)).not.toBeNull()
    act(() => {
      diagnosticLog.record({
        kind: 'panel-fetch-start',
        panelId: 'build',
        path: '/api/panel/build',
      })
    })
    expect(screen.getByRole('button', { name: /Diagnostics \(2\)/ })).not.toBeNull()
  })

  it('downloads its JSON evidence and only clears after confirmation', () => {
    const diagnosticLog = log()
    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    )
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<Diagnostics log={diagnosticLog} />)
    fireEvent.click(screen.getByRole('button', { name: /Diagnostics/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(diagnosticLog.count()).toBe(1)
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(diagnosticLog.count()).toBe(0)
    click.mockRestore()
  })

  it('warns when retention has pruned older evidence', () => {
    const values = new Map<string, string>()
    values.set(
      'ze-great-dashboard.diagnostics.v1',
      JSON.stringify({
        schemaVersion: 1,
        retention: { eventsPrunedByAge: 2, eventsPrunedByCount: 5 },
        events: [],
      }),
    )
    const diagnosticLog = new BrowserDiagnosticStore(
      env,
      {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
      () => new Date('2026-08-21T12:00:00Z'),
    )
    render(<Diagnostics log={diagnosticLog} />)
    fireEvent.click(screen.getByRole('button', { name: /Diagnostics/ }))
    expect(screen.getByRole('alert').textContent).toContain('Earlier evidence was pruned: 5')
  })

  it('shows per-panel failures in its summary', () => {
    const diagnosticLog = log()
    diagnosticLog.record({
      kind: 'panel-fetch-failure',
      panelId: 'build',
      path: '/api/panel/build',
      message: 'offline',
    })
    render(<Diagnostics log={diagnosticLog} />)
    fireEvent.click(screen.getByRole('button', { name: /Diagnostics/ }))
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'P' &&
          element.textContent?.includes('build') === true &&
          element.textContent.includes('parse/network failures 0/1'),
      ),
    ).not.toBeNull()
  })
})
