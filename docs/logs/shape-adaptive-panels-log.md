# Shape-adaptive panel composition log

Recorded 2026-09-03 after the portrait-panel composition slice reached a meaningful completion point.

The live board exposed a gap between the stated density contract and its actual presentation: a
one-column portrait pipeline panel retained every line of prose until it clipped. The browser test
only proved containment, so it did not protect whether the resulting card could be scanned.

Panels now choose their composition from their rendered shape without a new board field. Narrow
portrait cells use a vertical identity rail; wide shallow cells retain scan rows; regular cards
stack their evidence; and narrow short cells use compact evidence. `density` remains a content
budget preference, not an opt-in required to avoid broken composition.

The compact form preserves the dashboard's central accessibility rule: statuses visibly retain both
a glyph and readable label. Secondary evidence may become a glyph and a short value; its full text
remains in the accessibility tree and its existing title. Pull-request health keeps its distinct
three-anchor scan path, with the vertical rail alongside rather than replacing its centered status.

Browser coverage now exercises portrait pipeline, grouped HTTP-value, pull-request-health, and
animation-demo panels. The original pull-request test caught the first rail implementation moving
the centered status upward; its revised geometry assertion protects the intended rail-plus-centered
status relationship. The repository gate passed.

### Follow-up: explicit composition slots

The first implementation let shared frame CSS recognize panel-local child classes. That was an
unacceptable boundary: layout ownership should not depend on a renderer's implementation class
names, and CSS Modules make that coupling especially brittle. `PanelEvidence` is now the stable
ordinary-evidence slot, while the existing named status/evidence anchors retain their role for the
pull-request tile. The frame owns shape geometry; each renderer explicitly declares what occupies
it.

Compact metadata is likewise an explicit presentation choice: a renderer selects either a short
visual value or glyph-only evidence. This replaces the ambiguous empty-value convention while
keeping the full value accessible. No board schema, server contract, or dependency changed.
