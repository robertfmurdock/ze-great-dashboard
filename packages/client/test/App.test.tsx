import type { ClientEnv } from '@ze-great-dashboard/shared'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { ConfigError } from '../src/ConfigError.tsx'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  proxyPath: '/api',
  board: 'ze-great-team',
  clientVersion: '1.0.7',
}

let container: HTMLDivElement | undefined

beforeEach(() => {
  // The shell tests do not exercise networking; keep their effects local rather than allowing
  // happy-dom to try a relative request during teardown.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ panels: [] }))),
  )
})

function render(node: React.ReactNode): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(<StrictMode>{node}</StrictMode>))
  return container
}

afterEach(() => {
  container?.remove()
  container = undefined
  vi.unstubAllGlobals()
})

describe('the board shell', () => {
  it('names the board it was told it is', () => {
    expect(render(<App env={env} />).textContent).toContain('ze-great-team')
  })

  it('shows which client version is running', () => {
    // This readout is what makes two published versions visibly different, which is the whole
    // point of the Stage 1 proof — a version you can't see doesn't demonstrate anything.
    const text = render(<App env={env} />).textContent
    expect(text).toContain('1.0.7')
    expect(text).toContain('https://assets.example.com/dashboard/1.0.7')
  })

  it('renders a loading panel until the server provides its board config', () => {
    expect(render(<App env={env} />).textContent).toMatch(/Loading configuration/i)
  })

  it('explains that signals come from their configured authorities', () => {
    expect(render(<App env={env} />).textContent).toMatch(/read live/i)
  })
})

describe('when configuration never arrived', () => {
  it('says so on screen instead of rendering an empty board', () => {
    const text = render(<ConfigError message="assetPath: required" />).textContent

    expect(text).toMatch(/misconfigured/i)
    expect(text).toContain('assetPath: required')
  })

  it('announces itself to assistive technology', () => {
    expect(render(<ConfigError message="broken" />).querySelector('[role="alert"]')).not.toBeNull()
  })
})
