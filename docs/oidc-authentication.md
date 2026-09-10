# OIDC authentication

This dashboard can authenticate viewers directly with any OpenID Connect provider that supports discovery and Authorization Code with PKCE. The browser receives only the issuer, SPA client ID, and API audience. Source credentials, verification keys, and every upstream adapter remain server-side.

Configure the board with stable OIDC subjects. An ID token is never accepted by the dashboard API: the SPA requests an access token for the separately registered API audience and the server validates its signature, issuer, expiry, audience, and `sub` against this allowlist.

```yaml
auth:
  issuer: https://login.example.com/
  client_id: dashboard-spa-client-id
  audience: https://dashboard-api.example.com
  allow:
    subjects:
      - auth0|0123456789abcdef
```

The issuer, client ID, and audience are intentionally public browser configuration. `subjects` are identity identifiers rather than secrets, but the complete board configuration remains behind the authenticated API. Do not put client secrets, source tokens, or refresh tokens in this file or in browser configuration.

## Auth0 setup

Create a Single Page Application and register `https://dashboard.example.com/` as both its Allowed Callback URL and Allowed Logout URL. Enable refresh-token rotation for the SPA. Create a Dashboard API, use its Identifier as `audience`, and authorize the SPA to request it. The application asks for `openid profile offline_access`; configure the API permission policy accordingly.

Find each viewer's stable subject in the Auth0 user record (`user_id`), then copy that exact value into `allow.subjects`. Test with one listed user and one authenticated but unlisted user: the latter should receive access denied from the API without any source request occurring.

## Operations

The callback and logout return to `/`. Tokens and rotated refresh tokens are held in memory only, so a browser refresh intentionally requires sign-in again. Provider discovery is checked at server startup; unavailable or malformed discovery prevents startup. Remote JWKS are refreshed by the verifier when an unfamiliar key ID appears, supporting normal signing-key rotation.

Gateway token acquisition and provider-specific groups, roles, and custom-claim mapping are deliberately deferred. Use explicit stable subjects until a portability policy for those claims exists.
