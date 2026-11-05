# Browser-observed test direction — 2026-11-04

The test row now chooses one compact interpretation of recent counts: a reported zero, a large
single-run step, a settled shift, sustained direction, or an ordinary delta. Rob preferred symbols
and signed counts over a persistent caption because panel space is scarce; explanations are
available on hover, focus, or tap. The annotation stays neutral about whether more or fewer tests
is desirable. Zero gets a warning glyph, without changing the pipeline's own status.

The comparison concerns aggregate reported totals, not individual tests added or removed. A
large step requires both 20 tests and 20%; a plateau requires two following observations within
2% of the landing count (at least two tests of tolerance). Direction considers the latest eight
observations, while memory retains at most 32 per identity for 14 days. These conservative rules
are fixed defaults, rather than new board configuration. The sparkline includes zero in its scale
and disappears in narrow or shallow panels.

The browser's duration memory was the precedent, but test evidence needed its own public identity.
The adapter now supplies optional run ID, attempt, and source update time after binding an artifact
to its workflow run. Both standalone tests and pipeline-embedded tests use that same evidence.
Older servers without the metadata still show counts, without inferred direction. Repeated polls
replace one observation; attempts remain distinct. Comparisons use the configured board, panel,
source, workflow, branch, and artifact/entry identity. They describe this browser's observations,
not complete CI history, commits, or a durable team-wide record. There are no extra upstream calls
or dependencies. Storage failure leaves session memory usable.

History participation belongs to the existing typed feature registry, not another list of panel
types. Polling owns recording and the client-only presentation model; the shared test summary owns
symbols, interactions, and the compact public diagnostic projection. `App` only passes the model
through. Public count diagnostics exclude run metadata, preventing timestamp-only polls from
creating visible-change events. The explanation uses a portal so panel clipping does not cut it
off.

The unified repository gate passed, including the production browser with touch and reduced
motion. Browser evidence checks wall-sized and narrow layouts. The new interaction and polling
contracts exercise accessible controls and repeated real hook polling, rather than source text.

An existing standalone browser-build wrapper issue surfaced during verification: invoking
`npm run test:browser` with Auth0 credentials available can call Node with `run` as the script
instead of supplying the npm CLI path. Running the wrapper directly worked; the unified gate's
`--no-build` path also passed. This unrelated wrapper defect remains outside this feature.

## Testmints review — 2026-11-04

A follow-up review separated polling from renderer composition and split the memory sequence into
observation identity, rejection, retention, reload, and storage-failure contracts. Prerequisite
observations now belong to setup; each exercise exposes the action named by its test. Repetition
remains intentional only for repeated polling and filling a retention budget. Serialized storage
observations and collaborator assertions belong to verify, rather than being harvested midway
through exercise.

Interaction tests now mount the narrow presentation component with an explicitly supplied model,
without using the classifier to produce their inputs. Classifier descriptors declare emphasis and
the expected visible window directly. Browser evidence retains layout, touch, and reduced-motion
conditions; ordinary rendering, keyboard, and dismissal behavior stay at their narrower Vitest
interfaces. No reporting or shared Testmints infrastructure was introduced.
