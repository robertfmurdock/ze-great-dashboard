# Consumer documentation focus

The documentation pass aimed to make each public guide answer a reader's evaluation or operating
task before exposing repository-specific detail. The top-level README now leads with product scope,
supported signals, trial paths, deployment, security, and next steps. AWS guides are organized around
administrator and application-owner responsibilities, while contributor test and release mechanics
remain in contributor or historical records.

The first edit cut too broadly by treating material that was not immediately procedural as
expendable. Review showed that visible examples and measured cost are product evidence: they help a
prospective user judge readability, failure behavior, security posture, and operating shape. Those
examples were restored as a clearly labeled evidence layer rather than mixed into setup steps.

The Auth0 endpoint-test tenant and CI procedure were removed from the OIDC operator guide because
they describe this repository's release evidence, not a consumer's provider setup. Architectural and
chronological records were left intact; their explicit contributor audience makes depth and history
appropriate there. The durable rule is to shorten navigation and repetition, not to erase technical
proof or rationale that helps the document's named reader make a decision.

Contributor and architecture documents were restored after the same distinction exposed a second
overreach: capture procedures, compatibility contracts, test strategy, and implementation history
are actionable content for maintainers. `AGENTS.md` and `CLAUDE.md` now state both sides of the
audience rule explicitly, including the expectation that demos, measured costs, supported versions,
and package badges remain visible to evaluators.

The root README now follows a shorter adoption path: purpose, representative product view, features,
quick start, deployment, security, and deeper documentation. The full visual tour and measured cost
sample moved to `docs/feature-tour.md`, linked near the top, so the evidence remains easy to find
without dominating installation and evaluation. The established AWS/client version and Socket
security badges were restored; badges without an existing project convention were removed.
