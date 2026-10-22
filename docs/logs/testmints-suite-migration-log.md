# Testmints migration notes — 2026-10-22

The migration began with `packages/server/test/api-auth.test.ts`, rather than a suite-wide rewrite.
It now uses `mintTest` while retaining Vitest expectations and mocks. Node-runner scripts and
Playwright suites remain outside this work. The already-pinned experimental
`@continuous-excellence/testmints-js@0.0.1` is used only through its Vitest adapter; reporting is
deliberately disabled, so this change creates neither `.testmints` artifacts nor a CI publishing
contract.

The first useful rule is stricter than replacing a test registration function: phases must expose
the scenario's real data flow. In the authentication tests, `setup` creates the configured app,
fetcher, and verifier; `exercise` makes every intentionally distinct request exactly once and
returns named responses or parsed public evidence; `verify` contains all assertions. In
particular, a verifier records policy (valid or denied tokens) and a fetcher records calls; neither
asserts while the action is in progress.

An attempted mechanical conversion was discarded. It could preserve runner behavior, but placed
assertions in `exercise` and could not safely distinguish fixtures, subject calls, regular
expressions, or parameterized registrations. That is not a Testmints migration: it hides the same
old test inside a new callback shape. Future files should be migrated by scenario shape and reviewed
for the boundary, not transformed wholesale.

The initial refactor also made the phase callbacks longer. The preferred correction was not to move
behavior into opaque helpers, but to extract stable, named fixtures: shared board configurations,
authenticated-app construction, and a declarative access-token-verifier factory. This keeps the
setup readable while the behavior under test remains plainly visible in `exercise` and every claim
stays in `verify`. It is a useful standard for the remaining migration: extract reusable scenario
arrangement, not subject execution or assertions.

The focused API-auth suite and server typecheck pass. The full migration remains deliberately
unfinished; parameterized, DOM, fake-time, and shared static-server cases still need the same
scenario-by-scenario treatment before the suite-level completion claim or the existing final
verification plan is appropriate.

### Follow-up: scenario granularity

Reviewing the first conversion showed that its three registrations still bundled several input and
route scenarios. The suite was split into nine named Testmints scenarios: missing, invalid, and
unauthorized tokens; document, health, and authorized-board routes; blocked panel access; policy
metadata; and authored-configuration redaction. Each now has one request in `exercise` and the
assertions for that request in `verify`. Shared app, board, and verifier arrangement remains in
fixtures, so the split increases the precision of release evidence without turning each test into a
wall of repeated infrastructure.

The installed Testmints version has no template or fixture API. Ordinary typed TypeScript fixture
factories are sufficient here: `protectedValueFixture`, `publicBootstrapFixture`, and
`claimPolicyFixture` each name the world a scenario needs, while the test itself still exposes its
one request and its assertions. This is the current balance: reuse arrangement only when its name
improves immediate readability; do not hide exercise or verification behind a generic template.

Nested Vitest `describe` blocks complement those fixtures: the API-auth scenarios are grouped by
token admission, bootstrap and board routes, and claim-policy exposure. The groups communicate the
shared contract without combining inputs or requests into one test case.

Fixtures and board definitions used by only one group live inside that group's `describe` block.
Only the base auth identity and the low-level app/verifier construction remain file-scoped. This
keeps the file's visible scope honest: a reader can see which arrangement belongs to which contract
without scanning unrelated scenarios.

`setup` is the scenario's arrange phase, not merely a reference to a shared fixture object. A test
may compose a reusable low-level fixture with its own structured inputs (for example, request
headers), then let `exercise` perform the one action using those already-arranged values. Keep
simple, one-off literals at the action when that reads best, but construct nontrivial inputs in
setup. Fixture helpers are ingredients for that arrangement, never a constraint that prevents a
scenario from adding or reshaping its own state.

The remaining API-auth request scenarios now follow this discipline: each setup composes its shared
fixture with the authorization header appropriate to that scenario, and each exercise consumes the
prepared header for its single request. The no-header public and missing-token cases retain the
direct fixture setup because there is no additional structured input to arrange.

### API-auth before/after reference

The original API-auth test grouped three distinct token inputs and three requests into a single
Vitest callback. The setup, actions, and assertions were interleaved:

```ts
it('rejects missing, invalid, and unauthorized access before any adapter fetch', async () => {
  const fetcher = vi.fn<typeof fetch>()
  const app = createApp({ /* protected board and verifier */ })

  expect((await app.request('/api/boards/ops')).status).toBe(401)
  expect((await app.request('/api/boards/ops', { headers: { authorization: 'Bearer wrong' } })).status)
    .toBe(401)
  expect((await app.request('/api/boards/ops', { headers: { authorization: 'Bearer unlisted' } })).status)
    .toBe(403)
  expect(fetcher).not.toHaveBeenCalled()
})
```

