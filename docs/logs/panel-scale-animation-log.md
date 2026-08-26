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

## Verification

Focused component coverage validates treatment selection, markup, accessibility, timing placement,
legacy exclusion from full-panel fields, and the demo rotation. Browser coverage validates field
bounds/layering, compact suppression, transit components, and legacy signal-field height/tracks.

`npm run check` passed after the final changes: lint, typecheck, 201 unit tests, 6 browser tests,
board validation, and published-package smoke testing.
