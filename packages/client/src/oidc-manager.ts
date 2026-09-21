import type { ClientEnv } from '@ze-great-dashboard/shared/browser'
import { type StateStore, User, UserManager, WebStorageStateStore } from 'oidc-client-ts'

export type OidcTestBootstrap = {
  accessToken: string
  expiresAt: number
  scope: string
  tokenType: string
}

declare global {
  interface Window {
    /** Ephemeral Playwright-only pre-module input; consumed and deleted before React mounts. */
    __DASHBOARD_OIDC_TEST_BOOTSTRAP__?: OidcTestBootstrap
  }
}

class MemoryStore implements StateStore {
  private readonly values = new Map<string, string>()
  async set(key: string, value: string) {
    this.values.set(key, value)
  }
  async get(key: string) {
    return this.values.get(key) ?? null
  }
  async remove(key: string) {
    const value = this.values.get(key) ?? null
    this.values.delete(key)
    return value
  }
  async getAllKeys() {
    return [...this.values.keys()]
  }
}

/** Creates the standards client; tokens remain in this tab's memory rather than browser storage. */
export function createOidcManager(auth: NonNullable<ClientEnv['auth']>) {
  const manager = new UserManager({
    authority: auth.issuer,
    client_id: auth.clientId,
    redirect_uri: `${window.location.origin}/`,
    post_logout_redirect_uri: `${window.location.origin}/`,
    response_type: 'code',
    scope: 'openid profile offline_access',
    resource: auth.audience,
    extraQueryParams: { audience: auth.audience },
    userStore: new MemoryStore(),
    // PKCE transaction data, not tokens, must survive the provider redirect.
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    automaticSilentRenew: true,
  })
  const bootstrap = consumeOidcTestBootstrap(window)
  if (bootstrap) {
    // MemoryStore mutates before its promise resolves, so AuthProvider's later async getUser sees
    // this user without placing a bearer anywhere durable.
    void manager.storeUser(
      new User({
        access_token: bootstrap.accessToken,
        expires_at: bootstrap.expiresAt,
        scope: bootstrap.scope,
        token_type: bootstrap.tokenType,
        // The API token has no ID-token profile. oidc-client-ts requires a profile object even
        // though this dashboard exposes only the access-token capability to its children.
        profile: {
          iss: auth.issuer,
          aud: auth.clientId,
          exp: bootstrap.expiresAt,
          iat: bootstrap.expiresAt - 1,
          sub: 'playwright-token-bootstrap',
        },
      }),
    )
  }
  return manager
}

/** Removes the test-only global before any application module can retain or expose it. */
export function consumeOidcTestBootstrap(source: Window = window): OidcTestBootstrap | undefined {
  const bootstrap = source.__DASHBOARD_OIDC_TEST_BOOTSTRAP__
  delete source.__DASHBOARD_OIDC_TEST_BOOTSTRAP__
  if (
    !bootstrap ||
    typeof bootstrap.accessToken !== 'string' ||
    !bootstrap.accessToken ||
    !Number.isSafeInteger(bootstrap.expiresAt) ||
    typeof bootstrap.scope !== 'string' ||
    typeof bootstrap.tokenType !== 'string'
  )
    return undefined
  return bootstrap
}
