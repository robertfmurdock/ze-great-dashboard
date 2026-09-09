# Panel-scale animation log

Written 2026-08-25 after implementing and visually reviewing active pipeline run treatments. This
records the decisions and observations that are not obvious from the source alone.

## What changed

`running_animation` now accepts three panel-scale fields in addition to the retained inline
treatments:

- `telemetry-bloom` — layered trace lanes, phased markers, and a progress bloom.
- `release-transit` — route lanes, a packet and retained trail, a fixed now marker, and a separate
  progress frontier.
- `status-weather` — ambient haze, pressure bands, and several independently drifting points.

**Historical seven-treatment phase (2026-08-25; superseded when falling-shapes was added).** When
`running_animation` was omitted, the client chose one of the seven visible treatments at
random when the panel mounts and retains it for that panel lifetime. Explicit `radial`, `runway`,
`orbit`, and `signal-field` values remain supported. `off` still suppresses an active-run treatment.

At that point, the local `pipeline-animation-demo` rotated all seven visible treatments, in this order: radial,
runway, orbit, signal-field, telemetry-bloom, release-transit, status-weather. Each run lasts 20
seconds and becomes overdue after its 15-second estimate.

## Structural decisions

`PanelFrame` is now an explicit stack: the panel is positioned, isolated, and clipped; an optional
`aria-hidden` `RunningField` is an absolute, non-interactive sibling below a normal-flow
`.panel__content` text island. The label, status, supporting copy, timing, timestamps, and source
link remain above the field and accessible.

New fields live under `.running-field` with treatment-specific descendants. Retained inline
treatments remain under `.running-progress`; `RunningProgress` is now typed to accept only those
legacy values. `RunningFieldTiming` owns the one shared readable timing projection for the new
fields.

Compact panels suppress dense field layers. Reduced-motion rules freeze decorative motion while
retaining static field geometry. No dependency was added.

## Visual review findings

The implementation was adjusted from real visual review, not only tests:

- Telemetry marker position changes initially snapped on the one-second timing update. Progress now
  updates at a 20ms visual cadence, while displayed elapsed time still rounds to seconds. Progress
  geometry is updated directly rather than relying on repeatedly restarted CSS transitions.
- Several decorative loops visibly teleported on restart. Bloom, transit, runway, and signal pulse
  motion use alternating passes where appropriate, avoiding a visible reset at the loop boundary.
- `status-weather` was too sparse on large panels. It now has stronger two-layer haze, three
  pressure bands, and five variably sized, reversing drifters. It remains ambient rather than a
  progress meter.
- The text-island wrapper accidentally starved legacy `signal-field` of flex height, collapsing it
  to its compact badge mode. `.panel__content:has(.running-progress--signal-field)` restores the
  retained treatment's in-flow height. Browser coverage checks its full tracks are present.

## Signal-field marker motion: still under investigation

The shared marker experiment established matching markup and nominal animation metadata, but it did
not reproduce or explain the reported browser-visible discontinuity. It must not be treated as a
root-cause fix. The example board now includes a stable, source-free `signal-field-motion-review`
panel so timing ticks and phase reversals can be observed without waiting for the rotating demo.

The first video capture isolated one concrete discontinuity: the rotating demo reached
`0:20/~0:15` and started a new synthetic run, resetting progress from 100% to 0%. That rebase moves
every progress-anchored marker and is unrelated to the smooth 3.2-second alternating phase
reversal. A fixed review treatment now uses a matching five-minute synthetic run to remove this
known confounder from visual investigation.

The next investigation must record the actual before/after frames from that focused panel, correlate
any discontinuity with React rendering, layout/container-query changes, and animation lifecycle
events, and then make the smallest change that removes the measured cause. Preserve `signal-field`,
its five tracks, and its public configuration value.

## Falling shapes and responsive field geometry (2026-08-26)

The falling-shapes treatment was added as an eighth visible active-run animation and exposed
through both `pipeline-status` and the local `pipeline-animation-demo`. It uses seeded shape
selection so panels retain stable variation while still producing different pieces and
destinations. Each piece keeps its chosen destination and becomes part of the settled collision
state when it arrives; older settled content is recycled only when a new piece genuinely cannot
be placed. This prevents a completed piece from disappearing from the state used by the next
piece.

