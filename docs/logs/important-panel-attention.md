# Important-panel attention states

Implemented 2026-09-11.

Important panels now opt into attention individually, while their board chooses one treatment.
This deliberately keeps the meaning of a panel’s source evidence separate from the wall-level cue:
the client projects existing envelopes, payload validation, grouped fact observations, and missed
updates into a compact rail, without adding proxy interpretation, persistence, or credentials.

The selected treatment belongs to the board rather than the panel so simultaneous failures do not
compete visually. Every rail item anchors to its unchanged panel, and the panel’s regular status
glyph, label, source link, and readable evidence remain the authority. Decorative outlines live
outside content layers; reduced-motion collapses animated beacon and alarm treatments into the
steady high-contrast perimeter.

Grouped HTTP panels preserve their independent observations in the rail: an unreadable fact names
that fact rather than claiming that every reading in the group failed. Loading and ordinary
non-failure statuses intentionally produce no cue, which avoids turning normal polling behavior
into an urgent condition. No dependency was added.
