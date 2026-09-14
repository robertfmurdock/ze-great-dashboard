# Compact scan-grid layout

Recorded 2026-09-14.

The former `64rem` responsive transition sent every board directly from the authored 12-column
wallboard to a single content-sized column. That avoided clipping, but on laptop and tablet
landscape displays it turned short authored cells into tall cards with substantial unused space.

The responsive layout now has three intentional modes: the authored grid above `64rem`, a
configuration-order two-column scan grid from `48rem` through `64rem`, and the existing
content-growing one-column layout below `48rem`. The compact mode uses automatic rows with a short
minimum height, so it relaxes only advisory authored coordinates; panel schemas, DOM order, source
actions, and accessible status text remain unchanged.

Status-band panels no longer vertically center their state in the compact mode. Their identity and
source action remain at the top, followed by the glyph-and-label state and then compact evidence.
This preserves branch, age, and update-summary information without recreating the empty central
band. The security notice shares the compact header as its own visible row, preserving its separate
deployment-posture meaning rather than making it resemble a panel health state.

Browser coverage now exercises eight populated panels at an intermediate width, including a running
telemetry card, and verifies two columns, four rows, configuration order, readable content, source
actions, no horizontal overflow, and the separate security notice. The unified repository gate
passed. No dependencies or public configuration were added.

Clarification, 2026-09-14: the initial implementation expressed the same behavior with duplicated
responsive-shell rules and an exclusive `48.001rem` boundary. The finished form instead names the
three modes directly: wallboard above `64rem`, compact scan grid from `48rem` through `64rem`, and
narrow reading layout below `48rem`. Shared below-wallboard behavior is declared once.

The compact status-band CSS now uses named grid areas for `identity`, `status`, and `evidence`.
That makes the anti-overlap intent inspectable in the production rule itself. Its browser scenario
likewise groups assertions by observable contract: scan-grid order and dimensions, evidence fit,
top-to-bottom completed-status reading order, decorative-only running fields, and the separate
security-notice header row. These remain real rendered-browser checks rather than source or
selector assertions.