The field now derives its logical density from the measured panel interior, preserving approximately
square cells while using the available space. Direction is selected once for the field lifetime so
near-square resize events cannot make a run switch orientation. Pieces enter at the visible edge,
move through explicit lifecycle phases, and use the estimate to reach an approximately 85% settled
fill at 100% progress. After that boundary, pieces continue placing normally; when placement
genuinely runs out, the field clears one bottom row or left column, retaining unaffected cells from
intersecting shapes and animating the survivors into the opening. Complete lines are preferred,
with a partial edge line as a deadlock fallback. Runs without an estimate retain steady fallback
pacing and the same placement-first clearing behavior. Reduced motion uses a deterministic settled
composition rather than continuing the simulation without CSS transitions.

The local animation demo accepts `demo_run_duration` and `demo_review_duration` duration values.
They default to `20s` and `5m`, respectively, preserving the prior behavior while allowing the
rotation interval and focused-review estimate to be adjusted independently. Focused review runs
for 125% of its estimate so the overtime behavior is observable. The example board
includes a dedicated `falling-shapes-review` panel with a one-minute review duration for visual
inspection.

No new dependency was added and existing animation treatments were retained. Verification passed
with `npm run check`: 231 unit tests, 8 browser tests, board validation, and published-package
smoke testing.

## Verification

Focused component coverage validates treatment selection, markup, accessibility, timing placement,
legacy exclusion from full-panel fields, and the demo rotation. Browser coverage validates field
bounds/layering, compact suppression, transit components, and legacy signal-field height/tracks.

`npm run check` passed after the final changes: lint, typecheck, 201 unit tests, 6 browser tests,
board validation, and published-package smoke testing.

## Responsive sizing pass and standalone showcase (2026-08-26)

The follow-up sizing pass covered all eight running treatments without changing their public
configuration values or legacy markup. Panel-scale fields now use a named size container for
responsive fallbacks instead of viewport media queries. Transit packet travel, telemetry marker
travel, and weather drift dimensions and distances are panel-relative. The retained runway visual
is constrained to its available panel width, and falling-shapes keeps its logical grid aligned with
its rendered interior at compact sizes.

Browser coverage now includes a narrow telemetry panel rendered on a wide viewport, protecting the
requirement that compact behavior follows the panel rather than the viewport. Existing reduced
motion, field layering, legacy-treatment, and overflow coverage remains passing.

A standalone, source-free review board was added at `boards/animation-showcase.yaml`. The
`animation-showcase` board displays all eight treatments in deliberately varied wide, medium, and
compact panels, including a second compact falling-shapes panel. It can be reviewed locally with:

```
BOARD_CONFIG_URL=boards/animation-showcase.yaml BOARD=animation-showcase npm run dev
```

The existing `boards/example.yaml`, local defaults, APIs, and dependency set remain unchanged.
Verification passed with `npm run check`: 241 unit tests, 8 browser tests, example-board and
showcase-board validation, and published-package smoke testing.

## Legacy signal-field containment (2026-08-26)

Visual review of the standalone showcase found that the retained `signal-field` treatment could
grow beyond a three-row panel while the panel's intentional `overflow: hidden` made the excess look
like missing content. Its wide-panel visual had an `8em` minimum and the flex item could also exceed
the available content height.

The legacy field now permits its flex item and visual to shrink to the panel's available height.
Three-row-or-shorter positioned panels use the inline-height visual, while tall panels retain the
expanded wide-panel treatment. The legacy markup, five tracks, compact behavior, and public
`signal-field` configuration value are unchanged.

Browser coverage now exercises the exact showcase geometry and checks that the visual stays within
the panel and that the panel has no internal scroll overflow. The focused tall-panel expansion test
remains in place. Verification passed with `npm run check`: 241 unit tests, 9 browser tests,
board validation, and published-package smoke testing.

## Overdue animation phases (2026-08-27)

All eight active-run treatments now expose the estimate-exceeded state through the shared
`data-overdue="true"` contract. The existing timing calculation remains authoritative: a run only
enters this phase when it has an estimate and elapsed time exceeds it. The run remains mounted and
the readable `Over estimate` timing text remains the semantic signal. Decorative additions remain
`aria-hidden`, and reduced motion keeps the static escalation while disabling the added animation.

The overdue treatments are themed rather than a shared flashing alarm: radial adds an alarm ring
and breathing core; runway holds at a pulsing end barrier; orbit tightens and accelerates around a
gravity-well ring; signal-field saturates its frontier and pulses its endpoint; telemetry-bloom
expands its frontier and adds a denser edge flare; release-transit stalls its packet and backs up
the trail; status-weather shifts from haze to pressure bands and storm movement; and falling-shapes
keeps its recycled/cleared overflow state denser and more persistent.

