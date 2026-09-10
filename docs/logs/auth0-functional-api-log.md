# Real Auth0 API functional evidence

## 2026-09-10

The OIDC unit tests already exercise discovery and JWKS rotation with controlled keys, but they cannot establish that a real provider issues an API access token with the expected audience and subject or that the dashboard rejects a real authenticated, unlisted user before calling an upstream. An isolated functional slice in the existing Auth0 tenant now supplies that missing release evidence.

The Dashboard API, one confidential test-runner application, and two permanent test-only users are an explicit one-time manual setup. The runner uses the tenant's existing `Username-Password-Authentication` connection rather than introducing another connection solely for this check. Its Password-grant requests use each account's email login identifier rather than its display username, matching the successful interactive authentication path. The earlier per-run Management API provisioner was removed: it made the test independent of durable user credentials, but required a second machine-to-machine client with tenant mutation authority. The revised runner signs in the two fixed users and reads the allowed user's token subject into its temporary board configuration. The server still verifies that token cryptographically; decoding its subject merely prepares the allowlist.

The functional runner uses the Password grant only inside trusted CI/local automation to acquire real user API tokens. It is evidence for the API authorization boundary, not an implementation choice for dashboard login; browser automation remains the appropriate future evidence for Universal Login and callback behavior. It builds and starts the real dashboard through the existing local Docker Compose shape, with a narrowly scoped test overlay for an ephemeral loopback port and host fixture routing. That prevents a second server-launch contract from drifting away from the deployed shape. The runner proves the complete allow/deny matrix, including that a denied panel request creates no controlled-upstream observation.

The available Auth0 Free plan permits only one tenant, so the setup runs as an isolated functional slice in the existing tenant rather than demanding a paid tenant solely for release evidence. Deploy CLI was rejected because its shared-tenant dry run proposed unrelated deletions even when deletion was disabled. Leaving that reconciliation mechanism in the repository would make a future accidental change to its deletion policy too consequential. The documented manual setup is intentionally the only mutation path; later drift is detected by the functional test and repaired deliberately. The functional workflow runs only for `main`, a schedule, or manual dispatch with credentials scoped to its GitHub environment. This limits tenant mutation and avoids exposing test credentials to pull requests or forks.

The first real Compose boot exposed an interoperability detail that controlled OIDC tests could not: Auth0's discovery document returns `issuer` with a trailing slash. The verifier now compares issuer URLs canonically while passing the provider's exact discovered issuer to JWT validation. The functional runner also prints a redacted, direct Docker state/log diagnostic when startup fails, so future image or network failures are actionable without weakening production-safe server logs.

### Container-check and credential consolidation

The packaged-image health check and Auth0 runner previously built and launched separate containers,
so the expensive release boundary was duplicated and the ordinary gate proved only Docker health.
They now share one container-functional lifecycle: host-only asset and upstream fixtures, one
uniquely tagged production image, one loopback-published Compose server, and unconditional teardown.
Every check proves the health, rendered entrypoint, board route, proxy route, and normalized signal;
when live credentials are available, that same configured server additionally proves Auth0's 401,
allowed-user, unlisted-user 403, and pre-upstream denial contracts. API-mocked browser tests remain
on Vite because their boundary is client behavior and sharing this authenticated server would turn
the change into a browser-login redesign.

The three credential values move as one JSON object to a fixed SSM `SecureString`, encrypted by a
dedicated customer-managed key. A narrowly scoped reader role trusts only the immutable-ID `main`
GitHub OIDC subject and an administrator-selected local SSO role; its decrypt permission is
constrained to SSM and the exact parameter encryption context. Local resolution tries the current
identity and then assumes that reader role without creating a credential file. Credential discovery
failure is an explicit local skip, while retrieval followed by any provider or assertion failure is
fatal. Trusted workflows select strictness explicitly instead of treating generic `CI` as trust.
The initial rollout retained direct environment values as a bridge. The consolidation follow-up
removed that fallback before parameter population, leaving one credential contract to exercise and
preventing the migration path from becoming permanent. The shared runner was also separated along
its stable interfaces—AWS resolution, Auth0 token acquisition, HTTP fixtures/assertions, and Docker
lifecycle—and the Compose overlay was renamed for its now provider-independent purpose. Retrieved
malformed parameter data is reported directly rather than being obscured by a pointless role-assume
fallback.
