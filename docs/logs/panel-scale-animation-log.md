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

When `running_animation` is omitted, the client chooses one of the seven visible treatments at
random when the panel mounts and retains it for that panel lifetime. Explicit `radial`, `runway`,
`orbit`, and `signal-field` values remain supported. `off` still suppresses an active-run treatment.

The local `pipeline-animation-demo` rotates all seven visible treatments, in this order: radial,
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
