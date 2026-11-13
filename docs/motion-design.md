# Motion design

Motion should help viewers follow a change in the evidence. When the same visual element moves between layouts, preserve its identity and let the eye follow it to the new position. Show the latest status, labels, and links as soon as the data arrives. Keep the motion short and let a new update take over from the current visible position.

Respect the viewer’s reduced-motion preference, including changes made while the dashboard is open. Render the initial layout directly. Ordinary polls and clock ticks should avoid restarting motion.

## Build panel example

The pipeline panel passes the signal status as its `layoutMotionKey` to `PanelFrame`. The frame identifies the title and source link, and the pipeline identifies the status indicator, branch, test summary, and age. Give each element a stable `data-panel-motion` identity within its panel and keep the existing DOM node across the transition. Use a different identity for evidence with a different role, such as elapsed progress and completed duration. When only one layout contains an element, render its presence or absence immediately.

The frame measures the visible positions before the commit and the destination positions after it. A translation bridges those positions while the new layout is already in effect. Start with 200 ms and ease-out for shared layout motion. Mark individual elements and avoid marking both an ancestor and its descendant, which would compound their movement. Choose a trigger that represents a meaningful layout change and keep it stable on ordinary refreshes.

Verify the effect in a real browser. Drive the feature through a normal update, observe the shared element before and during the transition, and confirm that it settles at the new position. Exercise a second update while the first motion is still active and check reduced motion. Verify focus and readability as part of the transition. Confirm the continuity assertion detects a layout jump with motion disabled.
