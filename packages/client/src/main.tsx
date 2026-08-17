import { readClientEnv } from '@ze-great-dashboard/shared'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { ConfigError } from './ConfigError.tsx'
import './styles.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('No #root element in the document — the template is not the one we expect.')
}

const root = createRoot(container)

try {
  root.render(
    <StrictMode>
      <App env={readClientEnv()} />
    </StrictMode>,
  )
} catch (error) {
  // A radiator that fails silently is worse than one that says what's wrong. If configuration
  // never arrived, say so on screen rather than rendering an empty board.
  root.render(<ConfigError message={error instanceof Error ? error.message : String(error)} />)
}
