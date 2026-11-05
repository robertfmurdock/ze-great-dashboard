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
  const app = createApp({
    /* protected board and verifier */
  })

  expect((await app.request('/api/boards/ops')).status).toBe(401)
  expect(
    (await app.request('/api/boards/ops', { headers: { authorization: 'Bearer wrong' } })).status,
  ).toBe(401)
  expect(
    (await app.request('/api/boards/ops', { headers: { authorization: 'Bearer unlisted' } }))
      .status,
  ).toBe(403)
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

### Follow-up: GitLab CI pipeline-adapter boundary

`packages/server/test/gitlab-ci.test.ts` is the next completed slice. Its public adapter boundary
now makes its three forms of evidence explicit: safe configured-call derivation, one upstream
pipeline observation, and the configured panel route. Status normalization, unsafe source
configuration, and public error envelopes are separate named scenarios rather than parameterized
registrations, so each setup describes one input and each exercise executes the relevant parser,
adapter call, or HTTP route once.

Expected synchronous failures use a small local `throws` prototype, matching the existing OIDC
rejection boundary: an unexpected return fails the exercise phase and the caught error becomes
verification evidence. The formerly combined configured-route and unsupported-combination test was
split because those are different subjects and outcomes. The adapter keeps the important trust
contracts intact: credentials appear only in the upstream `PRIVATE-TOKEN` header, upstream 304 and
validator behavior remain observable, and all upstream failures render a non-disclosing HTTP-200
error envelope instead of proxy failure.

A follow-up readability review removed local helpers that registered whole Testmints scenarios. They
made the parameterized cases named, but still forced a reader to leave a case to see its subject
call and output. The suite now keeps every `mintTest` declaration explicit. Its remaining helpers
only arrange a controlled upstream response or name a shared public-envelope assertion, so the
input, real action, and scenario-specific expected status are visible together at each call site.

That does not prohibit a data table when the scenarios really are a uniform mapping. The GitLab
status-normalization and public-error matrices now use small, branch-free descriptor lists and
`for...of` registration: each item names its input and expected public outcome, while the loop
keeps the one visible adapter exercise and shared assertion contract together. Configuration
rejection cases remain individually written because their input shapes are less uniform. This is
the intended distinction: use a table to make a simple mapping easier to scan, not to conceal
materially different setup or behavior behind a generic test factory.

The pattern is now stable enough for independent suites to migrate in parallel. Each slice should
own its test file and any directly related migration note, use the existing Vitest adapter without
enabling reporting, and avoid introducing a shared Testmints abstraction merely to remove local
fixture code. Keep expected-rejection wrappers local while the adapter lacks first-class rejected
exercise semantics; their call sites should continue to show the actual operation. Coordinate only
when two slices would edit the same suite, shared fixture, test configuration, or production code.

### Reusable migration heuristics

The GitLab follow-up clarifies the earlier advice: “named scenarios” does not require manually
copying a Testmints declaration for every row. Use a typed, branch-free descriptor list plus
`for...of` registration when every row has the same setup shape, one subject operation, one output
contract, and a plainly named input-to-expected-output mapping. Name the fields by their role—for
example `upstreamStatus` and `expectedStatus`—rather than as generic `name` or `status` values.
Keep cases explicit when their setup shape, action, or observable contract differs materially.

Fixtures may arrange real inputs and assertion helpers may name a stable, meaningful invariant
(such as the public, non-disclosing upstream-error envelope). Neither should register a test or
hide the subject action. A reader should be able to find each scenario’s input, actual operation,
and expected evidence without following a generic local test factory.

Group Testmints scenarios by the contract boundary they exercise—such as permitted-call derivation,
observation, credential behavior, failure disclosure, and routing—rather than leaving one broad
adapter block. A typed assertion helper is appropriate when a uniform matrix otherwise repeats a
large, stable public envelope; keep the subject call at each scenario and use the helper only in
`verify`. Descriptor tables should hold fresh-input factories, not already-created mocks: construct
the mock in `setup` so each scenario owns its isolated interaction history.

This migration did not justify a production refactor. In particular, `boardConfigSchema` validates
source-specific configuration without replacing it with adapter-parsed/defaulted output; GitLab’s
default instance URL is therefore an adapter-boundary behavior. Keep that distinction visible in
tests unless repeated cross-adapter evidence establishes that normalization belongs in the shared
configuration model. Treat first-class expected-rejection support as an upstream Testmints concern,
not a dashboard abstraction. Continue migrating only where phase boundaries make a real contract
easier to understand; existing synthetic studies did not establish a blanket Testmints advantage.

### Follow-up: Azure DevOps pipeline-adapter boundary

