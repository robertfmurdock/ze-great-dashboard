# Testmints review

## 2026-11-11

We reviewed the repository's existing Testmints scenarios for isolated failure evidence rather
than performing a mechanical phase-format migration. The shared security-details schema tests
had one negative scenario combining two independent invalid inputs: a server-only nested policy
key and a browser-visible raw claims object. Its `success: false` assertion could therefore pass
without proving which security boundary rejected the response.

The scenario was split into two inputs. Each now checks the real Zod result through the schema
interface and asserts the corresponding `unrecognized_keys` issue path. This makes the evidence
specific to the contract that the test names and prevents one invalid field from masking a missing
restriction on the other. The admitted projection test remains an exact-output check, preserving
the public-shape contract.

The same review found two isolated malformed activity cases in the envelope schema tests that only
asserted generic rejection. Those now assert the invalid field paths (`activity.kind` and
`activity.name`), protecting the intended validation boundary without coupling to full error text.

The full repository check passed after the focused test passed. No production code or dependency
was changed. Other negative assertions that only establish generic rejection remain candidates for
future review when their contract needs a more specific observable error; this slice intentionally
stayed limited to a clear, security-relevant evidence gap.
