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

For organization, polling resolution and duration parsing were extracted from the large board
configuration test file into `polling-policy.test.ts`. They exercise different production
subjects from board validation and published-schema projection, so the split improves navigation
without introducing a shared fixture that would hide scenario-specific setup. Board validation and
schema projection remain together because both are contracts of the board-config schema module.

The published JSON-schema projection was then separated into `board-schema-projection.test.ts`.
It is a serialization/public-artifact contract with no shared scenario state, so keeping it beside
the parser tests added navigation cost without adding evidence.

The subject-oriented files are now grouped by domain: shared configuration tests under
`packages/shared/test/config`, server provider tests under `packages/server/test/adapters`, and
client browser-history tests under `packages/client/test/history`. Relative source and fixture
paths were updated as part of the moves; no test behavior changed.

Client animation tests are now grouped under `packages/client/test/animation`, covering the shared
animation primitives, timing hooks, simulation logic, and their field components. This is a domain
boundary rather than a size-based split: these tests share the animation production area even when
their individual subjects differ.

The full repository check passed after the focused test passed. No production code or dependency
was changed. Other negative assertions that only establish generic rejection remain candidates for
future review when their contract needs a more specific observable error; this slice intentionally
stayed limited to a clear, security-relevant evidence gap.
