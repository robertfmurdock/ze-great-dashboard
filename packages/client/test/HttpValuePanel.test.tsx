import { cleanup, render, screen } from '@testing-library/react'
import type { Envelope, Panel } from '@ze-great-dashboard/shared/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { HttpValuePanel } from '../src/HttpValuePanel.tsx'

const panel: Panel = { id: 'version', type: 'http-value' }

afterEach(cleanup)

describe('HttpValuePanel', () => {
  it('renders a configured value with its source link', () => {
    const sourceLink = 'https://service.example.com/version'
    const envelope: Envelope = {
      panelId: panel.id,
      state: 'ok',
      observedAt: '2026-08-18T12:00:00.000Z',
      link: sourceLink,
      signal: { type: 'http-value', value: '1.2.3' },
    }

    render(<HttpValuePanel panel={panel} envelope={envelope} />)

    expect(screen.getByText('1.2.3')).not.toBeNull()
    expect(
      screen
        .getByRole('link', { name: 'View source for version (opens in a new tab)' })
        .getAttribute('href'),
    ).toBe(sourceLink)
  })

  it('renders an unreadable value with its configured source link', () => {
    const sourceLink = 'https://service.example.com/status'
    const envelope: Envelope = {
      panelId: panel.id,
      state: 'error',
      observedAt: '2026-08-18T12:00:00.000Z',
      link: sourceLink,
      error: { kind: 'unreachable', message: 'offline' },
    }

    render(<HttpValuePanel panel={panel} envelope={envelope} />)

    expect(screen.getByText('Source unavailable')).not.toBeNull()
    expect(
      screen
        .getByRole('link', { name: 'View source for version (opens in a new tab)' })
        .getAttribute('href'),
    ).toBe(sourceLink)
  })
})
