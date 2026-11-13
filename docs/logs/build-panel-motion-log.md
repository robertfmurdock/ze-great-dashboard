# Build panel layout motion

The running field and the stable status band give the same evidence different positions. The shared panel frame provides an opt-in transition keyed by the pipeline status so polling and elapsed time can continue independently. React’s pre-commit snapshot captures the rendered position even when a previous animation is in flight. Measuring again after cancelling that animation gives the new layout position. Browser-native translation keeps the existing elements available for focus and interaction and fits the repository’s curated dependency constraint.

The original panel reached the running state through ordinary polling with no animation to connect the layouts. The running layout uses `display: contents` on the status slot, so the glyph itself is the shared element with a measurable box in both layouts. The browser scenario measures the glyph at the start, during an interruption, and at the destination.

The browser evidence now separates starting a build, interrupting the glide with a failed result, enabling reduced motion mid-glide, and receiving an update with reduced motion already enabled. Removing only the branch marker broke the start scenario even though the glyph still moved. Removing the preference listener left the held glide active while the separate reduced-motion polling scenario still passed.
