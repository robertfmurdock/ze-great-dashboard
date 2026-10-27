import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import type { Envelope, Panel } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test } from 'vitest'
import { HttpValuePanel } from '../src/HttpValuePanel.tsx'

const panel: Panel = { id: 'version', type: 'http-value' }

describe('HttpValuePanel', () => {
  test(
    'renders a configured value with its source link',
    mint({
      setup: () => {
        const sourceLink = 'https://service.example.com/version'
        return {
          panel,
          sourceLink,
          envelope: {
            panelId: panel.id,
            state: 'ok',
            observedAt: '2026-08-18T12:00:00.000Z',
            link: sourceLink,
            signal: { type: 'http-value', value: '1.2.3' },
          } satisfies Envelope,
        }
      },
      exercise: ({ panel, envelope }) =>
        render(<HttpValuePanel panel={panel} envelope={envelope} />),
      verify: (_output, { panel, sourceLink }) => {
        expect(screen.getByText('1.2.3')).not.toBeNull()
        expect(
          screen
            .getByRole('link', { name: `View source for ${panel.id} (opens in a new tab)` })
            .getAttribute('href'),
        ).toBe(sourceLink)
      },
    }),
  )

  test(
    'renders an unreadable value with its configured source link',
    mint({
      setup: () => {
        const sourceLink = 'https://service.example.com/status'
        return {
          panel,
          sourceLink,
          envelope: {
            panelId: panel.id,
            state: 'error',
            observedAt: '2026-08-18T12:00:00.000Z',
            link: sourceLink,
            error: { kind: 'unreachable', message: 'offline' },
          } satisfies Envelope,
        }
      },
      exercise: ({ panel, envelope }) =>
        render(<HttpValuePanel panel={panel} envelope={envelope} />),
      verify: (_output, { panel, sourceLink }) => {
        expect(screen.getByText('Source unavailable')).not.toBeNull()
        expect(
          screen
            .getByRole('link', { name: `View source for ${panel.id} (opens in a new tab)` })
            .getAttribute('href'),
        ).toBe(sourceLink)
      },
    }),
  )
})
