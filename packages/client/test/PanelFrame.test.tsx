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
    const frame = rendered.querySelector('.panel')

    expect(frame?.getAttribute('aria-busy')).toBe('true')
    expect(frame?.getAttribute('style')).toContain('--panel-column: 3 / span 4')
    expect(frame?.getAttribute('style')).toContain('--panel-row: 2 / span 3')
    expect(rendered.querySelector('.panel__label')?.textContent).toBe('build')
    expect(rendered.querySelector('.panel__link')).toBeNull()
  })

  it('uses the panel display role as a semantic presentation class', () => {
    const rendered = render(
      <PanelFrame panel={{ ...panel, display: 'compact' }}>
        <p>Value</p>
      </PanelFrame>,
    ).container

    expect(rendered.querySelector('.panel')?.classList.contains('panel--compact')).toBe(true)
  })

  it('falls back to supporting presentation for an unknown future role', () => {
    const rendered = render(
      <PanelFrame panel={{ ...panel, display: 'hero' }}>
        <p>Value</p>
      </PanelFrame>,
    ).container

    expect(rendered.querySelector('.panel')?.classList.contains('panel--supporting')).toBe(true)
    expect(rendered.querySelector('.panel')?.classList.contains('panel--hero')).toBe(false)
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
    const frame = rendered.querySelector('.panel')
    const link = rendered.querySelector('.panel__link')

    expect(frame?.classList.contains('panel--error')).toBe(true)
    expect(frame?.hasAttribute('aria-busy')).toBe(false)
    expect(link?.getAttribute('href')).toBe(envelope.link)
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link?.getAttribute('aria-label')).toBe('View source for build (opens in a new tab)')
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

    expect(rendered.querySelector('.panel__link')).toBeNull()
  })
})
