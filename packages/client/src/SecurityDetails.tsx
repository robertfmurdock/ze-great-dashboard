import {
  type ClientEnv,
  type SecurityDetailsResponse,
  securityDetailsResponseSchema,
} from '@ze-great-dashboard/shared/browser'
import { useLayoutEffect, useRef, useState } from 'react'
import type { DashboardAuth } from './dashboard-fetch.ts'
import { dashboardFetch } from './dashboard-fetch.ts'
import styles from './SecurityDetails.module.css'

/** Safe policy metadata for an already admitted viewer; values and identity claims stay server-side. */
export function SecurityDetails({ env, auth }: { env: ClientEnv; auth: DashboardAuth }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [details, setDetails] = useState<SecurityDetailsResponse>()
  const dialogRef = useRef<HTMLDialogElement>(null)

  function dismiss() {
    dialogRef.current?.close()
    setOpen(false)
  }

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    dialog.showModal()
    return () => dialog.close()
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
        className={styles.control}
        type="button"
        aria-expanded={open}
        aria-controls="security-details-dialog"
        onClick={() => void show()}
      >
        Security
      </button>
      {open && (
        <dialog
          ref={dialogRef}
          className={styles.dialog}
          id="security-details-dialog"
          onCancel={(event) => {
            event.preventDefault()
            dismiss()
          }}
          aria-labelledby="security-title"
        >
          <h2 id="security-title">Security details</h2>
          {state === 'loading' && <p aria-live="polite">Loading security details…</p>}
          {state === 'error' && <p role="alert">Security details are unavailable.</p>}
          {details && <PolicyDetails details={details} />}
          <button type="button" onClick={dismiss}>
            Close
          </button>
        </dialog>
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
