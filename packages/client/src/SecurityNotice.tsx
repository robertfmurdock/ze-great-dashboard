import type { ClientSecurityState } from '@ze-great-dashboard/shared'
import styles from './SecurityNotice.module.css'

const authenticationGuide =
  'https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/oidc-authentication.md'

/** Deployment-level posture, intentionally separate from panel health and diagnostics. */
export function SecurityNotice({ mode }: { mode: ClientSecurityState }) {
  if (mode === 'blocked')
    return (
      <main className={styles.blocked} role="alert">
        <h1>⚠ Authentication configuration required</h1>
        <p>
          This dashboard is blocked because authentication is required but has not been configured.
        </p>
        <p>No dashboard data was loaded.</p>
        <p>
          <a href={authenticationGuide}>Read the authentication setup guide</a>.
        </p>
      </main>
    )
  return (
    <aside className={styles.notice} role="alert" aria-label="Unauthenticated deployment warning">
      <span aria-hidden="true">⚠</span>
      <span>
        <strong>This deployment has no authentication.</strong> If this is reachable on a public
        network and reveals important information, take it down now. Configure the board’s{' '}
        <code>auth</code> block and <code>security: required</code>, or set{' '}
        <code>security: unsecured</code> to explicitly acknowledge intentional public access.{' '}
        <a href={authenticationGuide}>Read the authentication setup guide</a>.
      </span>
    </aside>
  )
}
