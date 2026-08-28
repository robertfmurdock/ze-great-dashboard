# Client-side GitHub consistency and runtime history log

Design and implementation record for the browser-side protection against stale GitHub Actions
responses and the client-collected running-duration estimate, completed 2026-08-28.

## The problem

GitHub can occasionally return an older successful snapshot after the browser has already observed
a newer run. Showing that response would turn a current failed pipeline green and change its source
link. The dashboard is a lens rather than a ledger, so this protection does not become server
state: the browser remembers only the evidence needed to prevent a viewer from moving backward.

## Why the memory is browser-local

The latest accepted source timestamp and recent successful durations are both properties of what a
viewer has observed. Keeping them in `localStorage` preserves the protection across page reloads
without introducing a database, cross-viewer coordination, or a new server-side source of truth.
If browser storage is unavailable, the in-memory behavior remains useful for the current page.

Histories are keyed by board, panel id, source, workflow, and branch. This prevents a remembered
run from one panel or branch affecting another. The board endpoint supplies the configured branch
as public metadata; credentials and source tokens remain server-only.

Successful completed-run durations are retained for 14 days based on the source run's update time,
not the time the dashboard happened to poll it. This makes the window meaningful across reloads
and polling gaps. Failed, cancelled, running, malformed, and old runs do not become timing advice.

Samples are keyed by the normalized source run id when available, with the source link as a
compatibility fallback. Repeated polling therefore cannot overweight one run. A median is used
because one unusually slow or fast run should not make the wall display misleading. A new browser
has no estimate until it has collected its own history.

## Why stale responses are rejected, not rendered as errors

Only a strictly older valid source timestamp is rejected. Equal timestamps are accepted, and a
response without a valid timestamp is accepted because ordering cannot be established. The older
response does not replace the visible signal or link, and polling continues normally.

This is deliberately different from an upstream failure. A stale successful response is evidence
of an API consistency problem, not evidence that the pipeline is healthy or that the dashboard's
proxy failed. It therefore preserves the newer visible state and records the anomaly separately.

## Why incidents are separate from ordinary diagnostics

Ordinary fetch events are intentionally bounded to 2,000 events and seven days so diagnostics cannot
grow without limit. A GitHub consistency incident is exceptional evidence that may need to be
reported after ordinary polling events have been pruned, so it lives in a separate durable record.

Each incident includes the panel identity and endpoint, both accepted and regressed run snapshots,
HTTP status, response `Date`, ETag, and cache-control metadata. That is enough to investigate or
report the anomaly without exposing credentials. Incidents are exported with diagnostics, shown as a
persistent count/warning, and cleared only by the explicit diagnostics-clear action.

Durable incident reporting is a required capability of `DiagnosticSink`, rather than an optional
escape hatch. Lifecycle code must be able to rely on evidence being retained when it detects a
consistency violation.

## Adapter and contract boundaries

The GitHub adapter continues to select GitHub's first workflow result and normalize it into the
existing envelope. It no longer calculates an estimate from the current response because that would
make history disappear on every reload and would let a stale five-run response influence timing.
The adapter requests only `per_page=1` and optionally supplies GitHub's stable run id as
`sourceRunId`. `estimatedDurationMs` remains optional in the shared shape for compatibility, but is
now a browser presentation input.

The branch and workflow identity needed for browser memory are represented in typed shared/client
helpers. The pure `pipeline-reconciliation` module owns timestamp ordering, sample extraction, and
estimate overlay; `usePanelSignals` remains responsible for polling, memory writes, diagnostics,
and rendering. This separation makes the safety rule testable without React lifecycle machinery.

Browser diagnostics and panel memory share guarded JSON storage helpers. Centralizing storage access
keeps private-browsing failures non-fatal and makes the two persistent stores use the same failure
semantics without merging their unrelated data or retention policies.

No dependency was added. The server remains stateless, credentials remain server-only, and the
normalized envelope remains compatible with adapters that do not provide a source run id.

## Deliberately deferred

Richer end-to-end stale-response rendering coverage, stronger schema validation for persisted
incident records, and generalizing source-run identity across future non-GitHub adapters remain
separate follow-up work.
