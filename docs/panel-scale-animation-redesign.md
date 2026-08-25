# Panel-Scale Animation Redesign

## Purpose

This document is the implementation brief for a fresh agent. It describes the intended visual
direction for three active-run treatments without depending on the current implementation. The
current source may be discarded and rebuilt from this brief.

The treatments are:

- `telemetry-bloom`
- `release-transit`
- `status-weather`

They are decorative evidence that a pipeline is actively running. They do not add signal data or
replace any authoritative copy.

## Design intent

Each of the three treatments is a full-panel composition. The panel is the visual field; the
animation must not look like a large inline progress widget stretched until it fills the room.

The panel also contains a calm, high-contrast text island. The following remain in ordinary,
predictable document positions inside that island:

- panel label
- status glyph and status label (`↻ Running` for an active run)
- supporting pipeline text
- elapsed and expected timing
- source-updated and observed timestamps
- source link

Text geometry must not move as animation frames advance. Text may receive a subtle accent or
illumination treatment, but copy animation must never compete with the status glyph/label or timing.
The source link must remain a normal accessible link in normal flow.

The treatments are active-run-only. Passed, failed, cancelled, unknown, error, loading, and
`running_animation: off` panels use their existing presentation with no new field layer.

Status is never communicated by color alone. Keep the explicit glyph and label, and do not change
the reserved status palette without re-running the repository's contrast/CVD validation.

## Isolation rules (the most important section)

The fresh implementation must make cross-treatment regressions structurally difficult.

1. **Use a dedicated field component.** Keep the existing panel/text composition separate from the
   visual field. Prefer a shape such as:

   ```tsx
   <PanelFrame ...>
     <PanelTextIsland>...</PanelTextIsland>
     {activeField && <RunningField animation={activeField} ... />}
   </PanelFrame>
   ```

   `PanelFrame` owns panel layout and text placement. `RunningField` owns only the selected field.
   Do not make a generic `panel--animated` rule that changes every child or every animation.

2. **Scope styles by a unique root.** Each field gets a root class or data attribute, for example
   `.running-field[data-animation="telemetry-bloom"]`. All descendants, pseudo-elements,
   keyframes, responsive rules, and reduced-motion rules for a treatment must be scoped beneath
   that root. Do not use broad selectors such as `.panel--animated > *`, shared descendant names,
   or a shared pseudo-element whose background differs by treatment.

3. **Never let a field become another field's containing block.** The panel should be the explicit
   containing block for the visual layer. The text island should be a separate stacking context or
   sibling layer, not an accidental containing block for an absolutely positioned field.

4. **Keep legacy treatments out of the redesign.** Radial, runway, orbit, and signal-field are
   compatibility cases. The new field root must not be attached to them, and their old geometry
   must not be changed by selectors introduced for the three new treatments.

5. **Avoid cascade repair patches.** Do not implement a broad rule and then undo it later with
   increasingly specific overrides. If a selector needs an exception, the component structure or
   root class is wrong; fix that boundary instead.

6. **Contain layout and paint.** The field root should use explicit containment where supported
   (`contain: layout paint;` or the narrowest safe equivalent), `pointer-events: none`, and a known
   stacking order. Text and links must remain above it and interactive.

7. **Keep timing state separate from animation state.** `RunningProgress` (or its replacement)
   calculates elapsed/expected values and exposes CSS custom properties for the progress frontier.
   React's one-second clock must not remount or reset continuously travelling markers/packets.

## Recommended component contract

The implementation may use different names, but keep these responsibilities distinct:

### `PanelFrame`

- Owns panel section, display role, grid layout, loading/error state, label, and source link.
- Renders a stable text-island slot and a separate optional field slot.
- Adds an animation identity class only to the selected active field; it must not globally animate
  all panel children.

### `PipelinePanel`

- Selects an animation only when the normalized pipeline status is `running` and the configured
  animation is not `off`.
- Passes the selected animation and timing inputs down.
- Does not contain treatment-specific lifecycle or CSS logic.

### `RunningProgress` / `RunningField`

- Owns elapsed, estimate, overdue, and indeterminate calculations.
- Renders one fixed timing readout in the text island/flow.
- Renders decorative field markup inside one `aria-hidden="true"` root.
- Uses stable element identity while the run remains the same.
- Does not read browser storage, diagnostics UI, or credentials.

## Treatment specifications

### Telemetry Bloom

Visual metaphor: flowing telemetry through a layered trace field.

- Use multiple staggered trace lanes across the panel interior.
- Use multiple markers per lane or otherwise visibly distinct marker phases.
- Markers travel continuously with independent durations and delays; they must not snap to the
  one-second React tick.
- The progress value controls a restrained bloom envelope/frontier, not marker position resets.
- Keep the field low-contrast behind the text island. The text island should remain legible over
  the bloom.
- Wide/tall panels can show several lanes and layered traces.
- Medium panels reduce lane count or field density.
- Compact panels show a quiet badge/edge treatment and hide dense lanes/markers.

Suggested isolated structure:

