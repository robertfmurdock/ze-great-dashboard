# Opportunistic source-history repair — 2026-11-05

The browser's test trend now starts from source readings when possible, rather than depending on
how long a particular viewer has watched the board. Rob framed this as a slow, self-healing lens:
current status and test counts render first, while context catches up opportunistically. The
server still has no persistent history. Browser storage is a disposable cache, not a second
record of truth.

History support is an adapter capability, advertised on eligible current responses. A new bounded
operation inspects one page of at most eight completed runs within 14 days, using the configured
workflow and source branch. The existing artifact reader supplies run/attempt/commit binding,
archive limits, and summary validation. Missing and expired artifacts leave fewer samples rather
than fabricated zeros. Authentication and rate-limit failures stop additional artifact work;
other failures leave a partial inspection. This costs at most one run-list request plus two
artifact reads per inspected run, excluding existing credential acquisition/replay behavior.

**Security review boundary:** the quarantined allowlist now grants `test-history` only when the
configured adapter declares it. The browser cannot supply a destination, workflow, branch, run ID,
or depth. Admission and dispatch share the adapter capability. Existing API authentication wraps
the route. Historical aggregates forward no individual upstream validators, and request
cancellation propagates to source fetches.

The client has no recurring history timer. Settled current polls consider missing/expired context,
daily refresh, and hour-long gaps measured from successful current polling rather than old build
timestamps. Dispatch waits for current requests to settle, a visible document, and healthy current
polling; one repair runs per board coordinator. Normal requests continue while repair is pending.
Attempts are throttled across reloads; incomplete work backs off one hour, six hours, then a day,
respecting longer source retry guidance. A completed inspection with no usable artifacts is still
valid for the daily cadence. Capability withdrawal discards queued repair work.

Historical merging has a separate path from rejecting older live responses. It deduplicates run
attempts, preserves newer evidence, sorts before retention, and keeps the existing 32-reading /
14-day bounds. Interpretation remains anchored to the displayed run, even if repair finds a newer
run before normal polling does. Repair failures affect diagnostics and explanation, not build
status, ordinary update health, or attention. Explanations now describe retained source readings
and disclose incomplete inspections.

Tests exercise the real authenticated route with artifact archives, the memory and scheduling
boundaries under controlled time, and both polling lifecycles while history is pending. These
remain separate Testmints contracts; presentation and browser tests retain their narrower roles.
The repository gate passed during implementation; the final pass also includes capability
withdrawal coverage and the architectural clarification in current contributor guidance.

## Test miss: polling after a repair finds a newer run — 2026-11-05

The existing repair anchoring test projected the displayed run immediately after historical merge,
but did not execute the next ordinary observation. A newer repaired run made the live-only age
guard reject that otherwise unchanged displayed run, clearing its annotation. The new
`polling the displayed run after repair retains its anchored direction` scenario reproduces this
through `BrowserPanelMemory.observeTests` and ran red before the correction. The correction will
share reading ingestion rules while keeping projection anchored independently to current evidence.

The polling-after-repair reproduction is green with a single reading merge for both ingestion
paths. Identity, timestamp precedence, ordering, and retention now have one implementation;
projection separately anchors to the displayed reading. Equal source timestamps prefer the latest
inspection so corrected totals are accepted consistently. Earlier valid readings are retained as
cache context, rather than rejected merely because the cache knows a newer run. Pipeline response
reconciliation continues to reject stale displayed build responses before ingestion.

## Refactor of history, publication, and artifact boundaries — 2026-11-05

Repair transitions and eligibility are now pure functions with named cadence/retention constants.
Their focused tests no longer construct browser storage; memory tests retain persistence, merge,
and display-anchor contracts. The storage representation remains compatible with existing browser
memory.

Current observations and historical repair now use the same publication path for projection,
change detection, diagnostics, and React state. A local polling lifecycle wraps single reads,
grouped facts, and pull-request aggregation with common start, cancellation, rescheduling, and
finally-owned settlement. This removes protocol-by-protocol repair bookkeeping without adding a
general scheduler framework.

Artifact inspection moved behind explicit reported, pending, absent, expired, and failed outcomes.
It returns safe upstream status and retry guidance instead of calling back into the caller's
control flow or accepting a history-mode flag. Current display and historical inspection interpret
those outcomes explicitly: an expired current artifact remains unavailable; expired historical
artifacts simply contribute no sample. Both callers retain the same archive and manifest
validation. Retry-After parsing is shared across browser and server, with pure protocol tests.

## Test sensitivity and migration follow-up — 2026-11-05

Rob challenged whether passing tests would actually fail for their named broken behavior. Two
existing cases had weak causal evidence: the one-hour throttle case used a completed cache whose
separate daily-refresh condition already blocked repair, and disposal asserted callback silence
without delivering the pending result. The new throttle cases use otherwise-eligible unseeded
history immediately before and at the boundary. Disposal now delivers a late response and advances
controlled time before checking that no memory merge, callback, diagnostic, or extra request occurs.

The repeated-poll scenarios now start from a mounted, settled hook, then exercise only repeated
polling. Source ordering, stale replacement, deduplication, and anchored/partial projection are
checked directly at the extracted pure model. Browser-memory evidence retains the original
polling-after-repair regression and public reload/repair-metadata contracts instead of inspecting
serialized history to establish domain policy.

A targeted negative-control pass temporarily broke eight behaviors: throttle enforcement,
chronological ordering, stale-evidence protection, run-attempt identity, current-run anchoring,
late-result suppression, normal polling continuation, and unchanged-publication suppression. Every
variant failed at the intended behavioral assertions rather than setup or compilation. Production
files were restored byte-for-byte. This demonstrates sensitivity for these contracts; it is not a
claim that the entire test suite has undergone mutation testing. No mutation tooling or dependency
was added to the repository or its fast gate.

The first aggregate verification attempt hit the check runner's own two-second subprocess-start
fixture timeout; feature tests and the other aggregate stages passed. The check-runner suite then
passed unchanged in isolation. Its timeout and assertions were left intact; final aggregate
verification is rerun rather than treating the isolated pass as a substitute for the gate.
