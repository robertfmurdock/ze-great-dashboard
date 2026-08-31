# Pull-request health status-tile log

Recorded 2026-08-31 after the responsive status-tile slice reached a meaningful completion point.

## Intention

Give a pull-request-health panel a predictable scan path when an authored cell is both narrow and
tall: identity and source at the top, aggregate status in the center, and the evidence plus
freshness at the bottom.

## Decisions and tradeoffs

The three-anchor composition is opt-in on `PanelFrame`. It supplies shared layout hooks without
changing pipeline or HTTP-value presentation, so applying the treatment to other passive panels
remains a visual decision made against a real next use case rather than a speculative framework.
Pull-request health is the first adopter because it already has a compact, aggregate signal whose
status needs to remain readable from a distance.

Narrow-and-tall panels replace the prose summary visually with workflow and open-PR facts. Their
glyphs have screen-reader labels, while the full summary remains in the accessibility tree and as a
tooltip. A failed item remains first, including its identifier and detail, before routine counts.
This keeps the compact form actionable without making status depend on color or silently clipping
meaningful text.

## Execution revealed

The existing browser layout contract was extended to exercise a one-column, full-height update
tile beside normal and wide forms. It checks the anchors in the rendered production client rather
than encoding container-query implementation details in unit tests. The repository gate passed.

## Deferred

This is deliberately not a general passive-panel layout migration. Apply the hooks to another
panel type only when its evidence has an equally clear status-centered scan path.