```text
running-field[data-animation=telemetry-bloom]
└── field-visual (aria-hidden=true)
    ├── bloom-envelope
    └── trace-lanes
        └── trace-lane × N
            └── marker × M
```

### Release Transit

Visual metaphor: a route/map field carrying a release packet toward a fixed frontier.

- Use two to four route lanes spanning the available panel interior.
- Animate one bright packet continuously along its route.
- Retain a dim trail behind the packet; the trail should not disappear between frames.
- Render a fixed “now” marker and a progress frontier independently from the text island.
- The packet's CSS animation must not be restarted by the one-second React clock.
- Reduce lane count and motion density at medium sizes.
- Compact panels use a quiet route badge/edge treatment.

Suggested isolated structure:

```text
running-field[data-animation=release-transit]
└── field-visual (aria-hidden=true)
    ├── route-lanes
    │   └── route-lane × 2..4
    ├── transit-trail
    ├── now-marker
    └── packet
```

### Status Weather

Visual metaphor: slow ambient pressure/haze around a running status.

- Use a restrained low-contrast texture: haze, pressure bands, sparse drifting lines, or similar.
- Avoid dense moving objects under the text island.
- Key the treatment to the running status token while retaining the explicit `↻ Running` glyph and
  label.
- Keep motion slow and ambient; it should read as atmosphere rather than a progress meter.
- Medium and wide panels may show several subtle texture layers.
- Compact panels use a quiet edge/badge treatment with no dense texture.

Suggested isolated structure:

```text
running-field[data-animation=status-weather]
└── field-visual (aria-hidden=true)
    ├── haze-layer
    ├── pressure-bands
    └── sparse-drift-layer
```

## Layering and layout contract

Use an explicit panel stack. A safe arrangement is:

```text
panel (position: relative; isolation: isolate; overflow: hidden)
├── field layer (absolute; inset: 0; z-index: 0; pointer-events: none)
└── text island (position: relative; z-index: 1)
    └── normal document-flow content and links
```

Do not make the text island the containing block for the field. Do not put the field inside a
flex/grid sizing slot that causes it to become a large inline widget. The field's absolute bounds
must be the panel's interior bounds.

The text island may be centered or bounded for readability on wide panels, but its ordering,
typography, and dimensions must stay stable across animation frames. Compact panels may remove the
island background and use a quiet edge treatment, but must retain the same readable text order.

## Responsive behavior

- **Wide/tall:** full interior field with several traces/routes/texture layers.
- **Medium:** bounded field, fewer lanes/layers, stronger text-island contrast.
- **Compact:** quiet badge/edge treatment; hide dense lanes and moving markers; retain fixed text,
  status, and timing.

Use container queries or a clearly scoped responsive mechanism. Never change global panel sizing or
legacy treatment geometry from a new field query.

## Reduced motion

Under `prefers-reduced-motion: reduce`:

- freeze each field into a legible static composition;
- preserve the progress frontier, fixed now marker, retained trail, and status contrast;
- disable panel surface motion, copy illumination animation, marker travel, packet travel, and
  weather drift;
- keep timing text live and accessible.

Reduced-motion rules must be scoped to each field root and must not disable unrelated panel or
application animations.

## Accessibility and semantics

- Keep all decorative field markup inside `aria-hidden="true"`.
- Keep timing text in normal accessible flow; a compact visual readout may be paired with a
  screen-reader-only full description.
- Preserve the explicit status glyph and text label.
- Preserve source links, timestamps, and error/loading text.
- Do not use color as the only status signal.
- Decorative layers must not capture pointer events or obscure links.

## Tests and acceptance criteria

### Unit/component tests

Add focused tests for the new field root and verify:

- telemetry has multiple lanes and independently animated marker elements;
- transit has two to four lanes, packet, retained trail, and fixed now marker;
- weather has sparse texture layers;
- the decorative root is `aria-hidden="true"`;
- timing text remains in the fixed text stack;
- the selected field root is present only for active running panels;
- passed/failed/cancelled/unknown/error/loading and `off` panels have no new field root;
- label, status, timestamps, source link, and supporting copy remain present;
- legacy radial/runway/orbit/signal-field markup and classes remain unchanged.

### Browser tests

Cover at least:

- wide/tall field bounds equal the panel interior bounds;
- text island remains readable and in normal flow;
- compact mode hides dense lanes/markers without clipping timing or links;
- telemetry marker positions change between samples without a React remount/tick snap;
- transit packet travel and now marker are independently observable;
- reduced-motion computed styles disable field motion while preserving static geometry;
- legacy treatments do not acquire a full-panel field or global decoration;
- no horizontal/vertical overflow or layout shift is introduced.

### Repository gate

Run `npm run check` before declaring the work complete. Do not add dependencies for this redesign.
If a test needs HTTP behavior, use the repository's existing test facilities. Keep the CSS and
component boundaries small enough that a future treatment can be added without changing the other
five.

## Non-goals

- No new pipeline signal semantics.
- No change to authentication, adapters, board configuration, or credentials.
- No persistence or client storage.
- No redesign of the legacy treatment visuals.
- No global animation rule shared by unrelated panels.
