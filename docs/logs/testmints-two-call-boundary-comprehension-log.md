# Testmints two-call boundary-comprehension study (2026-10-06)

Added a third, sibling synthetic study rather than modifying either earlier experiment. Its question
is narrower than general implementation success: whether the visible test's representation helps an
agent identify that one public `refresh()` establishes cached state and the next is the failing
subject. The native and Testmints fixtures, operations, and observable assertions are identical;
only their test structure differs.

The supplied regression deliberately begins red because the production failure path clears the
cached observation. Coordinator preflight verifies that this is the only visible failure, that an
independent hidden public-interface test also fails, and that deleting that production cache-clear
alone satisfies both representations. The hidden verifier uses distinct fixture values so it is not
just a second copy of the visible assertion.

Prior study coordination accepted manually entered time and invocation counters. This study instead
requires an instrumented runner artifact before a run can be recorded: immutable wall and monotonic
timestamps, assigned model/reasoning profile, event-derived tool and test counts, completion status,
and the participant's required boundary explanation. This avoids filling evidence gaps from diffs or
memory. The final decision remains intentionally directional: hidden public-contract pass is the
primary outcome, with blinded explanation scores as supporting evidence only.

## Isolated execution clarification (2026-10-07)

The first attempted participant was retained as an invalid pilot after its CLI session inherited
the repository hierarchy and read material beyond the assigned task. A valid rerun therefore uses
participant workspaces under a separate temporary root, with coordinator state in a different
temporary sibling. This also exposed an ambient dependency: the in-repository task workspace found
the root's `@types/node` transitively, while the isolated task correctly failed TypeScript without
it. The fixture now declares the already-curated root version directly; this adds no project
dependency and makes the task's stated package boundary real.

## Isolated study result (2026-10-07)

The clean isolated attempt completed all 16 assigned runs. Every visible check and hidden
public-contract verifier passed: native was 8/8 and Testmints was 8/8, including 4/4 in each
reasoning cell. Both condition/profile-blind reviewers gave every explanation all four boundary
claims, with no disagreements or adjudications. Testmints therefore does not meet the predeclared
primary decision threshold of at least two more hidden-contract passes, and the result is
**not directionally promising**.

The telemetry-recorded median elapsed times were 21,312.987083 ms for native and 22,893.7566455 ms
for Testmints, within the 20% limit. One native/medium run recorded 861,333.323459 ms while its
process survived a host execution-handle interruption; that value is preserved rather than
reconstructed or excluded, and it does not change either median. Complete coordinator artifacts,
raw per-cell records, snapshots, telemetry, reviewer scores, and the no-disagreement adjudication
are retained under `/private/tmp/testmints-boundary-attempt-2026-10-07` for this session.
