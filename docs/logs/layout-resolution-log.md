# Layout resolution implementation log

Recorded 2026-08-26 after applying the layout-resolution behavior to `boards/example.yaml`.

## What was implemented

The dashboard now separates layout evidence from live rendering behavior:

- The live CSS Grid still honors authored coordinates. Overflow continues in implicit rows and
  overlaps remain visible according to normal DOM painting order.
- The shared layout analyzer reports explicit positions outside the intended 12×12 canvas and
  explicit rectangle overlaps without changing the board.
- Layout issues appear as a warning icon beside Diagnostics. Clicking it opens the complete report,
  including affected panels, coordinates, dimensions, and overlap partners.
- The warning offers an authored YAML download that preserves the source coordinates exactly.
- The warning also offers a legal rendered YAML download. It computes the bounding box of the
  explicit area currently being rendered, scales its axes independently into 12×12, and then makes
  deterministic nearest-cell adjustments to eliminate integer-rounding collisions.
- Panels are processed in YAML order. Their settings and identities are preserved; a panel is
  reduced only when necessary and receives `{ x: 0, y: 0, w: 0, h: 0 }` only when no legal cell
  remains.
- The rendered-layout route uses the legal projection so downloading and reusing it does not
  immediately recreate the original layout warning.

## Example board result

`boards/example.yaml` intentionally renders an explicit 24-row area: three panels occupy the first
12 rows and `signal-field-motion-review` occupies the next 12. The legal rendered download
compresses that visible two-band composition into 12 rows:

```text
example-build              (0, 0,  8, 3)
example-version            (8, 0,  4, 3)
active-run-treatments      (0, 3, 12, 3)
signal-field-motion-review (0, 6, 12, 6)
```

The source file is not rewritten, and the live board still renders using its original coordinates.

## Decisions and boundaries

The correction is intentionally an opt-in artifact rather than an automatic live repair. The
normalized coordinates describe a legal approximation of the current visible composition, not a
claim that the browser secretly moved panels. Panels without explicit positions remain untouched
because CSS auto-placement does not expose a stable `{ x, y, w, h }` rectangle to serialize.
