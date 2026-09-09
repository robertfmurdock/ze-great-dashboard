# Snowman weight and timing — 2026-09-09

The snowman now uses a duration-derived schedule, replayed against absolute run time. Applying the
latest progress to every historical tick had made late mounting assemble the figure before its snow
arrived. Fixed 25 ms ticks now give identical material and poses regardless of caller frame interval;
canvas presentation interpolates browser frames without React state updates per frame.

Rolling grains retain their coordinates in the ball's material frame. Only incoming grains settle,
and a blocked grain stops rather than pushing the packed interior around. Rotation follows travel
and radius, terrain following remains gradual, and placed balls retain their anchors. The head hops
along an arc and settles; the hat drops during landing and rotates about the figure's pivot when it
falls. Head collection is limited relative to the body: browser review exposed that unrestricted
collection could produce a larger head than body. Excess material remains in the scene.

Gestures end at the 75% and 95% milestones. Long runs spend their spare time accumulating snow before
the bounded rolls. Full head choreography fits from 5.15 seconds; below that the head omits its
separate roll. Below 2.8 seconds the body cannot meet its 700 ms minimum, so the run retains snowfall.
The merged-arrival fallback is represented by the head-window calculation, but the body minimum
currently makes that branch unreachable for a whole run. This is intentional: the body constraint
wins rather than quietly speeding its roll below the minimum.

Browser review used 180×90 and 720×360 fields, including the shortest assembly duration and a
five-minute run. It exposed a second issue: a short run on a tall field could finish before snow
reached the ground. Fall speed now accounts for height and short estimates so assembly has actual
material; the added short-run test executes that scenario. Reduced-motion snapshots replay the same
schedule at actual progress, instead of substituting a generic ten-second pose or inventing overdue
load. With the existing clamped progress prop, a newly mounted overdue snapshot cannot know how long
it has been overdue. Live accumulation continues with the local clock. Actual status still owns the
field's lifetime; decoration introduces no completion delay.

No dependencies, public props, configuration, status colors, or other animation treatments changed.

## Follow-up refactor boundary — 2026-09-09

Two structural seams were kept because they make the current behavior easier to reason about
without changing the feature contract. Duration policy now lives in `snowman-timing.ts`, and canvas
painting lives in `snowman-canvas.ts`; `snowman.ts` owns simulation and `SnowmanField.tsx` owns the
browser lifecycle and composition.

The following remain future work rather than speculative abstractions: a generic animation
framework shared by the other treatments, a panel or animation registry, further decomposition of
the physics engine into separate material and choreography modules, and broader browser timing
fixtures. Those changes should wait for a second consumer or a concrete maintenance problem. The
project's preference for small feature-local modules and curated dependencies is the reason to stop
at these two seams for now.

## Snowball compaction follow-up — 2026-09-09

The rolling snowballs still read as hollow because each grain received a one-time interior target,
and packed grains then acted as permanent obstacles. Later grains could therefore remain on the
outside instead of compressing the material already collected. The fix reassigns all ball targets
after each collection to a dense, deterministic hex-like lattice and lets grains move toward those
targets together, so additional snow visibly pushes the existing material inward.

The lattice uses whole-cell-scale spacing rather than sub-cell spacing: the canvas renders grains on
a cellular grid, and finer packing created duplicate rendered coordinates even though local physics
positions differed. Radius growth was also reduced to keep denser material from creating a positive
feedback loop where a larger capture radius absorbed the attached snow needed to trigger the overdue
topple. Existing geometry and overdue-load tests caught both regressions; the full repository gate
passed after the final adjustment.

## Snowman support follow-up — 2026-09-09

The completed body could retain a small visual gap because its final terrain position was selected
before the last contact grains were collected and the post-collection radius was applied. The body
now takes one final support sample when it locks, using its finished radius; this preserves the
intentional rigid anchor afterward while placing the base against the remaining snow. The completion
test now protects that real geometry relationship rather than asserting only that the ball is locked.

The first placement of that reseat was still too early in the fixed step: it lived inside ground
collection, before the settled bank's two relaxation passes. Since locked balls are intentionally
excluded from collection, that branch was also unreachable for the completed body. The reseat now
runs after collection, compaction, and terrain relaxation, so the final support sample is taken from
the same terrain state that is rendered for the frame.

The rendered body could still look detached even though its circular support geometry touched the
terrain: the packed lattice stopped short of the ball boundary, and rotation left its lowest grain
about half a grid cell above the support row. The lattice boundary now extends to within one tenth
of the radius, and the completion test checks the resolved body grains against the resolved ground
surface so the visible contact remains covered.

## Locked support stability follow-up — 2026-09-09

The final support correction introduced a feedback loop after the body locked. Each simulation step
reseated the body from the current terrain surface, while terrain relaxation treated the body as an
obstacle and filled the newly exposed space beneath it. The body consequently hopped upward when the
space opened and downward when it refilled, even though a locked figure is intended to be anchored.

The body now captures its support height once, at the first post-lock support sample, and retains
that anchor while nearby snow continues to relax. The completion regression advances through the
observed terrain change rather than checking only one later frame, protecting both the no-hop behavior
and the existing resolved-grain contact relationship.
