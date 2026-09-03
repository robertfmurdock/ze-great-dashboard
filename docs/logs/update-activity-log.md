# Update activity timeline log

Implemented 2026-09-03.

The footer’s Update activity view is an operational, browser-local view of client-originated proxy
reads, not monitoring history. It intentionally distinguishes **observed request starts** (retained
diagnostic evidence from this browser) from the one **expected next poll** marker supplied by the
live scheduler. An expected marker is never presented as proof that a request happened.

Each visible polling panel owns its own lifecycle and its own resolved cadence. The scheduler only
arms the next timer after that panel’s request settles; no panel’s result triggers another panel.
Compound panels retain their actual proxy paths as observed markers, so their fan-out is visible
without inventing an aggregate request. Local/demo, hidden, and unsupported panels have no lane.

The snapshot carries resolved cadence settings, in-flight state, last start, and next due time only
in React memory. It is intentionally not persisted or uploaded. Diagnostics remains the evidence
and download home; its export captures the timeline’s current ten-minute window and schedule state
for support, while retention pruning is disclosed so an empty lane is not mistaken for a claim of
historical absence. No dependency was added.

### Boundary clarification

The schedule snapshot now belongs to the polling module rather than the activity-view projection.
Pure helpers select visible supported polling panels, resolve their initial schedules, and construct
their proxy paths. This keeps lifecycle code from depending on a footer feature, while the view
remains a consumer of scheduler state. Known initial paths are labeled as such: branch-dependent
pull-request build reads are shown only once diagnostics has actually observed them.
