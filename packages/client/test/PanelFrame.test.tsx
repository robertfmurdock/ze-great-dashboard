import { mint } from '@continuous-excellence/testmints-js/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Envelope, Panel } from '@ze-great-dashboard/shared/browser'
import { afterEach, describe, expect, test } from 'vitest'
import { PanelFrame, PanelMetadata } from '../src/PanelFrame.tsx'

const panel: Panel = {
  id: 'build',
  type: 'pipeline-status',
  position: { x: 2, y: 1, w: 4, h: 3 },
}

afterEach(cleanup)

describe('PanelFrame', () => {
  describe('identity and layout', () => {
    test(
      'owns the common label, layout, and loading state',
      mint({
        setup: () => ({ panel, position: panel.position! }),
        exercise: ({ panel }) =>
          render(
            <PanelFrame panel={panel}>
              <p>Loading…</p>
            </PanelFrame>,
          ).container,
        verify: (rendered, { panel, position }) => {
          const frame = rendered.querySelector('[data-panel]')

          expect(frame?.getAttribute('aria-busy')).toBe('true')
          expect(frame?.getAttribute('style')).toContain(
            `--panel-column: ${position.x + 1} / span ${position.w}`,
          )
          expect(frame?.getAttribute('style')).toContain(
            `--panel-row: ${position.y + 1} / span ${position.h}`,
          )
          expect(rendered.querySelector('[data-panel-identity-text]')?.textContent).toBe(panel.id)
          expect(rendered.querySelector('[data-panel-link]')).toBeNull()
        },
      }),
    )

    test(
      'uses a presentation label without changing the stable panel id',
      mint({
        setup: () => ({ panel: { ...panel, label: 'Build status' } }),
        exercise: ({ panel }) =>
          render(
            <PanelFrame panel={panel}>
              <p>Loading…</p>
            </PanelFrame>,
          ).container,
        verify: (rendered, { panel }) => {
          expect(rendered.querySelector('[data-panel-identity-text]')?.textContent).toBe(
            panel.label,
          )
          expect(rendered.querySelector('[data-panel]')?.getAttribute('style')).toContain(
            '--panel-column',
          )
        },
      }),
    )

    test(
      'defaults to auto density',
      mint({
        setup: () => ({ panel }),
        exercise: ({ panel }) =>
          render(
            <PanelFrame panel={panel}>
              <p>Value</p>
            </PanelFrame>,
          ).container,
        verify: (rendered, { panel }) => {
          expect(rendered.querySelector('[data-panel]')?.getAttribute('data-density')).toBe(
            panel.density ?? 'auto',
          )
        },
      }),
    )

    test(
      'preserves explicit density',
      mint({
        setup: () => ({ panel: { ...panel, density: 'compact' as const } }),
        exercise: ({ panel }) =>
          render(
            <PanelFrame panel={panel}>
              <p>Value</p>
            </PanelFrame>,
          ).container,
        verify: (rendered, { panel }) => {
          expect(rendered.querySelector('[data-panel]')?.getAttribute('data-density')).toBe(
            panel.density,
          )
        },
      }),
    )

    test(
      'exposes the opt-in status-band layout hook',
      mint({
        setup: () => ({ panel, layout: 'status-band' as const }),
        exercise: ({ panel, layout }) =>
          render(
            <PanelFrame panel={panel} layout={layout}>
              <p>Value</p>
            </PanelFrame>,
          ).container,
        verify: (rendered, { layout }) => {
          expect(
            rendered.querySelector('[data-panel-content]')?.getAttribute('data-panel-layout'),
          ).toBe(layout)
        },
      }),
    )
  })

  describe('metadata presentation', () => {
    test(
      'retains a full metadata value while offering a text-light alternative',
      mint({
        setup: () => ({
          panel,
          metadata: {
            glyph: '◷',
            label: 'Duration',
            value: 'Took 7 minutes',
            compact: { kind: 'short-value' as const, value: '7m' },
            title: 'Duration: Took 7 minutes',
          },
        }),
        exercise: ({ panel, metadata }) =>
          render(
            <PanelFrame panel={panel}>
              <PanelMetadata {...metadata} />
            </PanelFrame>,
          ).container,
        verify: (rendered, { metadata }) => {
          expect(rendered.textContent).toContain(`${metadata.label}:`)
          expect(rendered.querySelector('[data-panel-meta] [title]')?.getAttribute('title')).toBe(
            metadata.title,
          )
          expect(
            rendered.querySelector('[aria-hidden="true"] + .screen-reader-only')?.textContent,
          ).toBe(`${metadata.label}: `)
          expect(rendered.textContent).toContain(metadata.compact.value)
        },
      }),
    )
  })

  describe('source action', () => {
    test(
      'owns error styling and the accessible source action',
      mint({
        setup: () => ({
          panel,
          sourceActionLabel: `View source for ${panel.id} (opens in a new tab)`,
          envelope: {
            panelId: 'build',
            state: 'error',
            observedAt: '2026-08-18T12:00:00.000Z',
            link: 'https://github.com/example/repo/actions/workflows/build.yml',
            error: { kind: 'unreachable', message: 'offline' },
          } satisfies Envelope,
        }),
        exercise: ({ panel, envelope }) =>
          render(
            <PanelFrame panel={panel} envelope={envelope} error>
              <p>Unable to read</p>
            </PanelFrame>,
          ).container,
        verify: (rendered, { envelope, sourceActionLabel }) => {
          const frame = rendered.querySelector('[data-panel]')
          const link = screen.getByRole('link', { name: sourceActionLabel })

          expect(frame?.getAttribute('data-error')).toBe('true')
          expect(frame?.hasAttribute('aria-busy')).toBe(false)
          expect(link.getAttribute('href')).toBe(envelope.link)
          expect(link.getAttribute('target')).toBe('_blank')
          expect(link.getAttribute('rel')).toBe('noopener noreferrer')
          expect(link.getAttribute('aria-label')).toBe(sourceActionLabel)
          expect(link.getAttribute('title')).toBe(sourceActionLabel)
          expect(link.getAttribute('data-panel-action')).toBe('source')
          expect(link.className).toContain('sourceAction')
          expect(link.querySelector('[aria-hidden="true"]')?.textContent).toBe('↗')
          expect(frame?.querySelector('[data-panel-content] [data-panel-link]')).toBeNull()
        },
      }),
    )

    test(
      'omits the source action when the envelope has no link',
      mint({
        setup: () => ({
          panel,
          sourceActionLabel: `View source for ${panel.id} (opens in a new tab)`,
          envelope: {
            panelId: 'build',
            state: 'error',
            observedAt: '2026-08-18T12:00:00.000Z',
            link: null,
            error: { kind: 'unreachable', message: 'offline' },
          } satisfies Envelope,
        }),
        exercise: ({ panel, envelope }) =>
          render(
            <PanelFrame panel={panel} envelope={envelope}>
              <p>Unable to read</p>
            </PanelFrame>,
          ).container,
        verify: (_rendered, { sourceActionLabel }) => {
          expect(screen.queryByRole('link', { name: sourceActionLabel })).toBeNull()
        },
      }),
    )
  })
})
