# Agent-guidance principles

This is an append-oriented record of user-provided guidance about engineering and test design. It is
for posterity and future context when revising contributor guidance; it is not an automatically
loaded instruction source. Current rules remain in `AGENTS.md` and `CLAUDE.md`.

## Evidence-design caution — 2026-10-06 to 2026-10-07

While reviewing synthetic Testmints comprehension studies, Rob's direction was that the test should
be the behavioral specification presented to the agent: avoid contaminating an experiment with
production-code or task-text clues about the intended behavior. The studies were not sufficient to
prove a general Testmints advantage. This remains a caution about claims of effectiveness, not a
reason to abandon the phase discipline for readability and review.

## Dashboard migration phase and scenario coaching — 2026-10-22 to 2026-10-23

During the first dashboard migrations, Rob corrected mechanical conversions that left `expect`s
outside verify or emptied exercise. The action belongs in exercise and passes the responses or
objects needed by verify forward. As setups become structurally complex, arrange them in setup and
consume them in exercise; do not make a shared fixture object a constraint that prevents a scenario
from arranging its own meaningful world.

In the API-auth review, he described the intended arrangement boundary directly:

> “the thing i'm reaching for is that the setup is sort of 'arrange', and the more complicated a
> structure is, the better off we'd be defining it in the setup and then using it in the exercise.
> i'd like to avoid feeling locked into a shared fixture object for tests.”

He repeatedly used the question “what is the subject?” as a review test. A scenario that happened
to parse configuration and derive a permitted call, for example, mixed two distinct boundaries and
should be split. Related scenarios may be grouped with nested `describe`s, with values and helper
functions scoped to the group that uses them. A local expected-rejection wrapper was acceptable as
a temporary expression of the phase boundary, but not as a reason to normalize assertion during
exercise or build a dashboard-wide abstraction.

The same reviews set the balance between explicitness and reuse. A generic scenario factory made
GitLab cases difficult to visualize even when it reduced duplication. Rob accepted a data structure
and loop only when cases are “extremely consistent and simple”; descriptor fields should use
`expected` language and reveal their roles. Otherwise, explicit scenarios are easier to review.
Fixture builders, splitting, and inlining are warranted only when they improve immediate
readability—not merely to minimize line count. Test names must not promise a broader contract than
the subject actually exercises.

The review comments preserve why those constraints matter. On a mixed schema/call-derivation test:

> “what is the subject of \"defaults to GitLab.com and accepts nested projects and a self-managed
> path prefix\"? i'm reading it and not quite sure if its correctly factored or not”

And when an error-suite factory had become hard to inspect:

> “I have mixed feelings about the way we've refactored test suites like gitlabErrorScenario -
> yeah, we're minimizing code reuse, but its hard to quickly visualize what each test case does -
> are there alternatives that get us as much of hte value? or am i crazy”

The resulting exception was deliberately narrow:

> “i'm not opposed to using a datastructure and a for loop for some of this stuff as well, when it
> is extremely consistent and simple”

For such descriptors, he added:

> “probably should use some 'expected' language in the data structures so its easier to modify
> things in the future. and adjust any other names to compensate”

Two concrete phase corrections are worth retaining. Constructing an app, client, memory store, or
other world that enables a request belongs in setup when the request is the feature-owning trigger;
otherwise the setup work obscures the inflection point. Conversely, do not force all setup through a
large shared fixture: small fixtures may be inlined when that is clearer, and a scenario may compose
its own structured input with shared low-level ingredients. This was the intended balance behind
the API-auth and pipeline-adapter refactors.

The pipeline-adapter review made that distinction concrete:

> “is it just me or would it make more sense for the pipelineAdapterApp(adapter, fetcher) to be run
> in the setup instead of the exercise? like the request is the workhorse function trigger?”

Rob also rejected the idea that an ordinary expected exception should make exercise semantically
successful by itself. The temporary local `rejects` wrapper instead makes an unexpected resolution
fail and forwards the captured error to verify. It was approved for a particular test while the
adapter lacks a first-class form; promotion remains conditional on whether it proves valuable in
Testmints proper.

## Adapter and HTTP evidence refinements — 2026-10-23

The next conversions reinforced that one request can be the subject even when the implementation
performs internal work such as a token refresh or replay. Put the request, response, and recorded
upstream evidence through the real adapter or route boundary; do not replace it with source-shaped
mock assertions. When the contract is cache reuse, renewal, or idempotence, the deliberately
repeated adapter call is the visible exercise rather than accidental duplication.

In this period Rob also asked that the log construction and other meaningful mutable collaborators
be arranged in setup. A scenario should create a distinctive value once and carry it through the
call and its observation, rather than repeat disconnected literals. This is a readability rule:
the value's journey should reveal what the test proves.

## Readability, comments, and grouping review — 2026-10-26