The migrated form gives the invalid-token input its own named scenario. Setup composes the local
request capability from a reusable arrangement; exercise performs one request; verify owns only
that request's evidence:

```ts
mintTest('rejects an invalid access token before any adapter fetch', {
  setup: () => ({
    ...protectedValueFixture(),
    headers: { authorization: 'Bearer wrong' },
  }),
  exercise: ({ app, headers }) => app.request('/api/boards/ops', { headers }),
  verify: (response, { fetcher }) => {
    expect(response.status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  },
})
```

Use this as a migration reference, not a mandate to introduce fixture factories everywhere. The
important properties are a single input scenario, a visible arrange phase for meaningful structure,
one intentional subject action in exercise, and all observable claims in verify.

Reference implementation: commit `3dde983` (`test: migrate API auth scenarios to Testmints`).

### Follow-up: OIDC verifier boundary

`packages/server/test/oidc-auth.test.ts` is the next completed slice. It is the security boundary
immediately beneath API authentication and uses the real discovery, JWKS, signature, issuer,
audience, expiry, subject, and authorization-policy paths without introducing the remaining
parameterized, DOM, fake-time, or shared static-server migration concerns.

The former grouped invalid-token case is now five named scenarios, and the role/group policy case
is now four. Each arranges its signing keys, discovery response, verifier, and one token in
`setup`; `exercise` invokes the verifier once; `verify` owns every observable claim. For expected
rejections, a local `rejects` prototype declares that shape at the call site. It fails the exercise
if the verifier resolves, and otherwise passes the original error to `verify`. This keeps the
expected-rejection contract visible without assertions during promise handling. The current
Testmints adapter still reports this as an ordinary successful exercise after the wrapper captures
the rejection; promoting the idea upstream would need first-class reporter semantics as well.

The shared fixture owns only real OIDC arrangement: a signing key pair, public JWKS response,
discovery metadata, and recorded network calls. It does not hide token verification or expected
outcomes. The successful signed-token scenario retains the discovery/JWKS request evidence.

The initial OIDC fixture made each setup spread an arranged verifier and manually sign a token.
That was correct but needlessly repetitive. `verifierTokenFixture` now expresses the normal test
world declaratively: the verifier policy is its required argument and a compact options object
names only the token difference (issuer, audience, expiry, subject, claims, or discovery issuer).
The missing-subject and untrusted-key variants remain explicit named arrangements. This removes
fixture plumbing from scenarios without hiding the subject action: successful exercises call
`verifier(token)` directly, while the rejection cases pass that same visible operation to the local
prototype.

### Follow-up: GitHub App authentication boundary

`packages/server/test/github-auth.test.ts` is the next completed slice. It retains the real RSA
JWT signature check and the GitHub Actions adapter/client boundary while making their data flow
explicit: setup arranges credentials, a deterministic clock, and recorded upstream responses;
exercise creates a JWT, makes a client request, or invokes the adapter; verify inspects claims,
requests, and responses.

The installation-token reuse scenario intentionally executes the adapter twice. Repeated execution
is the contract being proved: one exchange supplies two distinct GitHub Actions calls while the
clock advances within the still-valid token window. By contrast, the 401 behavior remains one
client `get` operation in exercise; the token refresh and replay are observable behavior of that
single operation. The missing-credential case uses the same local expected-rejection prototype as
OIDC so the generic, non-disclosing error becomes verification evidence rather than an assertion
inside the action.

### Continuation guidance after the first three suites

A review across API authentication, OIDC verification, and GitHub App authentication found no
production change required by the migrations. The current implementation boundaries remain
appropriate: API auth maps access denial separately from invalid tokens, OIDC verifies against
discovery and JWKS, and GitHub App credentials and installation-token reuse stay server-only.
Potential compatibility or hardening refinements—case-insensitive Bearer-scheme handling, a typed
access-denied error, and rejecting implausibly near-expiry installation tokens—are independent
future work, not prerequisites for more conversions.

The pattern is now stable enough for independent suites to migrate in parallel. Each slice should
own its test file and any directly related migration note, use the existing Vitest adapter without
enabling reporting, and avoid introducing a shared Testmints abstraction merely to remove local
fixture code. Keep expected-rejection wrappers local while the adapter lacks first-class rejected
exercise semantics; their call sites should continue to show the actual operation. Coordinate only
when two slices would edit the same suite, shared fixture, test configuration, or production code.
