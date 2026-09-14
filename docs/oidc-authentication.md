# OIDC authentication

This dashboard can authenticate viewers directly with any OpenID Connect provider that supports discovery and Authorization Code with PKCE. The browser receives only the issuer, SPA client ID, and API audience. Source credentials, verification keys, and every upstream adapter remain server-side.

For a deployed dashboard that must never serve unauthenticated data, pair this block with top-level
`security: required`. That mode is fail-closed: if `auth` is removed or malformed, the server keeps
health checks available but blocks dashboard pages and every API endpoint rather than starting an
open proxy. `ALLOW_UNPROTECTED_DASHBOARD=true` only suppresses the soft `security: warn` notice; it
cannot override required mode. See [board configuration](board-configuration.md#deployment-security-policy)
for all three modes.

An ID token is never accepted by the dashboard API: the SPA requests an access token for the separately registered API audience and the server validates its signature, issuer, expiry, audience, and a non-empty `sub` before applying the configured authorization policy.

`authorization` is the canonical policy declaration. `authenticated` admits any verified API access token with a non-empty subject; this is the portable meaning of user-delegated access here. JWTs do not standardize a grant-type claim, so it deliberately does not try to infer a grant type. Normal client-credentials tokens lack `sub` and are rejected.

```yaml
auth:
  issuer: https://login.example.com/
  client_id: dashboard-spa-client-id
  audience: https://dashboard-api.example.com
  authorization:
    mode: authenticated
```

For a fixed set of identities, use `mode: subjects` and non-empty stable subjects. For a provider-issued top-level claim, use `mode: claim`; `claim` is an exact JWT payload key (including URI-namespaced Auth0 keys), `values` are non-empty strings, and `match` is required. `any` admits a token with at least one configured value; `all` requires every configured value. Claims that are not a string or an array of non-empty strings do not match.

```yaml
authorization:
  mode: claim
  claim: https://dashboard.example.com/roles
  values: [dashboard-viewer, dashboard-operator]
  match: any
```

The issuer, client ID, and audience are intentionally public browser configuration. Authorization values and subjects are not returned to browsers: admitted viewers can inspect only the policy mode and, for claim policy, its claim key and match mode. Do not put client secrets, source tokens, or refresh tokens in this file or in browser configuration.

## Auth0 setup

Create a Single Page Application and register `https://dashboard.example.com/` as both its Allowed Callback URL and Allowed Logout URL. Enable refresh-token rotation for the SPA. Create a Dashboard API, use its Identifier as `audience`, and authorize the SPA to request it. The application asks for `openid profile offline_access`; configure the API permission policy accordingly.

For role-based access, add an Auth0 Action that places the user's assigned dashboard roles in a namespaced **access-token** claim, then configure that exact claim key. For example, an Action can set `https://dashboard.example.com/roles` to an array of role names and the board can use the claim example above. Auth0 requires custom claims to be namespaced; do not use an ID-token-only claim because the proxy accepts API access tokens only. Test one role admitted by the policy and one authenticated role that is not; the latter must receive access denied before any source request occurs.

## Okta groups

Configure the authorization server to include `groups` in access tokens for the dashboard API audience, then match that exact top-level claim:

```yaml
authorization:
  mode: claim
  claim: groups
  values: [dashboard-viewers, incident-commanders]
  match: any
```

Use `all` only when membership in every listed group is genuinely required. Verify the claim is on the access token issued for this API, not merely on an ID token or userinfo response.

## Operations

The callback and logout return to `/`. Tokens and rotated refresh tokens are held in memory only, so a browser refresh intentionally requires sign-in again. Provider discovery is checked at server startup; unavailable or malformed discovery prevents startup. Remote JWKS are refreshed by the verifier when an unfamiliar key ID appears, supporting normal signing-key rotation.

Gateway token acquisition remains deferred. Provider-specific provisioning stays operator-owned, while the dashboard's claim evaluator is deliberately limited to exact top-level string or string-array claims.

## Auth0 endpoint API setup

This repository's Auth0 endpoint API release evidence uses an isolated slice in the configured Auth0 tenant. It owns only the uniquely named resources below and does not alter the tenant's existing applications, APIs, connections, or users:

- the existing `Username-Password-Authentication` database connection;
- the Dashboard API with identifier `ze-great-dashboard-test-api`;
- a confidential password-grant test runner and two permanent test-only users.

The test runner never calls the Management API and makes no tenant mutation. It signs in two manually created, permanent test-only users: one whose subject is admitted to the temporary board and one deliberately absent from it.

### One-time manual setup

This setup deliberately has no Deploy CLI configuration or tenant-sync workflow. The repository can share an Auth0 Free-plan tenant without carrying a tool that reconciles whole tenant resource categories. Create these resources in the Auth0 Dashboard once:

1. Under **Applications → APIs**, create `Ze Great Dashboard Test API` with identifier `ze-great-dashboard-test-api` and signing algorithm `RS256`. Add the `read:dashboard` permission.
2. Under **Applications → Applications**, create a **Regular Web Application** named `Ze Great Dashboard Test Runner`. In its Advanced Settings, enable the Password grant type and use client-secret POST authentication. Enable the existing `Username-Password-Authentication` connection for this application. The runner requests that connection explicitly as its Password-grant realm, so it does not depend on the tenant's default directory.
3. In `Username-Password-Authentication`, create two users with strong, distinct passwords: `dashboard-test` and `dashboard-test2`. They need no Management API access. Keep both passwords as secrets.

If a temporary Deploy CLI application or its GitHub secrets were created during the abandoned synchronization attempt, delete that application and remove `AUTH0_FUNCTIONAL_DEPLOY_CLIENT_ID` and `AUTH0_FUNCTIONAL_DEPLOY_CLIENT_SECRET` from GitHub. They are not used by the endpoint suite.

The domain, API identifier, connection, test-runner client ID, and the users' stable usernames and email login identifiers are checked in alongside the runner. The Password grant submits the email login identifier; the usernames identify the allowed and unlisted accounts in Auth0. Store the three secret values together in the administrator-owned Parameter Store boundary documented in [`infra/README.md`](../infra/README.md):

| JSON value | Key |
| --- | --- |
| Test-runner client secret | `AUTH0_FUNCTIONAL_TEST_RUNNER_CLIENT_SECRET` |
| Allowed-user password | `AUTH0_FUNCTIONAL_ALLOWED_PASSWORD` |
| Unlisted-user password | `AUTH0_FUNCTIONAL_UNLISTED_PASSWORD` |

The test runner's Password grant is restricted to trusted local/CI test execution. It validates API behavior after a user has authenticated and is not a dashboard sign-in mechanism. Do not configure Management API access for this application or either test user.

### Running the API suite

With an authorized AWS SSO session active, run:

```sh
npm run test:endpoint
```

The runner starts a temporary asset fixture and controlled HTTP-value upstream, then builds and starts the real dashboard through the repository's ordinary local Docker Compose shape. A test-only Compose overlay supplies an ephemeral loopback port and lets the container reach those host-owned fixtures; Compose's Docker health check is the startup gate. It verifies public health, missing-token `401`, allowed board and panel reads, unlisted-user `403` responses, the normal panel envelope, and that a denied panel read did not reach the upstream. Credentials and bearer tokens are never written to the board fixture, output, or artifacts.

The scheduled/manual **Auth0 endpoint API checks** workflow and the main Build gate assume the same narrowly scoped AWS reader role. Other branches explicitly skip the live provider checks, and the dedicated concurrency group avoids concurrent Password-grant load on the test identities. This complements the controlled discovery/JWKS tests. A future browser suite should reuse this tenant and test identities to cover Universal Login, callback handling, refresh, and authenticated browser requests; it should not replace this focused server API proof.
