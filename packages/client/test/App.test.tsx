import type { ClientEnv } from '@ze-great-dashboard/shared'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../src/App.tsx'
import { ConfigError } from '../src/ConfigError.tsx'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  proxyPath: '/api',
  board: 'team-alpha',
  clientVersion: '1.0.7',
}

let container: HTMLDivElement | undefined

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
})

describe('the board shell', () => {
  it('names the board it was told it is', () => {
    expect(render(<App env={env} />).textContent).toContain('team-alpha')
  })

  it('shows which client version is running', () => {
    // This readout is what makes two published versions visibly different, which is the whole
    // point of the Stage 1 proof — a version you can't see doesn't demonstrate anything.
    const text = render(<App env={env} />).textContent
    expect(text).toContain('1.0.7')
    expect(text).toContain('https://assets.example.com/dashboard/1.0.7')
  })

  it('renders the panel grid', () => {
    expect(render(<App env={env} />).querySelectorAll('.panel').length).toBe(3)
  })

  it('says plainly that no signals are wired yet', () => {
    // An empty grid with no explanation reads as "everything is fine", which would be a lie.
    expect(render(<App env={env} />).textContent).toMatch(/No signals wired yet/i)
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
