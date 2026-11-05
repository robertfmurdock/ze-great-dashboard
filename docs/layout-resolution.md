# Layout reporting

Board positions are author intent, not a reason for the radiator to hide a panel. The shared layout
analyzer reports how authored positions relate to the intended desktop canvas without changing the
coordinates used by the live renderer.

The intended canvas is twelve columns by twelve rows. A panel outside that canvas is reported as
non-renderable for the intended layout, even though the current CSS Grid may display it in implicit
rows. Explicit overlaps are reported as overlaps; CSS keeps both rectangles and later content may
obscure earlier content. Panels without positions continue to use CSS Grid auto-placement.

The board reports issues with a warning icon beside Diagnostics. Clicking it lists the authored
coordinates and the complete report. The warning is a configuration fact, not an upstream signal
state. It offers two YAML downloads containing the selected board and its referenced sources:

- The legal rendered layout scales the full explicit rendered bounding box into 12×12, then makes
  the nearest deterministic integer-cell adjustments needed to eliminate overflow and overlaps.
- The authored layout preserves the coordinates currently passed to CSS Grid, including overflow
  and overlaps.

Panels that cannot receive a legal cell retain their other settings and receive the zero-size
position `{ x: 0, y: 0, w: 0, h: 0 }`. YAML comments and original formatting are not round-tripped.

At narrow widths the board deliberately switches to a readable single-column flow. Multiple named
screens and automatic live repair remain future layout work.
