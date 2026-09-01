# Pull-request health client composition

Recorded 2026-08-31 after replacing the server-side aggregate with independently cacheable
observations.

The PR panel now reads three named operations: filtered open update-PR candidates, each configured
update workflow, and one build observation for each returned candidate. GitHub URL construction,
authentication, response parsing, workflow selection, and status normalization remain in the server
adapter. In particular, the dynamic build endpoint accepts a branch only after checking it against
the configured update-workflow prefixes; it fixes the repository, build workflow, and
`pull_request` event itself. The client receives no source URL or credential capability.

This replaces the old aggregate's false cache boundary. Each component can now relay its own
validators and cache directives, and a component-level 304 reuses that component's previous valid
envelope. The client schedules candidate discovery and configured workflows together, then fans out
only to candidate build reads. An aggregate refresh is intentionally single-flight and ignored after
the board effect is cancelled.

The pure client rollup preserves the prior health precedence and wording. Its displayed observation
time is deliberately the oldest contributing evidence, with the newest component time available to
assistive technology. Partial failures retain usable evidence but add unknown evidence and an
explicit incomplete-observations disclosure; a failed known build remains failed rather than being
erased by the missing-component marker.

No dependency or board-schema change was needed. The complete repository gate passed after the
change, including the browser layout contract; its mock now serves the component route rather than
the removed aggregate endpoint.

Follow-up review tightened the boundary further: the allowlist now expresses named panel operations
instead of empty placeholder call arrays, and one parsed PR-panel capability owns workflow and
prefix checks. Component payloads are parsed with their exported schemas before the rollup accepts
them. Refreshes use abort signals and check cancellation before build fan-out, so a replaced board
does not continue issuing stale dynamic reads. GitHub's first-page candidate limit is now disclosed
as incomplete evidence rather than silently claiming an exhaustive PR set. A standalone polling
controller was considered but deferred: at one specialized caller it would chiefly replace direct
React state access with callback plumbing; extract it when another composed signal needs the same
lifecycle.
