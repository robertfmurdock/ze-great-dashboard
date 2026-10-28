# Agent-guidance principles

This is an append-oriented record of user-provided guidance about engineering and test design. It is
for posterity and future context when revising contributor guidance; it is not an automatically
loaded instruction source. Current rules remain in `AGENTS.md` and `CLAUDE.md`.

## Testmints as a feature-boundary diagnostic — 2026-10-28

The following statements are quoted from the user during the falling-shapes simulation refactor:

> "the testmints form is intended to ensure that each test is focused on one scenario and its
> outputs, with a clear inflection point (or subject) that 'owns' the feature from an outside
> perspective (the internals are irrelevant). existing test code that doesn't meet this form is
> suspect because its unclear what value it is intended to produce"

> "i don't advocate 'keep the test in native vitest'"

Related review guidance from the same discussion:

> "as a general rule, its fine IMO to put queries of the screen in the verify section"

> "if some of these tests have variables that are similar its fine to factor those into variables
> outside of the setup scope"

This established the intended reading of the project’s Testmints rules: the adapter is not merely a
test-registration format. It is a constraint for revealing a feature’s externally meaningful subject,
one input world, its inflection-point exercise, and its observable output. If those cannot be named,
the test or production boundary needs refactoring; the response is not to bypass the form.

The falling-shapes work illustrated the distinction. A component-level timer/DOM timeline mixed
geometry, user motion preference, scheduling, placement, and CSS implementation details. The
refactor extracted the state-transition subject, retained the component’s geometry and
reduced-motion boundary, and expressed those contracts as focused Testmints scenarios. Screen and
container queries remain verification observations; reusable static defaults may be file-scoped,
while scenario-specific inputs and fresh mutable collaborators remain setup-owned.
