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