`packages/server/test/azure-devops.test.ts` now separates permitted-call derivation, normalized
pipeline observations, renewable Entra file credentials, public upstream failures, and panel-route
security into Testmints scenarios. The status, invalid-token-file, and public-failure mappings use
branch-free descriptors. The Entra-refresh exercise intentionally reads the token file twice after
changing it, because fresh credentials on repeated adapter calls are the contract; its temporary
directory uses scoped cleanup. Configured and rejected panel routes, plus API and entrypoint
credential redaction, are distinct requests and therefore distinct scenarios. No production
behavior, reporting configuration, or dependency changed.

### Follow-up: GitHub Actions adapter and pull-request-health boundaries

`packages/server/test/github-actions.test.ts` is now fully migrated to `mintTest`. Its recorded
workflow-run normalization remains a typed, branch-free fixture-to-signal matrix; every other
scenario visibly arranges its controlled upstream response or app, executes one adapter operation
or one named route request, then verifies public evidence. The controlled clock used for the
30-day bounded lookup now uses Testmints scoped cleanup, so it is restored even if an exercise or
verification fails.

The former multi-action activity fallback, credential-redaction, pull-request-health observation,
and named-route registrations were split into independently named scenarios. Multiple upstream
requests remain within an exercise only where they are the behavior of one adapter operation (the
bounded fallback lookup and active-run jobs lookup). Shared helpers arrange only fixtures and apps;
they do not register scenarios or hide the adapter/route call. No production behavior, dependency,
or reporting configuration changed.

### Follow-up: cross-provider pipeline route contract

`packages/server/test/pipeline-adapter-contract.test.ts` now expresses its shared GitHub Actions,
GitLab CI, and Azure DevOps route evidence as Testmints scenarios. This is a genuinely uniform
matrix: each provider arranges its controlled source response, performs one named panel request,
and checks the same public contract for successful evidence, cache validation, upstream 304,
non-disclosing authorization failure, and closed-panel admission. The provider fixture remains
typed and branch-free, while each Testmints declaration leaves the request and its observable
evidence visible. Provider suites retain ownership of source-specific response shapes and behavior.
No production behavior, dependency, or reporting configuration changed.

A follow-up moved `pipelineAdapterApp` construction from `exercise` to `setup`. It creates the
controlled app and is therefore scenario arrangement; the named route request is the single
observable operation that belongs in `exercise`. This makes the public HTTP boundary easier to
identify without changing the evidence.

The follow-up also inlined fetchers that no verification observes. Only the cache-validator and
undeclared-panel scenarios retain named fetchers, because their assertions inspect upstream call
history; the remaining mocks are implementation details of the arranged app.

### Follow-up: HTTP-value adapter and panel-route boundary

`packages/server/test/http-value.test.ts` now expresses HTTP-value observation and named route
admission as Testmints scenarios. The former grouped-fact request sequence is split into its
configured API fact, configured web fact, unknown fact, and unaddressable parent-panel inputs, so
each scenario has one route request and isolated upstream-call evidence. Browser diagnostic claims
are likewise distinct valid, malformed, and invalid-asset cases; this keeps normalization and
redaction evidence local to each input rather than relying on a shared event history. Fixture
helpers arrange only the grouped panel, canonical source-agnostic app, and controlled logger. No production behavior,
dependency, or reporting configuration changed.

### Follow-up: canonical migration standard

The completed server-suite ports are now condensed into identical, brief Testmints migration
guidance in `AGENTS.md` and `CLAUDE.md`. It defines the setup/exercise/verify boundary, scenario
granularity, legitimate descriptor tables, fixture and helper limits, local expected-rejection
wrappers, and scoped cleanup, with ordinary-route and expected-rejection few-shot examples. This is
guidance for migrations, not a claim that Testmints is preferable for every future native Vitest
test; the synthetic studies remain insufficient for that claim. No production behavior, dependency,
or reporting configuration changed.

### Follow-up: entrypoint and board-layout HTTP boundary

`packages/server/test/entrypoint.test.ts` now uses `mintTest` for the rendered document, health,
client-identity, and board-layout-download contracts. Each scenario arranges its app and authored
configuration in `setup`, performs exactly one named route request in `exercise`, and checks the
response, parsed body, cache policy, or public-data boundary in `verify`. Parsing a returned HTML,
JSON, or YAML body remains part of observing that one HTTP request; it does not turn into a second
subject action.

The former unknown-board assertion issued both rendered and authored route requests. Those are now
separate scenarios because they are distinct public routes, even though they share the same
unconfigured-board fixture. The template-without-head scenario uses scoped cleanup for its console
spy, preserving restoration if an exercise or verification fails. No production behavior,
dependency, or reporting configuration changed.

### Follow-up: client update-activity projection

