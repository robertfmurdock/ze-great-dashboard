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

## Auth0 functional API setup

This repository's Auth0 API release evidence uses an isolated functional slice in the configured Auth0 tenant. It owns only the uniquely named resources below and does not alter the tenant's existing applications, APIs, connections, or users:

- the existing `Username-Password-Authentication` database connection;
- the Dashboard API with identifier `ze-great-dashboard-test-api`;
- a confidential password-grant test runner and two permanent test-only users.

The test runner never calls the Management API and makes no tenant mutation. It signs in two manually created, permanent test-only users: one whose subject is admitted to the temporary board and one deliberately absent from it.

### One-time manual setup

This setup deliberately has no Deploy CLI configuration or tenant-sync workflow. The repository can share an Auth0 Free-plan tenant without carrying a tool that reconciles whole tenant resource categories. Create these resources in the Auth0 Dashboard once:

1. Under **Applications → APIs**, create `Ze Great Dashboard Test API` with identifier `ze-great-dashboard-test-api` and signing algorithm `RS256`. Add the `read:dashboard` permission.
2. Under **Applications → Applications**, create a **Regular Web Application** named `Ze Great Dashboard Test Runner`. In its Advanced Settings, enable the Password grant type and use client-secret POST authentication. Enable the existing `Username-Password-Authentication` connection for this application. The runner requests that connection explicitly as its Password-grant realm, so it does not depend on the tenant's default directory.
3. In `Username-Password-Authentication`, create two users with strong, distinct passwords: `dashboard-test` and `dashboard-test2`. They need no Management API access. Keep both passwords as secrets.

If a temporary Deploy CLI application or its GitHub secrets were created during the abandoned synchronization attempt, delete that application and remove `AUTH0_FUNCTIONAL_DEPLOY_CLIENT_ID` and `AUTH0_FUNCTIONAL_DEPLOY_CLIENT_SECRET` from GitHub. They are not used by the functional suite.

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
npm run test:auth0-functional
```

The runner starts a temporary asset fixture and controlled HTTP-value upstream, then builds and starts the real dashboard through the repository's ordinary local Docker Compose shape. A test-only Compose overlay supplies an ephemeral loopback port and lets the container reach those host-owned fixtures; Compose's Docker health check is the startup gate. It verifies public health, missing-token `401`, allowed board and panel reads, unlisted-user `403` responses, the normal panel envelope, and that a denied panel read did not reach the upstream. Credentials and bearer tokens are never written to the board fixture, output, or artifacts.

The scheduled/manual **Auth0 functional API checks** workflow and the main Build gate assume the same narrowly scoped AWS reader role. Other branches explicitly skip the live provider checks, and the dedicated concurrency group avoids concurrent Password-grant load on the test identities. This complements the controlled discovery/JWKS tests. A future browser suite should reuse this tenant and test identities to cover Universal Login, callback handling, refresh, and authenticated browser requests; it should not replace this focused server API proof.
