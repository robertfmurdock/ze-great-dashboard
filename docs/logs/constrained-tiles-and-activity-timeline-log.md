# Constrained tiles and activity timeline log

Recorded 2026-09-09 after replacing the portrait-text treatment and activity pop-out.

Legal authored grid footprints remain authoritative: the renderer does not resize, reflow, or hide
panels to make a constrained tile more comfortable. The previous portrait treatment made a label
technically present but visually difficult to read by rotating it vertically. Portrait cells now
use a small, audited primary-symbol contract instead: every renderable panel type has a distinct
identity symbol, and every pipeline status keeps its canonical state symbol. Long identity and
state prose, plus secondary evidence, stay in the DOM for screen readers and existing hover titles,
but become visually hidden only when the tile's measured shape is narrow and portrait.

The HTTP value panel gains a compact-only successful-read state marker so its portrait form has both
the type and state parts of that contract without changing its normal card layout. The symbol
registry has a direct uniqueness test; this makes accidental reuse of a primary glyph visible in
review rather than a styling accident.

Update activity is now an in-flow footer timeline. It continues to project the same ten-minute,
browser-local diagnostic evidence and expected poll markers, but no longer has selection state, a
detail pane, Escape handling, or a fixed overlay. Lane labels wrap deliberately, while detailed
support/export information remains in Diagnostics. Because the footer is in flow, it reserves its
own screen space instead of obscuring a panel; panel-scale animation assertions were adjusted to
the smaller honest remaining grid height.

Real-browser fixtures now cover pipeline, HTTP-value, and pull-request-health portrait tiles for
horizontal text, visible type/state symbols, containment, and retained readable text. The full gate
passed after the change.

### Deferred interaction follow-up

Portrait composition deliberately retains full identity and state wording in the accessibility tree,
but it does not yet offer that wording as a pointer hover affordance once the prose is visually
suppressed. This is a known UI-model gap, not a request to restore rotated or crowded text. Revisit
it as a coherent compact-tile interaction decision: identify a hover/focus treatment that exposes
the full identity, state, and secondary evidence without covering a neighboring panel or turning
the wall view into a pointer-dependent interface. Keep the accessible text regardless of that
future treatment.

### Internal presentation boundary follow-up

The compact-tile implementation prompted four contained refactors without changing the board
schema or rendered contract. `PanelStatus` now accepts only canonical glyph-and-label state, while
`PanelValue` owns prominent facts and loading copy. Evidence slots declare whether their content is
primary or may be suppressed in the symbol-led portrait form, rather than relying only on selector
shape. Renderers are type-checked against the type-symbol contract, so a supported panel type
cannot be added to one registry and omitted from the other. Finally, timeline marker positions and
accessible lane summaries are pure presentation helpers; polling and evidence projection remain
separate from the footer view.