`packages/client/test/update-activity.test.ts` now uses `mintTest` for its two projection
scenarios. Setup owns the distinct schedule, retained-event, and retention worlds; exercise calls
`projectUpdateActivity` once; verification checks the resulting lanes, evidence disclosure, and
time window. The migration needed no fixture abstraction, production change, dependency, or
reporting configuration.

### Follow-up: client attention projection

`packages/client/test/attention.test.ts` now uses `mintTest`. The former loop of five status
inputs is a branch-free input list that registers five independently visible scenarios, so
each calls `projectAttention` once. Important failures and grouped facts, plus a missed update,
remain distinct input contracts. No production behavior, dependency, or reporting configuration
changed.

### Follow-up: client formatter and polling-schedule boundaries

`packages/client/test/pipeline-activity.test.ts` and
`packages/client/test/polling-schedule.test.ts` now use `mintTest` with one formatter or scheduler
call per scenario. The former standalone-and-missing-detail test is two contracts; the scheduler's
normal, running, and completion-window inputs are likewise independently visible. While splitting
the scheduler's formerly grouped normal-cadence case, review found that its title promised an
error-envelope input without exercising one. A real public error envelope now supplies that
evidence; this closes a test-description/evidence mismatch, not a production defect. The running
fixture now uses `PipelineStatus` rather than an unconstrained override record. No production
behavior, dependency, or reporting configuration changed.

### Follow-up: client test typechecking boundary

The client TypeScript project had included `test/**/*.tsx` but not `test/**/*.ts`, so IntelliJ
could report strict TypeScript diagnostics that `npm run check` did not enforce. The project now
includes both extensions. Making that boundary authoritative exposed and corrected four test-only
fixture gaps: a narrowed pipeline-status fixture, a schema-validated authored duration, a
standard-property assignment for React's act marker, and checked compound-panel proxy paths. The
attention Testmints setup is also contextually typed against its real projection input. Biome's
repository configuration remains the formatting and import-organization authority; IDE formatting
must use it to match the check gate. No production behavior or dependency changed.

### Follow-up: client panel-memory lifecycle

`packages/client/test/panel-memory.test.ts` now uses `mintTest` for local-history deduplication,
reload persistence and pruning, completed-run fallback estimates, precedence, and malformed stored
data. Each setup creates isolated storage, a fixed clock, and its initial memory object; each
exercise visibly performs the stateful operation and returns its observed estimates for
verification. Reload and malformed-storage construction remain in exercise because construction is
the observed behavior in those scenarios. The completed-status matrix remains a typed, branch-free
list because every status has the same arrangement, operation, and fallback contract. Sequential
records and reloads remain together only where that ordering is the lifecycle behavior being proved.
No production behavior, dependency, or reporting configuration changed.

Follow-up review split the original compound lifecycle registrations further: deduplication versus
odd-median calculation, latest persistence versus stale-history pruning, and newest-completed
selection versus successful-history precedence each have distinct input and output contracts. Their
sequential record calls remain visible inside the individual exercise that needs them; only the
unrelated checkpoints were separated.

The scenarios are grouped by successful-run duration history, completed-run fallback estimates, and
stored-memory boundaries. These `describe` blocks make the relevant contract immediately visible
without sharing setup or obscuring any exercise.

### Follow-up: client pipeline reconciliation

`packages/client/test/pipeline-reconciliation.test.ts` now uses `mintTest` for timestamp ordering,
historical GitHub disclosure, accepted-result recovery, completed-run samples, and running-duration
estimates. The previous mixed rejected/recovered presentation case is two scenarios: each arranges
its reconciliation input and exercises `applyPipelinePresentation` once. The timestamp and completed
status mappings remain branch-free scenario lists. No production behavior, dependency, or reporting
configuration changed.

### Follow-up: credential resolver boundary

`packages/server/test/credentials.test.ts` now uses `mintTest` for credential-map parsing, Secrets
Manager and SSM retrieval, fail-closed missing-key and unreadable-reference behavior, and local
environment fallback. The malformed-map inputs are a typed, branch-free matrix because they share
one parser action and one rejection contract; the two resolver failures are separate scenarios
because they exercise distinct failure boundaries. Local expected-throw and expected-rejection
wrappers leave the parser or resolver call visible in each exercise, while verification owns the
public error and redaction evidence. No production behavior, dependency, or reporting configuration
changed.

### Follow-up: browser diagnostics evidence boundary

`packages/client/test/diagnostics.test.ts` now uses `mintTest` for persisted browser evidence,
GitHub consistency-incident lifecycle, and retained-evidence summary projection. Setup arranges
isolated storage, clocks, persisted payloads, and diagnostic events; exercise visibly records,
constructs/reloads, clears, or summarizes once; verification owns the exported, retained, and
redaction evidence. Malformed persisted values remain a branch-free descriptor list because they
share the same reconstruction and reset contract. Incident persistence and explicit clearing are
separate lifecycle scenarios. No production behavior, dependency, or reporting configuration changed.

