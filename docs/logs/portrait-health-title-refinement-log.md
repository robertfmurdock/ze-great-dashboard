# Portrait health-title refinement log

Recorded 2026-09-11 after correcting the narrow wall-display PR-health title and consolidating its layout evidence.

## Intention

Keep the large type and status glyphs in narrow portrait health tiles while making the authored panel
title visibly readable at the wall viewport used by the team board.

## Decision

The shared `status-band` remains the presentation boundary for both pipeline and
pull-request-health panels; no new panel abstraction was introduced. Its portrait identity band now
stacks the type glyph over a full-width title. That removes the horizontal competition that could
shrink the title to a few pixels beside the glyph while retaining the glyph-forward scan treatment.

The repeated portrait-only visual-hiding declarations in `PanelFrame` are now one grouped rule, with
the status-band identity explicitly restoring its readable presentation. Browser tests use a small
text-geometry helper for the common visibility, size, and containment observations.

## Evidence and limit

The original title assertion used a roomier viewport and only established that the DOM had a
nonzero text range. At the 1728×1728 wall viewport, the production Docker browser exposed the
title-width regression; a direct local browser run did not. The regression test now uses that
viewport and requires a visible title with useful dimensions.

Range fragments describe layout before ancestor overflow clipping, so they are unsuitable as a
universal assertion that a clipped portrait title is painted inside a panel. The narrow portrait
test therefore checks visibility and usable dimensions; the separate equal-width health-panel test
continues to check containment where that is the intended layout contract.
