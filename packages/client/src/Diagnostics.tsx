import { useState, useSyncExternalStore } from 'react'
import type { BrowserDiagnosticStore } from './diagnostics.ts'

export function Diagnostics({ log }: { log: BrowserDiagnosticStore }) {
  const [open, setOpen] = useState(false)
  const count = useSyncExternalStore(log.subscribe, log.count, log.count)
  const download = () => {
    const blob = new Blob([JSON.stringify(log.export(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `dashboard-diagnostics-${new Date().toISOString().replaceAll(':', '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  const clear = () => {
    if (!window.confirm('Clear this browser’s retained dashboard diagnostics?')) return
    log.clear()
  }

  return (
    <section className="diagnostics">
      <button
        className="diagnostics__toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Diagnostics ({count})
      </button>
      {open && (
        <div className="diagnostics__area">
          <p>{count} retained browser-local events. They are never uploaded.</p>
          <div className="diagnostics__actions">
            <button type="button" onClick={download}>
              Download
            </button>
            <button type="button" onClick={clear}>
              Clear
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