### Follow-up: immutable web application release proof

`packages/server/test/immutable-web-app.test.ts` now uses `mintTest` for the real-HTTP proof that
changing only `ASSET_PATH` selects the matching published client version. Each scenario acquires its
fixture CDN with `scope.using()` and releases it through the server's real close operation, so
cleanup still runs after a failed setup, exercise, or verification. The cross-version case retains
two deliberate document requests because comparing those two outputs is the contract: neither may
name the other's hashed assets or client directory. No production behavior, dependency, or reporting
configuration changed.

### Follow-up: client dashboard-fetch authentication boundary

`packages/client/test/dashboard-fetch.test.ts` now uses `mintTest` for explicit access-token
attachment and authorization-failure notification. Setup owns the isolated fetcher, captured request
headers, and auth callback; exercise performs one dashboard request; verification checks the
observable collaborator evidence. No production behavior, dependency, or reporting configuration
changed.

### Follow-up: scenario-owned values across Testmints phases

Review of the dashboard-fetch capability-token scenario identified a readability rule that the
migration guidance had only implied: arrange a meaningful scenario value once in `setup`, pass it to
the visible action, and compare the observable result to that same value in `verify`. Repeating a
literal on both sides obscures whether the subject preserved the arranged input or the test merely
restated its expectation. `AGENTS.md` now states the principle for tests generally and, together
with `CLAUDE.md`, for Testmints phases specifically. This is a guidance clarification; no runtime,
dependency, or reporting behavior changed.

### Follow-up: injected client-environment schema boundary

`packages/shared/test/client-env.test.ts` now uses `mintTest` for the browser-visible injected
environment contract. Auth presence, each admitted security posture, missing injection, and
incomplete configuration are separate input scenarios; each arranges its source once, invokes
`readClientEnv` once, and verifies its parsed projection or captured validation error. No runtime,
dependency, or reporting behavior changed.

### Follow-up: OIDC gate UI boundary

`packages/client/test/OidcGate.test.tsx` now uses `mintTest` for its two browser-facing OIDC
scenarios. Rendering the unauthenticated gate remains the one exercise that initiates silent
session restoration; clicking the admitted protected-content action remains the one exercise that
enters the denied view. Setup owns OIDC state, user interaction, and rendered admitted content as
appropriate, while verification owns the visible UI and collaborator evidence. No runtime,
dependency, or reporting behavior changed.

### Follow-up: PanelFrame presentation boundary

`packages/client/test/PanelFrame.test.tsx` now uses `mintTest` for its direct presentational
component contracts. Each scenario arranges its panel, envelope, or metadata input in `setup`,
renders the frame once in `exercise`, and checks the resulting layout, loading, density,
accessibility, and source-link evidence in `verify`. The former two-render density registration is
now separate default and explicit-density scenarios, matching their distinct input and output
contracts. No runtime, dependency, or reporting behavior changed.

### Compatibility repair after Testmints 0.0.3 — 2026-10-27

The automated dependency update changed `@continuous-excellence/testmints-js` from 0.0.1 to 0.0.3.
The package removed the migration-era `mintTest(title, definition)` registration helper in favor of
`test(title, mint(definition))`. This stopped both TypeScript inference and Vitest collection across
the migrated suites; it was an adapter API incompatibility, not a dashboard behavior regression.

All migrated registrations now use the package's visible Vitest form. Their scenario definitions,
phase boundaries, fixtures, and assertions were retained unchanged; no compatibility wrapper or
Testmints reporting plugin was added. Keeping native `test` registration explicit preserves Vitest
discovery and avoids introducing project-specific Testmints infrastructure for an experimental
dependency. The full unit suite again executes the migrated evidence; the Docker-backed endpoint
gate remains subject to the local Docker builder being accessible.

### Follow-up: App composition boundary

`packages/client/test/App.test.tsx` now runs its board-shell, security, polling, panel, and layout
scenarios through the Testmints Vitest adapter. Scenario setup owns the default pending request,
browser storage reset, and resource-scoped React/global/timer cleanup, so asynchronous polling
and fake-clock cases cannot leak state into another scenario. The direct shell and security-details
cases retain explicit setup, exercise, and verification phases; the existing polling scenarios keep
their tested action sequences and observable assertions unchanged. No production behavior,
dependency, or reporting configuration changed.

### Follow-up: server startup boundary

`packages/server/test/startup.test.ts` now uses the Testmints Vitest adapter for template boot
validation, panel admission, server configuration, immutable-template caching, security posture,
and startup-failure classification. Each ordinary scenario arranges its environment, fetcher,
configuration, or cache in `setup`, performs the observed startup or helper operation in
`exercise`, and verifies public configuration, errors, routes, or redacted logs in `verify`.

