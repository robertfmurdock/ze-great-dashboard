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
