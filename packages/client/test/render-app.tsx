import { render } from '@testing-library/react'
import type React from 'react'
import { StrictMode } from 'react'

/** Mirrors the Strict Mode root used by the normal client entrypoint. */
export function renderApp(node: React.ReactNode): HTMLElement {
  return render(<StrictMode>{node}</StrictMode>).container
}