The cache reuse/failure-recovery and blocked-dashboard cases retain their deliberate call
sequences: concurrent/repeated reads and the complete protected route surface are the contracts
being proved. Captured rejection and throw values are verified through their `message` fields,
rather than Vitest's function-only `toThrow` matcher. The failure-classification matrix remains a
typed branch-free descriptor list. No production behavior, dependency, or reporting configuration
changed.

### Follow-up: test-count presentation boundary

`packages/client/test/TestCountPanel.test.tsx` now uses the Testmints Vitest adapter for its
reported-result and not-reported presentation contracts. The prior rerender combined two distinct
envelopes into one registration; each scenario now arranges one envelope, renders the component
once, and verifies its own public evidence. The reported case retains aggregate and outcome
evidence, while the not-reported case explicitly proves that absent results are disclosed rather
than rendered as zero. No production behavior, dependency, or reporting configuration changed.

### Follow-up: visual-component scenario boundaries

`packages/client/test/FallingShapesField.test.tsx` now uses the Testmints Vitest adapter for its
controlled-time animation and reduced-motion contracts. Setup owns geometry, motion preference,
fake time, and scoped React/mock/global cleanup; each exercise renders once and advances the clock
through its intentional checkpoints before verification checks the observed states.

Reviewing the neighboring visual suites also found two compound registrations worth splitting
without introducing a shared test abstraction. `PipelineAnimationDemoPanel` now has independent
cycle-duration and focused-review-duration scenarios. `RunningField` now separately proves default
selection, configured-off, loading, inactive, and unreadable-upstream behavior. The former combined
title claimed error and inactive behavior without exercising either, so the split closes a
description/evidence mismatch through the real `PipelinePanel` rendering interface. Ordered
animation sequences and the uniform treatment matrix remain intact because those repetitions are
the contracts under test. No production behavior, dependency, or reporting configuration changed.

### Follow-up: falling-shapes simulation boundary

The falling-shapes field no longer embeds timer progression, placement, motion phases, and React
rendering in one component. `falling-simulation.ts` now owns deterministic cadence and settlement
transitions; the field supplies measured geometry and preferences, schedules ticks, and renders the
returned view state. The former DOM-timeline test was retained through the extraction, then replaced
with Testmints scenarios at the new boundaries: direct simulation progression and the component's
geometry/reduced-motion behavior. This removes assertions about incidental DOM cell structure while
keeping the wall-facing contracts explicit. No dependency or reporting configuration changed.

### Follow-up: snowman reduced-motion presentation

`packages/client/test/SnowmanField.test.tsx` now uses the Testmints Vitest adapter for its assembling
and completed reduced-motion rendering scenarios. Each setup creates the exact field props once,
installs its reduced-motion browser capability, and registers mock/global restoration through the
scenario scope; exercise renders the field once; verification retains the clipped-canvas, dense-snow,
and non-toppled public evidence. No component behavior, dependency, or reporting configuration
changed.

### Follow-up: client-update lifecycle boundary

`packages/client/test/useClientUpdate.test.tsx` now expresses client identity checks as Testmints
scenarios. Each scenario owns fresh diagnostics, fetcher, reload evidence, and scoped clock cleanup.
The exercise remains the lifecycle sequence the hook owns: mounting for an immediate check, advancing
the controlled schedule, rerendering, unmounting a pending request, or timing out before a later
retry. Verification retains the observable request metadata, reload decision, diagnostics, and call
counts. No production behavior, dependency, or reporting configuration changed.

Reviewing that migration against the accumulated phase guidance sharpened four assertions without
adding executions: the selected next asset path now flows from setup through the public diagnostic;
the rerender scenario proves cadence from the original half-interval rather than merely a later
poll; the unmount scenario advances the clock after cleanup; and a timeout abort explicitly remains
diagnostic-silent. Cancellation and timeout are distinct lifecycle branches, so one cannot stand in
for the other's public failure classification.

A subsequent phase review split the formerly compound cadence-and-cleanup sequence. A successful
poll, shutdown after unmount, rerender cadence continuity, and timeout recovery are separate
feature contracts. Where the inflection point is later than mounting, setup now establishes the
rendered hook world and its initial state; exercise contains only the poll, unmount, rerender, or
timeout transition that owns that scenario. The cancellation evidence remains grouped with shutdown
because both are observable results of the same unmount action.

### Follow-up: client controls and board configuration

`LayoutWarning`, `Diagnostics`, and `useBoardConfig` now use the installed Testmints Vitest
adapter. Diagnostics separates collapsed presentation, opening, live count updates, download,
declined clearing, confirmed clearing, retention disclosure, and panel-failure summary. Setup
establishes an open control for later actions instead of combining several inflection points in
exercise. Layout dismissal follows the same boundary. Scoped cleanup restores React, globals,
and download spies even if a phase fails; no shared migration infrastructure was added.

