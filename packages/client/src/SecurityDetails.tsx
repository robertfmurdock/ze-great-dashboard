import {
  type ClientEnv,
  type SecurityDetailsResponse,
  securityDetailsResponseSchema,
} from '@ze-great-dashboard/shared/browser'
import { useEffect, useRef, useState } from 'react'
import type { DashboardAuth } from './dashboard-fetch.ts'
import { dashboardFetch } from './dashboard-fetch.ts'
import styles from './SecurityDetails.module.css'

/** Safe policy metadata for an already admitted viewer; values and identity claims stay server-side. */
export function SecurityDetails({ env, auth }: { env: ClientEnv; auth: DashboardAuth }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [details, setDetails] = useState<SecurityDetailsResponse>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) triggerRef.current?.focus()
      wasOpenRef.current = false
      return
    }
    wasOpenRef.current = true
    const dismiss = () => setOpen(false)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ]
      const first = focusable.at(0)
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const dialog = dialogRef.current
    dialog?.addEventListener('keydown', containFocus)
    window.addEventListener('keydown', closeOnEscape)
    closeRef.current?.focus()
    return () => {
      dialog?.removeEventListener('keydown', containFocus)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  async function show() {
    setOpen(true)
    setState('loading')
    setDetails(undefined)
    try {
      const response = await dashboardFetch(
        env,
        `${env.proxyPath}/boards/${encodeURIComponent(env.board)}/security`,
        undefined,
        globalThis.fetch,
        auth,
      )
      if (!response.ok) throw new Error(`Security details returned ${response.status}`)
      const result = securityDetailsResponseSchema.safeParse(await response.json())
      if (!result.success) throw new Error('Security details were malformed')
      setDetails(result.data)
      setState('idle')
    } catch {
      setState('error')
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={styles.control}
        type="button"
        aria-expanded={open}
        aria-controls="security-details-dialog"
        onClick={() => void show()}
      >
        Security
      </button>
      {open && (
        <div className={styles.backdrop} role="presentation">
          <section
            ref={dialogRef}
            className={styles.dialog}
            id="security-details-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="security-title"
          >
            <h2 id="security-title">Security details</h2>
            {state === 'loading' && <p aria-live="polite">Loading security details…</p>}
            {state === 'error' && <p role="alert">Security details are unavailable.</p>}
            {details && <PolicyDetails details={details} />}
            <button ref={closeRef} type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </section>
        </div>
      )}
    </>
  )
}

function PolicyDetails({ details }: { details: SecurityDetailsResponse }) {
  if (details.policy.mode === 'claim')
    return (
      <p>
        OIDC is enabled. Access uses the <code>{details.policy.claim}</code> claim with a{' '}
        <strong>{details.policy.match}</strong> match policy.
      </p>
    )
  return details.policy.mode === 'authenticated' ? (
    <p>OIDC is enabled. Any verified API access token with a subject may view this board.</p>
  ) : (
    <p>OIDC is enabled. Access is limited to a server-held subject policy.</p>
  )
}
