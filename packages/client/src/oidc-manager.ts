import type { ClientEnv } from '@ze-great-dashboard/shared'
import { type StateStore, UserManager, WebStorageStateStore } from 'oidc-client-ts'

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
  return new UserManager({
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
}