The board hook still runs through its real fetch/React lifecycle. Its successful response input
also supplies the expected board and compact diagnostic summary; malformed JSON must publish an
empty board and record a parse failure without an additional network failure. Reversible negative
controls confirmed that retained dialogs after Escape, clearing despite declined confirmation,
and duplicate network classification of parse failures fail at their intended observable
assertions. All production files were restored afterward.

The unified gate exposed unrelated Markdown formatting failures across unchanged files under the
installed Biome version. Those files remain outside this migration rather than expanding a test
conversion into a documentation-formatting sweep.

A review against earlier migrations removed the Diagnostics summary assertion's paragraph-tag
coupling and made retention setup construct only its intended store. Board loading now compares
the actual fetch URL and its diagnostic path to one setup-owned expectation. A reversible fault
that requested a different board while preserving the correct diagnostic path failed at the fetch
assertion, showing that diagnostic claims alone cannot substitute for request evidence.

### Follow-up: remaining server and core contracts

The remaining server suites (development startup, Entra Compose configuration, and captured GitHub
Actions fixtures) and core consumer-release suite now use the installed Vitest adapter throughout.
Core separates example-board validation from asset-URL generation and misplaced modelines from
malformed modelines. Expected rejection stays a local wrapper; disposable board/release directories
use `scope.using()` so failed phases do not leak files. Density inputs flow from one setup-owned
panel list into the serialized input and both parsed and emitted evidence.

Development startup no longer hides its subject call inside a timer/environment helper. Setup owns
the fake clock, environment, logger, and upstream responses; exercise visibly calls `startup()` and
drives its retry clock. Deadline evidence includes the settlement time as well as the source path
and original cause, so early failure cannot masquerade as correct bounded retry. Reversible early
and late deadline faults both failed at the settlement-time assertion. Separate controls detected
lost modeline canonicalization, a writable token-directory mount, and a wrong fixture conclusion;
every fault was restored before the green run.

The inherited core determinism test ran identical YAML twice, leaving its equivalent-input claim
unproved. An initial replacement varied formatting and panel-property order, but disabling YAML
key sorting still passed because schema parsing already normalizes those properties. The final
scenario serializes the same two-board configuration with reversed board-key order and different
indentation, assembles each once, and compares emitted boards and artifact checksums. Disabling
sorting now fails the checksum comparison. This is the useful negative-control lesson: vary an
input dimension that reaches the implementation boundary being claimed, rather than one already
normalized by an earlier layer. No production behavior or dependencies changed.

### Cleanup ownership correction

Rob's review corrected the preceding slices' overuse of scoped cleanup. LayoutWarning now relies
on the existing shared React teardown; Diagnostics and useBoardConfig use ordinary Vitest hooks
for shared mock/global restoration, and development startup uses a shared hook for its clock,
console, and environment. This supersedes the earlier descriptions of those operations as
scenario-scoped cleanup. Core retains `scope.using()` for temporary release directories because
those resources belong to individual setups. The current guidance now distinguishes shared runner
teardown from one-time scenario resource disposal instead of encouraging repeated registrations.

### Follow-up: remaining shared configuration contracts

The remaining native scenarios in `board-config.test.ts` now use the installed Vitest adapter.
Security policies, authorization variants, required fields, durations, credential choices, attention,
and grouped HTTP-value shapes each expose one input and one subject action. Uniform mappings use
small named descriptor tables; schema acceptance, parsed-value preservation, credential projection,
and polling resolution retain their distinct verification contracts. Existing artifact-configuration
scenarios remain in place. These subjects are synchronous, so no async wrappers or cleanup hooks
were introduced.

Review exposed an isolation problem in the inherited Azure DevOps missing-credentials case: its
panel also lacked a pipeline definition, allowing either defect to explain rejection. The migrated
case supplies a valid numeric pipeline; disabling the missing-credential guard now makes its
observable assertion fail. The malformed schema/policy and HTTP-group variants likewise keep their
other inputs valid. The four-fact acceptance case exercises the actual upper boundary alongside
the existing five-fact rejection instead of relying on the old two-fact example to justify the
"up to four" claim.

Polling configuration preservation is exercised through schema parsing, while precedence resolution
uses an already-parsed board in setup and visibly invokes the resolver once in exercise. Descriptor
values and credential names flow from setup into verification rather than being restated as
unconnected literals. Representative reversible faults detected removed security/authorization and
credential guards, duplicate-panel admission, lost density, an enlarged HTTP fact limit, dropped
credential names, reversed polling precedence, incorrect duration conversion, and leaked schema
defaults. Every temporary source change was restored before final verification.

