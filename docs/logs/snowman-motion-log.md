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