Several short migration reviews made the presentation standard more concrete. Before adding a
helper, enum, index module, or fixture builder, ask whether it makes the case easier to see at the
call site; scope modules and variables to their actual boundary. Group after identifying a shared
contract, not merely because neighboring tests touch the same file. Revisit names after refactoring:
a name that describes a broad configuration failure, for example, is misleading when the scenario
only proves one particular invalid condition.

Code structure should carry as much explanation as possible. Rob's preference was to reserve
comments for emergencies that truly need to call a reader's attention; improve names, grouping,
data flow, and types first. This is particularly important in test code, where an explanatory
comment can otherwise conceal that the scenario itself is not legible.

He paired that preference with a constraint on refactoring effort:

> “ok do the splitting and do the fixture builders but only if that actually improves readability”

The same review cycle distinguished a uniform table from a disguised decision tree. An input/output
matrix is useful when every row has the same subject and observable contract; it is not a license to
put branching setup or assertions in the descriptor. The table's identifiers should make expected
results and scenario inputs editable without reverse-engineering generic terminology.

## Component boundaries, browser setup, and cleanup — 2026-10-26 to 2026-10-27

Rob directed detailed component testing toward the component's own stable boundary, leaving parents
to demonstrate composition. An integrated test remains appropriate for a subtle or unpredictable
interaction, although such interactions should not be introduced casually. This reinforces the
real-interface standard: do not repeat a child's structural proof at parent or browser level.

His stated boundary was:

> “its appropriate to demonstrate that an integrated component is used somehow, but when possible
> we should prefer detailed testing of that component at its own boundary. the exceptions would be
> when there's an unpredicable or subtle interaction”

For UI scenarios, a render may be setup when a later user interaction is the inflection point; that
keeps the interaction visible in exercise. Conversely, screen and container queries are
observations and may live in verify. Use the ordinary RTL render path by default; custom rendering
and client fixtures must be important and relevant to the particular scenario, not migration
ceremony. Likewise, Testmints does not itself require removing `afterEach(cleanup)`: retain genuine
suite cleanup and remove a fixture only when its fetch, timer, storage, or other isolation is not
needed.

These were direct corrections to over-generalized client setup:

> “i feel like we're overusing client test fixture when we might not need it”

> “nothing about testmints says that we have to remove afterEach(cleanup)... why are we doing that?”

And the preferred default was explicit:

> “ensure that [helpers are] only used _when important and relevant to the particular test_ so the
> normal default is out of the box RTL render”

Tests of time-dependent UI need a named behavior, not a vague timeline. Controlled time and an
ordered lifecycle can remain one exercise when the sequence itself is the contract. If they prove
independent behavior, split them; use browser frames or animation events rather than wall-clock
sleeps when browser animation is the evidence.

Related browser-runner work established a separate evidence boundary: compatibility must be proved
in the runner that supplies browser fixtures and runs in CI, not inferred from the Vitest suite.
That does not make browser tests a default; it explains why a browser-only contract needs a runner
specific check and environment setup.

## Testmints as a feature-boundary diagnostic — 2026-10-28

The following statements are quoted from Rob during the falling-shapes simulation refactor:

> “the testmints form is intended to ensure that each test is focused on one scenario and its
> outputs, with a clear inflection point (or subject) that 'owns' the feature from an outside
> perspective (the internals are irrelevant). existing test code that doesn't meet this form is
> suspect because its unclear what value it is intended to produce”

> “i don't advocate 'keep the test in native vitest'”

The result is a diagnostic standard: when phases produce observation harvesting, expose multiple
inflection points, or force incidental-DOM assertions, split the contracts or extract a narrower
production boundary until setup, exercise, and verification reveal a real feature. The response is
not to retain native Vitest merely because the existing test does not fit the form.

The falling-shapes work made that concrete. The old component timeline mixed geometry, motion
preference, scheduling, placement, and CSS details. The extraction retained the legacy proof while
it established a simulation boundary, then replaced it with direct transition scenarios and thin
component-boundary tests. Its reduced-motion test kept the settled visual composition and dropped
an unproven mechanism assertion about starting an interval. This does not prohibit timer evidence;
it requires the feature that makes it valuable to be named.

Related same-day guidance was equally direct:

> “as a general rule, its fine IMO to put queries of the screen in the verify section”

> “if some of these tests have variables that are similar its fine to factor those into variables
> outside of the setup scope”

The context remains that static, context-free defaults may be file-scoped while scenario-specific
values and fresh mutable collaborators remain setup-owned. Several assertions about one execution
belong together, but cadence and settlement become separate scenarios when they represent different
subjects.

## Deliberately deferred choices — as of 2026-10-28

The installed Vitest adapter remains the dashboard migration boundary. The archive did not justify
shared Testmints infrastructure, reporting artifacts, a project-wide fixture/template layer, or a
dashboard-specific expected-rejection abstraction. First-class rejected-exercise semantics remain
an upstream design question. Playwright compatibility was explored separately; browser tests remain
for browser-only behavior and do not expand this Vitest-focused migration rule.
