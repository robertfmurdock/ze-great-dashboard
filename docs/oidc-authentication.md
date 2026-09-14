# OIDC authentication

Ze Great Dashboard supports OpenID Connect providers with discovery and Authorization Code with
PKCE. The browser receives only the issuer, SPA client ID, and API audience. Source credentials,
verification keys, and upstream adapters remain server-side.

For a deployed dashboard that must never serve unauthenticated data, set top-level
`security: required`. If `auth` is missing or invalid, the server keeps health checks available but
blocks dashboard pages and APIs. `ALLOW_UNPROTECTED_DASHBOARD=true` cannot override required mode.
See [deployment security policy](board-configuration.md#deployment-security-policy) for all modes.

The SPA requests an access token for a separately registered API audience. The server rejects ID
tokens and validates the access token's signature, issuer, expiry, audience, and non-empty `sub`
before applying the authorization policy.

## Configure authentication

To admit any authenticated user with a verified token and non-empty subject:

```yaml
auth:
  issuer: https://login.example.com/
  client_id: dashboard-spa-client-id
  audience: https://dashboard-api.example.com
  authorization:
    mode: authenticated
```

This mode does not infer a grant type because JWTs have no standard grant-type claim. Ordinary
client-credentials tokens have no `sub` and are rejected.

To admit a fixed set of identities, use stable provider subjects:

```yaml
authorization:
  mode: subjects
  subjects: [provider-subject-1, provider-subject-2]
```

To authorize from a provider-issued top-level claim:

```yaml
authorization:
  mode: claim
  claim: https://dashboard.example.com/roles
  values: [dashboard-viewer, dashboard-operator]
  match: any
```

`claim` is the exact JWT payload key, including any URI namespace. `any` requires at least one
configured value; `all` requires every configured value. Only a string or an array of non-empty
strings can match.

The issuer, client ID, and audience are intentionally public browser configuration. Authorization
subjects and values are not returned to browsers; admitted viewers can inspect only the policy mode
and, for claim policy, its key and match mode. Never put client secrets, source tokens, or refresh
tokens in the board file or browser configuration.

## Auth0

1. Create a Single Page Application and register the dashboard root URL, such as
   `https://dashboard.example.com/`, as both an Allowed Callback URL and Allowed Logout URL.
2. Enable refresh-token rotation for the SPA.
3. Create a Dashboard API, use its Identifier as `audience`, and authorize the SPA to request it.
4. Permit the SPA scopes `openid profile offline_access`.

For role-based access, add an Auth0 Action that places assigned dashboard roles in a namespaced
**access-token** claim, then configure that exact claim key. Do not use an ID-token-only claim.
Before rollout, verify that one intended role is admitted and one authenticated user without that
role is denied.

## Okta groups

Configure the authorization server to include `groups` in access tokens for the dashboard API
audience, then match that exact top-level claim:

```yaml
authorization:
  mode: claim
  claim: groups
  values: [dashboard-viewers, incident-commanders]
  match: any
```

Use `all` only when every listed group is required. Verify that the claim appears on the access
token for this API, not only on an ID token or userinfo response.

## Operational behavior

The callback and logout return to `/`. Tokens and rotated refresh tokens are held in browser memory
only, so refreshing the page requires sign-in again.

Provider discovery is checked at server startup; unavailable or malformed discovery prevents
startup. The verifier refreshes remote JWKS when it encounters an unfamiliar key ID, supporting
normal signing-key rotation.

Gateway token acquisition is not supported. Provider provisioning remains operator-owned, and
claim authorization is limited to exact top-level string or string-array claims.
