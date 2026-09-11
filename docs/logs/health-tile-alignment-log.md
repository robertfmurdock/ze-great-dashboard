# Health-tile alignment log

Recorded 2026-09-11 after restoring readable health-tile identities.

## Intention

Bring the existing `panel.label` back into narrow portrait pipeline and pull-request-health tiles
without losing the glyph-forward wall-display treatment. Equal-height health panels should place
their state glyphs on one vertical scan line even when their labels differ.

## Decision

`PanelFrame` now offers an internal status-band composition: identity at the top, a shared centered
state-marker lane, and evidence at the lower edge. Pipeline status and pull-request-health signals
use it; the board schema, signal envelopes, and panel identifiers remain unchanged. Portrait health
tiles show a compact upright, two-line-capable identity next to the type glyph, while status prose
stays available to assistive technology behind the dominant state glyph.

The status band is deliberately not applied while a pipeline's running-field or legacy progress
animation is active. Those visualizations have their own panel-scale geometry and must retain the
free-flow readable layer that their browser contracts exercise.

HTTP-value and animation-demo portrait tiles retain their prior symbol-led identity treatment.

## Evidence

Browser coverage now measures a same-height pipeline/PR row with unequal labels, requiring visible,
contained titles and marker centers within two pixels. The portrait PR test also verifies that its
name occupies visible rendered geometry rather than merely remaining in the DOM. The repository
gate passed after the animation exception preserved the existing field contracts.

## Clarification

The status-band contract also applies to direct unreadable and invalid-signal presentations for
both health-panel renderers. A browser scenario places an unreachable pipeline beside a
pull-request-health panel, so the alignment rule is evidence for the dashboard's own failure state,
not only healthy source responses. Loading remains ordinary flow because it has no resolved state
marker to align.
