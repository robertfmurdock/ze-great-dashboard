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

## 2026-09-15

Reloads were needlessly presenting the dashboard's Sign in control even while an Auth0 session
could have restored the viewer without interaction. The OIDC manager already keeps access and
rotated refresh tokens in memory and can perform standards-based `prompt=none` authentication, but
the gate invoked that mechanism only to renew a loaded user before expiry. It now makes one silent
attempt after a memory-only reload, then leaves an unavailable or interaction-required provider
session at the ordinary Sign in control. This preserves the deliberate no-token-persistence/XSS
boundary while recovering the expected SSO experience where the provider cookie is available.

Browser privacy controls can still prevent a cross-site provider cookie from being used, so a visible
Sign in control remains a normal and necessary fallback.

Follow-up review considered replacing the small startup effect with
`react-oidc-context`'s `useAutoSignin`. That hook intentionally supports only redirect and popup
flows; its public types reject `signinSilent`, and its runtime default for an unrecognized method is
a full redirect. The generic `oidc-client-ts` manager remains responsible for the refresh-token and
iframe protocol mechanics, while this narrow boundary retains the one application policy the React
wrapper does not expose: attempt a silent session restoration once after reload. No new dependency
or unsafe type escape was justified.

Test miss, 2026-09-15: the existing OIDC client tests mocked the authentication context, and the
Auth0 functional runner used a trusted Password grant to test server-side API admission. Neither
loaded an authenticated Auth0 browser session and then reloaded the real dashboard, so they could
not reveal that the in-memory OIDC user was never replaced with an initial silent request. The new
component test proves the dashboard's no-user decision invokes `signinSilent`, but it cannot prove
the provider cookie, hidden iframe, callback, and PKCE exchange in a browser. A future browser
acceptance case against the configured Auth0 tenant should sign in through Universal Login, reload,
and assert that the board returns without a visible interaction; its complementary no-session case
should assert the Sign in control remains available.

## 2026-09-21 — Auth0 browser reload investigation report

This work began with a proposed fix—replace reload-time `signinSilent()` with a top-level
`prompt=none` redirect—but the investigation established that the real browser condition had to be
reproduced before that change could be accepted. The earlier client mocks and Password-grant API
test did not exercise a provider browser cookie, hidden iframe, redirect callback, PKCE state, or
the real server's authenticated board route. They were useful narrow checks, but not release
evidence for browser-session restoration.

The Auth0 tenant could not host an additional dedicated SPA because its Free-plan application limit
had already been reached. Instead, the existing Coupling SPA received the narrowly scoped local
callback and logout URL `http://host.docker.internal:3010/` and web origin
`http://host.docker.internal:3010`; its existing test user was granted the dashboard API audience
and `read:dashboard` scope. This reuses an existing public client rather than introducing hosted
infrastructure. No browser state was written to AWS: a one-time interactive sign-in produced a
mode-0600 local Playwright storage-state file, containing the Auth0 session cookie, for diagnosis.

A branch, `auth0-browser-reload-evidence`, contains the in-progress acceptance harness and client
experiment. It builds the immutable client, serves a minimal authenticated board through the real
server, loads that local state into Docker Chromium with third-party-cookie phaseout enabled, and
requires protected board content plus successful API responses. Building it exposed several
important harness mismatches: generated boards require the normal schema modeline; the Compose
browser requires the pinned Playwright version; results must go to a writable container directory
rather than the read-only source mount; and cleanup must remove the named test container rather
than only signal its Docker client. Those corrections make execution representative; they do not
make a product claim.

After those corrections, the old hidden-iframe `signinSilent()` behavior was demonstrably red: the
seeded session did not restore the protected board under the privacy restriction. This is the first
real reproduction of the issue. The top-level `prompt=none` experiment did not make the same case
green: it rendered the restoring state but did not navigate to Auth0 during the observed test
window. Therefore no Auth0 session seed should be stored in SSM as release evidence, and no
redirect replacement should be presented as a fix. The next work must diagnose that pending
redirect, then run the same real acceptance case green. The central lesson is procedural as well as
technical: reproduce the real boundary first, and let that evidence select the fix instead of
assuming a plausible protocol explanation is sufficient.