The marker motion was tuned through focused visual review. Telemetry-bloom keeps its larger overdue
rebound (`-22.5cqw`, 0.72s cycle). Signal-field’s overdue styling is restored, but its markers keep
the normal travel distance (`-10em`) and only use the faster 0.68s cycle. Runway’s moving spark is
1.5x faster overdue (1.0s instead of 1.5s) and a second, phase-offset spark appears only in that
phase. The regular treatments remain unchanged by these additions.

No dependencies or schema changes were introduced. Final verification passed with `npm run check`:
259 unit tests, 9 browser tests including responsive and reduced-motion coverage, Docker healthcheck,
board validation, and published-package smoke testing.

## Test-boundary cleanup (2026-08-29)

Decorative structure assertions were moved to the component tests that own those contracts. The
telemetry bloom and release transit structures are tested through direct `RunningField` renders;
legacy signal-field tracks and phased markers are tested through a direct `RunningProgress` render.
`PipelinePanel` coverage remains responsible for the composition contract: the decorative field is
an inert sibling of readable timing content and the source link. The demo integration test likewise
keeps its accessibility assertion without repeating the legacy track count.

Playwright no longer counts decorative lanes, packets, tracks, or markers as standalone structure
checks. It continues to test browser-only behavior: rendered geometry, layering, clipping, compact
container-query treatment, computed animation styles, reduced motion, and continuity across a CSS
animation iteration. The continuity test synchronizes on `requestAnimationFrame` and the browser's
`animationiteration` event instead of fixed sleeps.

This clarified the testing rule: test a presentational component directly when its input contract is
simple and stable; test its parent for the relationship the parent owns; reserve browser tests for
behavior whose evidence depends on a real browser. Verification passed with `npm run check`: 301
unit tests, 10 browser tests, Docker healthcheck, board validation, and published-package smoke
testing.

## Snowman running field (2026-09-09)

`snowman` is the ninth visible active-run treatment. It remains entirely inside the established
decorative `RunningField` boundary: clipped, inert, and below the readable panel evidence and
source link. Its seeded DOM particles first settle into a drift through the first half of an
estimated run. From 50% they are consumed from their drift positions into the body and head; at
95% the completed figure receives its hat. A run without an estimate stays an accumulating snow
scene and deliberately invents none of those milestones.

After an estimate is exceeded, the particle cadence doubles. Settled flakes attach to the figure,
whose increasing load first tilts it and then crosses a deterministic stability threshold that
topples it. The fallen figure remains and keeps collecting snow for the rest of that field mount.
Reduced motion renders the corresponding static phase, including the snow-covered fallen scene,
rather than running the simulation. No dependency was added. The schema, random rotation,
showcase, unit phase checks, and browser containment/compact/reduced-motion checks were updated;
the unified repository gate passed.

The initial implementation also established two deliberately small boundaries: `visualSeed` is
named for its shared panel-id purpose rather than its original falling-shapes consumer, and the
pure `snowman` model owns particle transitions while `SnowmanField` owns browser clock, media, and
DOM work. A generic particle framework was intentionally not introduced; the two current fields
have different collision and lifecycle rules, so it would make their contracts less legible.

### Physical particle-model clarification (2026-09-09)

The first snowman pass still used CSS body/head circles and treated its assembly as a directed
relocation. That was visually suggestive but did not meet the useful trust-animation constraint:
there was no conserved material to inspect. The field now has a small, deliberately non-generic
physical model. It keeps a logical ground-height field and persistent flake identities. Airborne
flakes share a deterministic seeded gust while settled flakes are unaffected. The rolling body and
head balls select only settled identities from that terrain, so the rendered figure is solely
particles formerly visible in the drift; there are no replacement body/head shapes.

Density is derived from the measured field area. With an estimate, cadence is calculated from the
material needed for drift plus both balls by the 95% hat milestone. Without one, the field remains
ordinary accumulating snowfall. Overtime halves that calculated cadence and applies the same
collision rules to new flakes. Once enough real snow has accumulated on the completed figure it
falls at `SNOWMAN_TOPPLE_LOAD` (18 attached flakes) and remains a fallen, snow-catching particle
shape. This threshold is intentionally visual rather than a claim about real snow mechanics.

Reduced motion simulates a deterministic static scene through those same transitions rather than
substituting geometry. Pure tests now cover gust determinism, terrain conservation, terrain-to-ball
identity transitions, density-aware cadence, overtime doubling/toppling, and estimate-free runs;
component and browser checks retain the clipped, compact, particle-built static presentation.

### Cellular canvas reconstruction (2026-09-09)

