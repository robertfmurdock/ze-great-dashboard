# Grouped HTTP value facts

Recorded 2026-09-03 after adding a compact presentation for related static readings.

## Decision

`http-value` remains the source-agnostic panel type, but can now contain up to four explicitly
identified facts. Each fact has its own fixed HTTP(S) URL and optional scalar JSON path. The cap
protects wall-distance scanning and makes the two-column layout a real supported commitment rather
than an unbounded list.

The group is visual only. The client requests every fact through its own bounded proxy route, which
preserves each source's cache validators, observation age, link, and error envelope. A server-side
aggregate would have had to discard or invent a combined cache and freshness contract, contradicting
the dashboard's passthrough-revalidation rule.

## Boundaries

Fact IDs are stable proxy addresses; labels and ordering are presentation. Grouped facts remain
unauthenticated HTTP(S) reads in this slice. Named-source adapters and credentials are deliberately
deferred rather than smuggled into the generic HTTP mechanism.

## Follow-up refinement

The first implementation exposed repeated component-observation mechanics in the client: grouped
facts and pull-request health both need bounded fetches, 304 handling, cancellation, and public
diagnostics. Those mechanics now live in one small client helper; composition remains with the
feature that owns it. Scalar and grouped HTTP-value parser contracts likewise live in shared code,
so the adapter and allowlist consume the same shapes the board accepts. Grouped panels now emit a
compact rendered diagnostic containing only fact IDs, states, and public links.
