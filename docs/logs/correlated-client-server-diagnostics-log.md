# Correlated client/server diagnostics

Browser diagnostics and server logs now carry correlated release evidence without turning browser
metadata into a trust input. The server injects a deterministic SHA-256 identifier for its canonical
asset path; clients return that opaque value, their immutable bundle version, and browser origin on
dashboard API calls. Server logs retain only a validated version, normalized origin, and whether the
asset identifier matches the configured one—not raw headers or asset paths.

The match is intentionally a mismatch signal, not authentication, routing, caching, or update
policy. A header can be forged, so it helps investigate stale CDN clients or mixed deployments but
cannot prove identity. Stored browser events remain historical: only newly emitted events receive
the additional client fields.

Testing win: the existing production-browser contract tests immediately rejected their incomplete
injected `window.env` after this public field was added. That is the intended failure mode for a
missing deployment value, and it prevented the test harness from quietly exercising a configuration
shape that a real browser would reject. The fixtures now model the complete public identity response.
