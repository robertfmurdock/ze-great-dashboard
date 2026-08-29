# Pull-request health compact presentation log

Recorded 2026-08-29 after the narrow-panel presentation slice reached a verified completion point.

## Intention

Make a compact pull-request-health panel useful at wall distance when its authored grid cell is
only one column wide. The aggregate status remains the primary signal, with workflow and open-PR
counts as the smallest useful secondary facts.

## Decisions and tradeoffs

The client now derives compact facts from the validated `workflows` and `pullRequests` arrays. It
does not parse the server's prose summary. Healthy panels show singular/plural counts, while a
failed item takes the first line so a viewer sees an actionable label such as `PR #42 failed`.
The item's detail and the full aggregate summary remain available through titles, and the full
summary remains the wider presentation.

The treatment is an internal presentation branch selected by the existing panel container query:
only `density: compact` panels at narrow widths use stacked facts. No new board setting, signal
field, adapter contract, or dependency was added. Very short narrow pull-request-health cells
hide the freshness row so check age cannot crowd out status and counts; other panel types retain
their existing metadata behavior.

## Execution revealed

The browser density contract caught an initially broad metadata selector that changed all compact
panels. Scoping it to the pull-request-health compact-facts sibling restored the existing behavior.
The complete repository gate then passed, including unit tests, Chromium browser tests, Docker
health validation, board validation, and published-package smoke testing.

## Deferred

The supplied earlier board revision still assigns the update-health panel one column. Whether that
signal deserves two columns remains a board-author layout decision and was intentionally not
changed by this presentation work.

## Follow-up refactors

The repeated status glyph mapping is now shared by pipeline and pull-request-health panels, with a
small label override for `Healthy`. Count formatting is also centralized so compact projections do
not each implement singular/plural branching.

One browser contract test covers the actual container-query behavior for narrow and wide compact
pull-request-health panels. It reuses the existing Playwright route fixture shape and adds no
meaningful setup burden or dependency.