### Startup deadline test miss: fake time did not settle real I/O

Main Build run 42055284378 failed the migrated development-startup deadline scenario after local
checks had passed. Its `settledAfter` snapshot was undefined: advancing the retry clock had not
guaranteed completion of startup's separate board-configuration read. The test incorrectly equated
the template retry deadline with completion of the entire startup operation. The failure did not
demonstrate a production retry regression.

Before changing the synchronization, setup was adapted to supply board configuration through the
supported HTTP fetch boundary after the template deadline. That representative delayed prerequisite
reproduced the same undefined-versus-1000 assertion on the prior test. Exact slow local-filesystem
scheduling was not forced; the controlled response models the independently pending board load.
The correction awaits startup's settled result and verifies the final template-attempt timestamp,
source path, and original cause independently of board-load completion. Early and one-interval-late
retry-cutoff faults both fail the timestamp assertion, and were restored before the green run.
This supersedes the earlier claim that overall settlement time was suitable deadline evidence.

### Board-hook synchronization follow-up

The two `useBoardConfig` scenarios inherited empty `act(async () => {})` calls followed by a
snapshot of a render callback. Temporarily delaying each fetch response reproduced failures at
the board-state assertions: the event-loop pump did not establish completion. Both scenarios now
exercise the hook through `renderHook` and use bounded `waitFor` assertions against its live result
in verification. They pass with the same temporary response delay; the artificial latency was
removed afterward so the normal feedback loop adds no deliberate sleep. Reversible faults that
publish an incorrect successful board or suppress the empty failure board still fail the intended
state assertions. Shared React cleanup remains authoritative; no new fixture infrastructure or
production change was needed.

### Follow-up: client data/build and AWS operator handoffs

This slice finishes the client pull-request-health, published-schema, and CDN-graph files, plus
AWS guided bootstrap, handoff, consistency-check, CLI-format, and provider-bootstrap tests. The
inventory must include partially migrated files: PipelineAnimationDemoPanel, usePanelSignals, and
doctor still contain native scenarios even though they already import the adapter. The remaining
work also includes the animation models/presentation and AWS bootstrap, packaging, and reference
contracts; node-runner scripts and browser suites remain outside this migration.

Captured-stack acceptance, missing OIDC outputs, wrong Region, ready GitHub identity, unavailable
GitHub discovery, and incomplete versus complete work-directory handoffs now have separate visible
exercises. The CLI guide keeps its two intentional format requests together for one input manifest.
Temporary CLI, CDN-lockfile, and fake-AWS directories belong to setup and are disposed through the
scenario scope. Provider shell execution remains visible in exercise; its helper only invokes the
real shell interface and captures status/output. Bootstrap collaborators no longer assert during
execution; the normal consistency scenario verifies the recorded AWS service/operation calls.

Review found a false-positive path in the inherited inaccessible-provider-policy test. Its try/catch
accepted an unexpectedly successful invocation if stdout was empty, and the temporary fake-AWS
directory was never removed. A reversible early successful exit in the real script passes that
prior test but fails the migrated status assertion. No production defect or change was involved.
The missing-role fixture also lacked secret permission, so it now supplies valid secret permission
to isolate the role guard. Bypassing each permission guard independently fails the corresponding
exit-status assertion. An import-map fault retaining query parameters in prefix URLs likewise fails
the expected mapping assertion. All faults were restored; the unified repository gate passed.

### Grouping review after the operator-handoff slice

Applied the earlier API-auth and adapter lesson to group by the exercised contract. Handoff
planning, GitHub prerequisites, and captured-stack verification now form separate groups; desired
manifest state, deployed-stack consistency, and optional resource drift likewise have distinct
homes. Guided bootstrap separates scaffolding, guide generation, and read-only preflight; CDN tests
separate lockfile graph resolution from import-map generation. Group-specific helpers live beside
their callers. The pull-request-health groups already reflect their subjects and were retained.

The two work-directory scenarios now derive expected paths from their setup-owned input rather
than repeating that directory in assertions. Grouping does not split assertions about the same
output or combine different inputs: the intentionally paired CLI text/JSON requests still belong
to one manifest scenario. No generic test-registration helper or new behavioral contract is needed.

### Schema-test ownership correction

The client schema migration exposed a misleading subject boundary: reading a prebuilt file is
artifact inspection, not schema generation, and its title claimed determinism without exercising
it. Grouping alone did not correct that mistake. The test has now dissolved into existing owners.
The shared serializer scenario retains its two executions for determinism and now checks editor
metadata, runtime-rule disclosures, the security enum, and fact-link URI constraints through parsed
JSON. Existing default and environment-value exclusions remain. The published-package scenario
compares the delivered schema bytes with the shared serializer output instead of checking only
file existence. The build/package pipeline remains the exercised publication interface, with no
extra build or new test infrastructure.

