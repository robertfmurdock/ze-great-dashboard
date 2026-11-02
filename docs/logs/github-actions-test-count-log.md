# GitHub Actions test-count panels

GitHub Actions exposes workflow runs and artifacts but no normalized test-total API. The dashboard
therefore reads a single configured ZIP artifact server-side and accepts only a bounded JSON
summary that identifies its workflow run, attempt, and commit. The browser receives the normalized
test-count envelope rather than GitHub's artifact transport.

The board chooses the artifact and root JSON entry so teams can retain their own reporting setup,
while the versioned manifest fixes the meaning of the public `total`. Missing reporting is visible,
not zero; an active run is pending; malformed, expired, or mismatched evidence is an error.

## Consolidation follow-up

The initial implementation revealed two sources of drift risk: pipeline-status and test-count
each selected a workflow run, and application dispatch duplicated allowlist admission. Both now
resolve through small shared server boundaries. The adapter registry remains explicit and is used
only to connect a known panel/source pair to its bounded operation; it does not make arbitrary
providers or URLs configurable from the browser.

The archive reader is isolated from GitHub API logic and uses fflate's browser-safe streaming ZIP
entry point. That preserves the size and entry guards while avoiding the Node worker import that
had required a renamed `createRequire` bundler banner in every packaging path. Test evidence stays
synthetic by deliberate choice: generated archives exercise the bounded archive and route
contracts, while no live artifact capture source has been designated.

## Dashboard workflow producer

The Build workflow now creates a separate `ci-evidence` artifact after the aggregate check. Its
single `test-summary.json` binds the GitHub run ID, attempt, and commit to totals from the Node,
Vitest, and Playwright JUnit reports. The existing `check-evidence` artifact remains the 90-day
diagnostic archive; it is intentionally not reused because the dashboard reader accepts one small,
bounded entry rather than raw reports and coordinator details.

The summary is withheld when any aggregate report is absent. A partial total would look precise
while silently omitting a suite, so an incomplete run remains visibly unreported instead. No
reporting dependency was added: the project already produces the authoritative JUnit files during
`npm run check`.

## Production polling gap and run-panel integration (2026-11-02)

The production screenshot showed a test-count panel permanently loading. The diagnostic export
identified client 0.31.53 and contained no test-count request or polling schedule. The client
polling selector admitted pipeline, HTTP value, and PR health panels but omitted test-count.
Existing adapter and component tests passed because they supplied responses directly and never
exercised that feature through the polling hook. A hook-level reproduction made zero requests on
the prior implementation; admitting test-count made it fetch and publish the real envelope shape.
This establishes the client defect, not the deployed artifact endpoint's live availability.

Rob clarified that test totals belong inside the run panel. Pipeline panels can now opt into the
same bounded artifact contract. The adapter reuses its selected run rather than independently
selecting again, preserving run/attempt/commit binding. Nested test failures remain visible without
erasing the build result. Combined observations suppress upstream cache validators, since a run's
validator cannot stand for its artifact. Standalone panels remain compatible.

## Typed feature ownership and evidence boundaries (2026-11-02)

Review of the initial integration exposed a second evidence gap: the existing pipeline diagnostic
projection considered build status and link only. Tests could arrive or fail without registering
a visible change. A reproduction against the previous projector held build status fixed and changed
only test evidence; it failed to recognize the change and omitted the error projection. The new
feature-owned projection passes those scenarios and deliberately ignores observation timestamps.
The earlier polling and rendering tests did not exercise this diagnostic boundary.

Rob objected to independent supported-type lists as anti-polymorphic. The client now registers each
feature once, under a required symbol/renderer/polling/diagnostic contract, and infers its supported
type names from that object. Local features must explicitly choose local observations. Remote
features carry their observation protocol and initial-path behavior into the lifecycle; the closed
protocol union is exhaustively handled. Diagnostic implementations live with their presentations.

The server's artifact reader now requires an already-selected run and artifact configuration; it
has no panel-selection responsibility. Both standalone and embedded presentations adapt that
run-level result. The public nested result has a dedicated schema accepting only test signals or
errors, without a repeated panel identity/link. Test outcome formatting is shared, direct component
tests own the evidence states, and the pipeline retains a single test of its composition role.
No dependency or persistence mechanism was added.

## Testmints alignment follow-up (2026-11-02)

The review correctly identified that the first polling reproduction and modified schema/selection
checks had retained native test bodies, and the embedded-route descriptor table obscured distinct
contracts. The polling regression now mounts the hook directly and returns its public result, with
scoped fetch and hook cleanup, rather than collecting callback observations. Selection, path
encoding, and schedule construction each expose their own subject execution. Schema input
scenarios are separate exercises, and embedded reported/missing/pending/rejected evidence has
explicit scenarios with setup-owned data. Shared helpers only arrange the GitHub/app world or name
a cache/selection invariant; route requests stay visible in exercise and assertions stay in verify.
The registry check now renders through the public dispatch interface rather than comparing
component identities. Compile-time status exhaustiveness no longer has a duplicated key-list test.