Review found that the earlier “physical” pass still read as sparse dots being assigned to a
precomputed snowman: its height field had no local support behavior, the gust was too small to see,
and `placeOnBall` visibly sent a flake to a bespoke position. The field was therefore rebuilt as a
dense canvas simulation. Canvas is deliberate here: the visual needs hundreds of fine grains and a
fixed-step loop, while the dashboard needs no per-flake DOM interaction or accessibility surface.

The new state is a measured 2D occupancy lattice. Every flake has a persistent seeded trajectory;
it falls under a small permanent breeze and intermittent stronger gusts, then settles only onto
support or into a deterministic diagonal pocket. Wind never changes settled cells. The body and
head are moving clusters whose collected cells retain their actual contact offset and are carried
forward as the balls roll. The head makes a continuous final climb onto the body. This retains the
intentionally magical assembly rhythm without pretending a cell teleported into a final silhouette.

Canvas replaces DOM-particle structure only inside the already inert, clipped running-field layer.
The public `SnowmanField` interface, readable panel content, reduced-motion scene, and no-estimate
fallback remain intact. Browser evidence now asserts the canvas boundary rather than inspecting
individual DOM flakes.

### Rolling and repose correction (2026-09-09)

The first cellular pass exposed a second visual-model mismatch: a ball carried its cells by simple
translation, and its swept ground cells never reconsidered their support. That made the roll read as
a sliding cluster and preserved trenches that granular snow would fill. Rolling now rotates each
collected cell about its ball core by the travelled arc. After collection, a deterministic repose
pass lets supported ground grains fall or slide diagonally into newly opened pockets, while occupied
ball and figure cells remain solid. The relaxation is intentionally one cell per simulation step:
it visibly heals a sweep without turning the whole drift into liquid sand.

### Placed-figure anchoring (2026-09-09)

The repose pass correctly changes nearby terrain, but the placed balls were still querying that
changing terrain on every tick. The resulting center-height recalculation made a completed snowman
jump after placement. A ball now locks its center at its placement milestone; its cluster can retain
new attached snow, but it is no longer re-seated by unrelated ground relaxation. A regression test
advances a completed scene while the surrounding bank continues to settle and asserts that both
placed centers remain fixed.

### Surface-only collection clarification (2026-09-09)

The roller originally accepted any ground cell inside its radius. That still permitted buried cells
to be carried away, which read as suspended snow caught by the ball. Collection is now restricted to
exposed grains on the lower contact ring, and the deterministic repose pass gets a second local
move each step to close the newly opened surface promptly. The cellular model uses smaller grains
than the earlier DOM model, so the deliberately visual toppling threshold is now 60 attached
grains; it remains a choreography threshold, not a physical material claim.

### Ball-volume correction (2026-09-09)

Surface-only collection eliminated suspended debris but made the balls read as hollow rings. A ball
now gives each captured surface grain a deterministic unoccupied interior slot. It rotates with the
ball and gradually compacts from its contact position into that slot, preserving a visible path from
drift to volume rather than introducing replacement fill geometry. Airborne flakes that intersect a
rolling or placed ball join that same compaction process. A focused simulation test exercises both
the inward compaction and an airborne flake joining the body.

### In-ball collision correction (2026-09-09)

The initial volume compaction interpolated a cell directly toward its interior slot. That made two
grains visually pass through each other. Ball compaction is now a discrete local occupancy model:
a cell takes one grid step toward its target only when the destination is free, or after it can push
the blocking chain one step in that direction within the ball boundary. Joining cells also choose an
unoccupied contact position. The regression suite asserts unique rounded occupied positions for a
rolling body, in addition to the existing compaction and falling-flake tests.

### Continuous support following (2026-09-09)

Even after placement anchoring, an actively rolling core could jump because its support height was
read directly from the discrete, relaxing terrain. The rolling center now approaches its newly
sampled support height at a bounded rate, while its horizontal progress and particle rotation remain
continuous. A placed ball still locks entirely at its milestone, and a locked body no longer collects
ground while the head is assembled. The model test verifies the core cannot change its vertical
position by more than one small interpolation step in a simulation tick.

### Toppling arc correction (2026-09-09)

Toppling previously reassigned the balls to fallen coordinates in one simulation step. The completed
figure now records a lower-body pivot and advances through a 750ms eased quarter-turn. Resolved body,
head, accumulated cells, and hat all use that same transform, so the particle-built figure rolls
continuously onto its side before entering its persistent fallen state. The model test observes both
an intermediate angle and the final right-angle resting pose.