A wrong serializer schema ID fails the shared content assertion; replacing the built schema with
empty JSON fails the exact published-byte assertion through the normal no-build package path.
Both reversible faults were restored. This supersedes treating the deleted client test as a
meaningful standalone Testmints migration.

### Remaining mixed-subject cleanup

The same ownership review found smaller mixed boundaries in this slice. Bootstrap consistency
verification was invoking the text formatter; the structured tests now own command generation and
report state, while a separate text-rendering group receives representative reports in setup and
visibly formats them in exercise. It owns migration-command display, informational package
provenance without an upgrade instruction, successful stack lines, and the administrator safety
note. Deliberately wrong command/provenance labels, failed status labels, and an omitted safety
note each fail their intended text assertion; all source faults were restored.

The bundled-CDN scenario now exercises graph resolution alone and retains membership and subpath
externalization assertions. Unrelated React import-map assertions were removed because the existing
import-map scenario already owns exact and prefix mappings. The scaffolding title now claims the
expected manifest from explicit inputs rather than unexercised determinism. The consistency test's
redundant JSON round-trip assertion was also removed; actual CLI JSON output remains covered through
the CLI interface. These are assertion-ownership corrections, with no production changes.

### Remaining Vitest scenarios: ownership before phase conversion

The remaining native Vitest scenarios are now migrated, including the partially migrated doctor,
usePanelSignals, and animation-demo files. Node-runner scripts, Playwright suites, and experiment
fixtures remain on their own runners; this is completion of the production Vitest-suite migration,
not a change to those execution interfaces. No dependencies, production behavior, reporting, or
shared Testmints infrastructure were added.

The client work separates the contracts that had accumulated in RunningField: PipelinePanel owns
selection, timing, source links, and re-entry/rerender behavior; RunningField owns inert decorative
presentation; flight geometry now has its own direct public-function scenarios. Arbitrary aircraft,
cloud, marker, and trail DOM counts were retired rather than carried into parent tests. Demo tests
exercise individual controlled-time schedules and reset behavior rather than harvesting a long
sequence of DOM snapshots. Uniform mappings use branch-free descriptors. Snowfall simulation
scenarios distinguish accumulation, rolling progression, scheduling, toppling thresholds, replay,
and pose projection; repeated advancement is retained where physical progression or deterministic
replay is the behavior. Assertions on the same result stay together. Titles no longer claim
unexercised determinism or visual color validation.

usePanelSignals now uses renderHook and reads its live result in bounded verification waits.
Callback Probe plumbing, unfinished result snapshots, empty act callbacks, and duplicated cleanup
were removed, including from its already-migrated test-total scenario. Initial in-flight and
settled schedules, missed updates and recovery, and rejected versus newly accepted evidence now
have separate subject actions. Setup may await the initial poll when arranging a later poll as
the subject; that is a condition on live schedule state, not a generic event-loop pump. Controlled
poll time and asynchronous completion are separate operations. The scheduling composition test
checks that the next due time follows settlement within a bounded window; exact cadence resolution
remains owned by polling-schedule tests.

AWS doctor and packaging scenarios now own and dispose their temporary files. Mixed admission and
acceptance cases were split, and each invalid consumer-parameter input executes the real CLI once,
checking both its error and the absence of a release directory. The reference's checked-in board
and parameter file now actually pass through the CLI, with resolved consumer values compared to
the original input. Its old test merely read the parameters and then packaged without using them.
Standalone application-template inspection dissolved into the existing produced-artifact scenario.
Bootstrap metadata, compute-mode resolution, required parameters, merge behavior, captured stacks,
and template declarations are grouped at their own public boundaries.

The consumer-bootstrap file's prose/workflow substring scans and the reference test's long source
scan were retired. They did not execute deployment ordering, approval prompts, or GitHub Actions.
Existing bootstrap/CLI/package behavior remains covered through those real interfaces. The useful
shell syntax checks now live together under administrator-scripts; reference credential forwarding
and IAM resource declarations are retained as parsed YAML contracts. Intrinsic expressions are
preserved as data rather than evaluated. These local checks do not prove AWS authorization,
CloudFormation deployment, administrator approval behavior, or workflow execution: those require
real provider/CI evidence. No local replacement is claimed for the removed symbolic assertions.

Representative reversible faults were detected at the intended evidence boundary: dropped hook
publication, omitted aborts, incorrect demo cadence and camera centering, wrong falling-field fill
and snowman duration threshold, substituted reference CLI parameters, weakened bucket declarations,
and broken administrator-script syntax. Every fault was restored before the unified gate. These
controls validate the changed test boundaries; they did not reveal or fix a production defect.
