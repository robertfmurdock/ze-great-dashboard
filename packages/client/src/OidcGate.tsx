import type { ClientEnv } from '@ze-great-dashboard/shared/browser'
import { ErrorResponse } from 'oidc-client-ts'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthProvider, hasAuthParams, useAuth } from 'react-oidc-context'
import styles from './AuthBoundary.module.css'
import { Diagnostics } from './Diagnostics.tsx'
import { BrowserDiagnosticStore, type DiagnosticSink } from './diagnostics.ts'
import { createOidcManager } from './oidc-manager.ts'

export function OidcGate({
  env,
  auth,
  children,
}: {
  env: ClientEnv
  auth: NonNullable<ClientEnv['auth']>
  children: (
    token: string,
    denied: () => void,
    env: ClientEnv,
    diagnostics: BrowserDiagnosticStore,
  ) => ReactNode
}) {
  const manager = useMemo(() => createOidcManager(auth), [auth])
  const [returnBoard, setReturnBoard] = useState<string>()
  const currentEnv = useMemo(
    () => (returnBoard ? { ...env, board: returnBoard } : env),
    [env, returnBoard],
  )
  const diagnostics = useMemo(() => new BrowserDiagnosticStore(currentEnv), [currentEnv])
  const completeCallback = useCallback((state: unknown) => {
    const board = typeof state === 'string' && state ? state : undefined
    const path = board ? `/boards/${encodeURIComponent(board)}` : window.location.pathname
    window.history.replaceState({}, document.title, path)
    setReturnBoard(board)
  }, [])
  return (
    <AuthProvider userManager={manager} onSigninCallback={(user) => completeCallback(user?.state)}>
      <AuthScreen
        env={currentEnv}
        diagnostics={diagnostics}
        diagnosticsControl={<Diagnostics log={diagnostics} />}
        completeCallback={completeCallback}
      >
        {(token, denied) => children(token, denied, currentEnv, diagnostics)}
      </AuthScreen>
    </AuthProvider>
  )
}

function AuthScreen({
  env,
  diagnostics,
  diagnosticsControl,
  completeCallback,
  children,
}: {
  env: ClientEnv
  diagnostics: DiagnosticSink
  diagnosticsControl: ReactNode
  completeCallback: (state: unknown) => void
  children: (token: string, denied: () => void) => ReactNode
}) {
  const auth = useAuth()
  const [denied, setDenied] = useState(false)
  const [isCallback] = useState(hasAuthParams)
  const [expiredUser, setExpiredUser] = useState<typeof auth.user>()
  const attemptedRestore = useRef(false)
  const lastError = useRef<typeof auth.error>(undefined)
  const lastUser = useRef<typeof auth.user>(undefined)
  const signedOutKey = `dashboard.signed-out:${env.auth?.issuer}:${env.auth?.clientId}`
  const deny = useCallback(() => setDenied(true), [])
  const { events, user, error, signinRedirect } = auth
  const expired = !!user && (user === expiredUser || user.expired)
  const returnBoard = window.location.pathname.startsWith('/boards/') ? env.board : undefined

  useEffect(() => {
    if (!auth.isAuthenticated) setDenied(false)
  }, [auth.isAuthenticated])

  useEffect(() => {
    if (!user?.expires_at) return
    return events.addAccessTokenExpired(() => setExpiredUser(user))
  }, [events, user])

  useEffect(() => {
    if (!user || user.expired || user === lastUser.current) return
    lastUser.current = user
    diagnostics.record({
      kind: 'auth-session',
      outcome: 'ready',
      hasRefreshToken: !!user.refresh_token,
    })
  }, [diagnostics, user])

  useEffect(() => {
    if (!error || error === lastError.current) return
    lastError.current = error
    const cause = error.innerError
    diagnostics.record({
      kind: 'auth-session',
      outcome: 'failed',
      phase:
        error.source === 'renewSilent'
          ? 'renewal'
          : error.source === 'signinCallback'
            ? 'callback'
            : 'navigation',
      reason: authFailureReason(cause),
    })
    if (error.source === 'signinCallback' && hasAuthParams()) {
      completeCallback(cause instanceof ErrorResponse ? cause.state : undefined)
    }
  }, [completeCallback, diagnostics, error])

  const shouldRestore =
    !attemptedRestore.current &&
    !auth.isLoading &&
    !auth.activeNavigator &&
    !denied &&
    (!isCallback || auth.isAuthenticated) &&
    (!auth.isAuthenticated || (expired && error?.source === 'renewSilent')) &&
    !window.sessionStorage.getItem(signedOutKey)

  useEffect(() => {
    if (!shouldRestore || attemptedRestore.current) return
    attemptedRestore.current = true
    diagnostics.record({
      kind: 'auth-session',
      outcome: 'restoring',
      trigger: expired ? 'expiry' : 'startup',
    })
    // Top-level navigation gives the provider access to its first-party session cookie.
    void signinRedirect({ prompt: 'none', redirectMethod: 'replace', state: returnBoard })
  }, [diagnostics, expired, returnBoard, shouldRestore, signinRedirect])

  if (shouldRestore || auth.isLoading || (auth.isAuthenticated && expired && !error))
    return (
      <main className={styles.auth} aria-live="polite">
        {shouldRestore || attemptedRestore.current || expired
          ? 'Restoring session…'
          : 'Signing in…'}
      </main>
    )
  if (denied)
    return (
      <main className={styles.auth}>
        <h1>Access denied</h1>
        <p>Your authenticated identity is not permitted to view this dashboard.</p>
        {diagnosticsControl}
      </main>
    )
  if (!auth.isAuthenticated || expired || !user?.access_token)
    return (
      <main className={styles.auth}>
        <h1>{env.board}</h1>
        <p>Sign in to view the dashboard.</p>
        <button
          type="button"
          onClick={() => {
            window.sessionStorage.removeItem(signedOutKey)
            diagnostics.record({ kind: 'auth-session', outcome: 'sign-in-selected' })
            void signinRedirect({ state: returnBoard })
          }}
        >
          Sign in
        </button>
        {diagnosticsControl}
      </main>
    )
  return (
    <>
      <button
        className={styles.signout}
        type="button"
        onClick={() => {
          window.sessionStorage.setItem(signedOutKey, '1')
          diagnostics.record({ kind: 'auth-session', outcome: 'sign-out-selected' })
          void auth.signoutRedirect()
        }}
      >
        Sign out
      </button>
      {children(user.access_token, deny)}
    </>
  )
}

function authFailureReason(error: unknown) {
  if (error instanceof ErrorResponse) {
    switch (error.error) {
      case 'login_required':
      case 'interaction_required':
      case 'consent_required':
      case 'account_selection_required':
      case 'invalid_grant':
        return error.error
    }
  }
  if (error instanceof Error && error.name === 'ErrorTimeout') return 'timeout'
  return 'other'
}
