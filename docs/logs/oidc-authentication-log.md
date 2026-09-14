# Direct OIDC authentication

## 2026-09-10

The first dashboard authentication mode is direct browser OIDC using Authorization Code with PKCE. The access-token audience is a separately registered API resource, so ID tokens cannot become proxy credentials by accident. The authorization rule is an explicit stable `sub` allowlist; groups, roles, custom claims, and gateway mode remain deferred because their meaning is not portable across providers.

`oidc-client-ts` was added in the client for discovery, PKCE, provider callback/logout, and renewal behavior; its in-memory stores keep both access and refresh tokens out of browser storage. `react-oidc-context` owns the React lifecycle, callback processing, and renewal state rather than a dashboard-specific auth boundary. Dashboard code receives an explicit, narrow authenticated-request capability—there is no module-global token holder. `jose` was added server-side for standards-compliant JWT verification and remote JWKS rotation. These replace bespoke security-sensitive protocol code, at the cost of small audited runtime dependencies.

Auth0 was selected as the intended acceptance provider because its SPA and API registrations exercise the standard flow, not because it is a runtime dependency. Operators must still run the documented two-user acceptance check against their own tenant before enabling this mode.

## 2026-09-14

Authorization became declarative without moving the trust boundary: signature, discovery, issuer,
audience, expiry, and non-empty-subject checks still happen before every API route, then one
server-only evaluator applies `authenticated`, `subjects`, or exact top-level claim policy. The
old `allow.subjects` shape remains a migration-only spelling of subject policy; competing old and
new declarations fail configuration validation rather than choosing one silently.

“User-delegated” is defined portably as a verified API access token with a non-empty `sub`. Grant
type is not a standard JWT claim, so attempting to distinguish flows from token payloads would have
created provider-specific and unreliable authorization. This rejects normal client-credentials
tokens while retaining an auditable rule.

The new authenticated Security details route exposes only OIDC presence, policy mode, and claim
key/match metadata. It intentionally omits subjects, configured claim values, raw claims, and
tokens; layout downloads now omit `auth` for the same non-disclosure boundary. The footer dialog
uses the existing authenticated request capability, so a denied response continues to lead to the
generic denied screen instead of revealing policy details.

`@testing-library/user-event` was added as a test-only dependency. It adds realistic asynchronous
browser interaction semantics for controls, keyboard navigation, and focus, which the existing
event utility intentionally does not simulate. Client tests now use it as the default for user
actions; direct `fireEvent` remains reserved for deliberate low-level event contracts. The small
development dependency cost is justified by making accessibility behavior and examples of the
public interaction surface part of release evidence.
