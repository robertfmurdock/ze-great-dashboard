import type { ClientEnv } from '@ze-great-dashboard/shared'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { AuthProvider, useAuth } from 'react-oidc-context'
import styles from './AuthBoundary.module.css'
import { createOidcManager } from './oidc-manager.ts'

export function OidcGate({
  env,
  auth,
  children,
}: {
  env: ClientEnv
  auth: NonNullable<ClientEnv['auth']>
  children: (token: string, denied: () => void) => ReactNode
}) {
  const manager = useMemo(() => createOidcManager(auth), [auth])
  return (
    <AuthProvider
      userManager={manager}
      onSigninCallback={() =>
        window.history.replaceState({}, document.title, window.location.pathname)
      }
    >
      <AuthScreen env={env}>{children}</AuthScreen>
    </AuthProvider>
  )
}

function AuthScreen({
  env,
  children,
}: {
  env: ClientEnv
  children: (token: string, denied: () => void) => ReactNode
}) {
  const auth = useAuth()
  const [denied, setDenied] = useState(false)
  const deny = useCallback(() => setDenied(true), [])
  useEffect(() => {
    if (!auth.isAuthenticated) setDenied(false)
  }, [auth.isAuthenticated])
  if (auth.isLoading)
    return (
      <main className={styles.auth} aria-live="polite">
        Signing in…
      </main>
    )
  if (denied)
    return (
      <main className={styles.auth}>
        <h1>Access denied</h1>
        <p>Your authenticated identity is not permitted to view this dashboard.</p>
      </main>
    )
  if (!auth.isAuthenticated || !auth.user?.access_token)
    return (
      <main className={styles.auth}>
        <h1>{env.board}</h1>
        <p>Sign in to view the dashboard.</p>
        <button type="button" onClick={() => void auth.signinRedirect()}>
          Sign in
        </button>
      </main>
    )
  return (
    <>
      <button className={styles.signout} type="button" onClick={() => void auth.signoutRedirect()}>
        Sign out
      </button>
      {children(auth.user.access_token, deny)}
    </>
  )
}
