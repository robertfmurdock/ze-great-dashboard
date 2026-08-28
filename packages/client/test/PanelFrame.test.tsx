import { cleanup, render } from '@testing-library/react'
import type { Envelope, Panel } from '@ze-great-dashboard/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { PanelFrame } from '../src/PanelFrame.tsx'

const panel: Panel = {
  id: 'build',
  type: 'pipeline-status',
  position: { x: 2, y: 1, w: 4, h: 3 },
}

afterEach(cleanup)

describe('PanelFrame', () => {
  it('owns the common label, layout, and loading state', () => {
    const rendered = render(
      <PanelFrame panel={panel}>
        <p>Loading…</p>
      </PanelFrame>,
    ).container
    const frame = rendered.querySelector('[data-panel]')

    expect(frame?.getAttribute('aria-busy')).toBe('true')
    expect(frame?.getAttribute('style')).toContain('--panel-column: 3 / span 4')
    expect(frame?.getAttribute('style')).toContain('--panel-row: 2 / span 3')
    expect(rendered.querySelector('h2')?.textContent).toBe('build')
    expect(rendered.querySelector('[data-panel-link]')).toBeNull()
  })

  it('uses a presentation label without changing the stable panel id', () => {
    const rendered = render(
      <PanelFrame panel={{ ...panel, label: 'Build status' }}>
        <p>Loading…</p>
      </PanelFrame>,
    ).container

    expect(rendered.querySelector('h2')?.textContent).toBe('Build status')
    expect(rendered.querySelector('[data-panel]')?.getAttribute('style')).toContain(
      '--panel-column',
    )
  })

  it('defaults to auto density and preserves explicit density', () => {
    const rendered = render(
      <PanelFrame panel={panel}>
        <p>Value</p>
      </PanelFrame>,
    ).container

    expect(rendered.querySelector('[data-panel]')?.getAttribute('data-density')).toBe('auto')
    const explicit = render(
      <PanelFrame panel={{ ...panel, density: 'compact' }}>
        <p>Value</p>
      </PanelFrame>,
    ).container
    expect(explicit.querySelector('[data-panel]')?.getAttribute('data-density')).toBe('compact')
  })

  it('owns error styling and the accessible source action', () => {
    const envelope: Envelope = {
      panelId: 'build',
      state: 'error',
      observedAt: '2026-08-18T12:00:00.000Z',
      link: 'https://github.com/example/repo/actions/workflows/build.yml',
      error: { kind: 'unreachable', message: 'offline' },
    }
    const rendered = render(
      <PanelFrame panel={panel} envelope={envelope} error>
        <p>Unable to read</p>
      </PanelFrame>,
    ).container
    const frame = rendered.querySelector('[data-panel]')
    const link = rendered.querySelector('[data-panel-link]')

    expect(frame?.getAttribute('data-error')).toBe('true')
    expect(frame?.hasAttribute('aria-busy')).toBe(false)
    expect(link?.getAttribute('href')).toBe(envelope.link)
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link?.getAttribute('aria-label')).toBe('View source for build (opens in a new tab)')
    expect(link?.getAttribute('title')).toBe('View source for build (opens in a new tab)')
    expect(link?.getAttribute('data-panel-action')).toBe('source')
    expect(link?.className).toContain('sourceAction')
    expect(link?.querySelector('[aria-hidden="true"]')?.textContent).toBe('↗')
    expect(frame?.querySelector('[data-panel-content] [data-panel-link]')).toBeNull()
  })

  it('omits the source action when the envelope has no link', () => {
    const envelope: Envelope = {
      panelId: 'build',
      state: 'error',
      observedAt: '2026-08-18T12:00:00.000Z',
      link: null,
      error: { kind: 'unreachable', message: 'offline' },
    }
    const rendered = render(
      <PanelFrame panel={panel} envelope={envelope}>
        <p>Unable to read</p>
      </PanelFrame>,
    ).container

    expect(rendered.querySelector('[data-panel-link]')).toBeNull()
  })
})
