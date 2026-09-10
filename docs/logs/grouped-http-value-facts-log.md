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

## Public fact links, 2026-09-10

A grouped fact can now name an optional public `link` separately from its required read `url`.
The bounded route and allowlist continue to resolve and fetch only the read URL; the link is carried
only into the browser-facing envelope, where the existing public-link sanitizer removes query
strings and fragments. This permits a reading endpoint to point viewers at useful public context
without turning a click-through override into a new proxy destination or exposing credential-like
URL components. Facts without an override retain the sanitized read URL as their evidence link.
