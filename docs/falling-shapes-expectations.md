# Falling Shapes: Visual Expectations

This document describes the intended viewer experience for the `falling-shapes`
animation. It is a product and design contract, independent of any particular
rendering, state-management, or animation technique.

## Purpose

The animation should make an active run feel like a small, calm puzzle-game
scene embedded in the dashboard. It is decorative motion, but it should still
have understandable cause and effect: a piece appears, finds its destination,
travels there, and joins the field.

The public name for this treatment is **falling shapes**. It must not use the
name of any existing commercial puzzle game.

## What a viewer should see

At the beginning of a run, the field should be mostly open. New pieces should
arrive at a measured pace, leaving enough empty space for the viewer to notice
each one. The field should become denser gradually over the lifetime of the
run, reaching roughly 85% occupied cells at the estimated duration; it should
never appear filled immediately after the animation starts.

Each arriving piece should be visually distinct from the pieces already at
rest. A viewer should be able to follow the active piece through these stages:

1. It enters at the visible edge of the field.
2. It moves into alignment with an available destination.
3. It visibly falls or slides into that destination.
4. It settles and becomes part of the stationary field.

The motion between those stages should be legible at a glance. A piece should
not simply appear at its final location, and the field should not look like a
continuous block-shaped progress bar.

The pieces should be recognizable compact shapes made from a small number of
square cells, generally two to four cells. Their arrangement may vary, and
their colors may vary within the animation palette, but they should read as
intentional pieces rather than isolated dots or an amorphous fill pattern.

## Direction follows the visible panel

The animation should respond to the panel’s rendered shape:

- In a vertically oriented panel, pieces enter from above and travel
  top-to-bottom.
- In a horizontally oriented panel, pieces enter from the far right inside the
  visible field and travel right-to-left.

“Inside the visible field” is important. In the horizontal treatment, the
piece must not begin above the panel, outside its right edge, or on a path that
makes it look as though it is falling vertically. It should be immediately
clear that the piece belongs to this panel and is moving across it.

The direction should be based on the panel’s actual visible proportions, so a
panel that renders wide behaves horizontally even if its configuration values
alone appear square. A near-square panel should use one consistent direction
with no visible jitter or switching during a run.

## Destinations and collisions

Every active piece should have a plausible open destination before it begins
its final travel. Settled pieces must remain in the field as a coherent
arrangement and must not overlap one another.

A new piece may move past open space, but it must not visibly land on top of an
existing piece. Its final cells should fit within the field and should connect
to the settled arrangement in a way that feels physically understandable.

The animation does not need to reproduce a complete playable puzzle game. It
does need to preserve the visual rules that make the scene readable: pieces
have shape, space, movement, and a non-overlapping final position.

## Pacing over time

The runtime should be reflected through density, not through an instant jump
to a nearly complete field. Early in the run, the dominant impression should
be open space and occasional arrivals. Later, the field can become busier and
more filled, while individual arrivals remain observable.

The pacing should work at the scale of a dashboard panel viewed from a
distance. The active piece needs enough time in its entry and travel phases to
be perceived, but the treatment should remain atmospheric rather than
demanding sustained attention.

Until the estimated run duration is exceeded, the generator should favor pieces and destinations
that have a clear path and connect cleanly to the settled field. Once the run is overdue, it may
relax the support preference and introduce gaps while still keeping pieces inside the field and
preventing them from passing through settled pieces.

## What happens when space becomes scarce

The field is a continuously recycled visual, not a game-over screen. Once the
estimate is reached, pieces should continue arriving and placing normally. If
the field cannot accept another piece, clear one line at the discard edge—the
bottom row for vertical flow or the left column for horizontal flow. Remove
only the cells in that line, retain unaffected cells from intersecting shapes,
and shift the surviving field into the opening with a visible coordinated
animation. Prefer a complete line, using a partial edge line only as a
deadlock fallback.

This recycling should feel like an ongoing flow through the panel. It should
not clear the entire field abruptly, erase pieces while they are visibly
landing, or introduce gaps so early that the field never develops a settled
structure.

## The intended emotional read

The result should feel playful, deliberate, and a little hypnotic: a stream of
small shapes solving their way into an evolving field. It should reward a
momentary glance with a clear event—the arrival and placement of a piece—while
remaining suitable for a trust dashboard and its other status content.

## Explicit anti-goals

The treatment is not successful if it looks like any of the following:

- The whole panel fills with blocks immediately.
- A uniform bar grows across the panel with no individual piece lifecycle.
- Blocks appear already placed with no visible entry, alignment, or drop/slide.
- A horizontal piece starts above the viewport or outside the intended field.
- A piece travels through or lands on top of settled pieces.
- The layout direction contradicts the panel’s visible orientation.
- The field constantly rearranges so that nothing ever appears settled.
- The animation relies on the name or branding of an existing commercial game.

## Scope boundaries

This is a non-interactive dashboard treatment. It does not require keyboard or
pointer controls, scoring, levels, a game-over state, or a fully playable rules
engine. Its responsibility is to communicate a convincing stream of discrete
pieces entering, moving, settling, and eventually making room for more.
