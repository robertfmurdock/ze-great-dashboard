# Testmints synthetic-study methodology retrospective (2026-10-07)

This is a retrospective on the three synthetic Testmints studies, not product or release evidence.
Its purpose is to preserve why repeated null results do not yet answer whether Testmints helps
agents. The useful conclusion is about the experiments: they have not made the proposed advantage
observable.

## What happened

| Study | Endpoint result | Explanation result | Supported conclusion |
| --- | --- | --- | --- |
| Route-contract pilot | Native 8/8; Testmints 8/8 | Every score 4/4 | Both forms were sufficient for a direct mapping task. |
| Refresh-failure study | Every cell 4/4 | Every score 3/4 in both forms | Neither form produced the evaluator's requested framing. |
| Two-call boundary study | Native 8/8; Testmints 8/8 | Every score 4/4 | The selected repair and prompts saturated both measures. |

The studies rule out an easy claim of a large advantage on these tasks. They do not show Testmints
has no value for agent comprehension generally, nor that native Vitest is equally effective for
every multi-step contract.

## The central failure: no discriminating task

The last study removed semantic task prose, but the test and implementation still made the repair
locally obvious. The failure branch visibly assigned `cachedObservation = undefined`; the visible
test established an observation, made the next call fail, and explicitly asserted that the
serialized observation stayed unchanged. Deleting that one line was the smallest natural repair.
The same test also named the public error, publication count, and lease boundary.

That is excellent regression evidence. It is not a demanding test of whether an agent uses phase
boundaries to recover a contract. Native Vitest presents the same chronological calls and
assertions; Testmints labels them. Every participant could follow the same one-line repair, so the
16/16 hidden passes and 16/16 full explanations are a **ceiling effect**, not evidence that the two
representations are equivalent.

The first two studies had the related flaw of stating the answer in prose. The route task explicitly
specified which field to add and when to omit it. The refresh-failure task explicitly required cache
retention, no new publication, and lease preservation. Those tasks measured instruction-following
and implementation fidelity, not recovery of a latent contract from test representation.

## Hidden checks confirmed; they did not discriminate

The coordinator's hidden public-interface checks are still worth retaining. They stop a source-text
assertion and protect against hard-coded fixture values. In these studies, however, they mostly used
different data to recheck consequences already named by the visible test. They did not distinguish
an agent that understood a call boundary from one that followed the conspicuous local mutation.

There is a fundamental tension to resolve before another study. If the visible test is the *complete
behavioral specification*, a hidden verifier must not impose extra semantics merely to create a
difference: that would mean the visible specification was incomplete. But a hidden verifier that
only repeats visible semantics is unlikely to measure deeper comprehension. Future work must choose
one honest construct:

- For correctness against a complete visible test, use hidden tests as robustness checks and do not
  interpret a tie as a phase-comprehension result.
- For recovery of a broader invariant, expose that compact public contract visibly and let hidden
  tests exercise implications of it. That is a different question from “the test is the only spec.”
- For phase-boundary explanation, make prediction/explanation the primary task rather than using a
  one-line repair as a proxy.

## The explanation measure was cued and saturated

The final prompt directly asked which call established the precondition, which was the subject, and
which outcome proved it. Restating those labels is cheap prompt-following, not evidence that the
agent used them to select its repair. The uniform 4/4 is therefore another ceiling.

The refresh-failure study's uniform 3/4 has the inverse problem. Its rubric required wording about
“cache-priming setup”, while the task asked only for a generic protected-behavior explanation. A
correct account could miss that phrase, so the score reflects a rubric/task mismatch as much as
comprehension. Blinded agreement protects against a simple condition bias, but the reviewers were
not independent human raters and agreement at a ceiling says little about rubric validity.

Future explanation evidence should ask uncued, falsifiable counterfactuals. For example: “What
would be observable if the failure occurred before any successful refresh?” Score the predicted
public behavior and reason against a preregistered key. Do not use “setup”, “subject”, or
“precondition” in the question when those are the constructs being measured.

## Execution and provenance threats

- The first two-call participant was invalid: its workspace sat below the checkout, the CLI
  inherited repository guidance, and it read parent material. It is retained as an invalid pilot
  and excluded from the clean result.
- Moving workspaces outside the checkout exposed an ambient dependency. The old task found the
  root's Node types without declaring them; the isolated fixture now declares the existing curated
  `@types/node` version. Earlier in-repository runs therefore did not prove a standalone boundary.
- The clean attempt separated participant and coordinator roots and used a restricted CLI launch.
  The audited first run read task-local files only. The runner does not yet mechanically reject
  outside-root commands in every run, so this is stronger isolation, not a formal containment proof.
- Earlier studies correctly reported unavailable telemetry rather than inventing it. The final study
  captured immutable runner telemetry, but one native run's elapsed time included a host-handle
  interruption (861,333 ms). It remains in raw evidence; median time was unaffected, but timing is
  descriptive rather than a precise performance estimate.
- Four runs per cell are not four independent model populations. Runs shared a model family, date,
  host, package cache, prompt shape, and dispatch machinery. No model build, sampling settings, or
  independent-session policy supports a general behavioral claim.

## Analysis limits

The directional threshold was a useful guard against post-hoc storytelling, not a power analysis.
At 4/4 in every cell it cannot estimate a small effect or distinguish no effect from a task too easy
to reveal one. The responsible result is **no observable advantage in these saturated tasks**.
Tool count and elapsed time are secondary diagnostics only: more inspection is not necessarily
deeper comprehension, and orchestration pauses can inflate wall time.

## Meta-methodological threat: agents evaluating agent comprehension

These studies were substantially designed, implemented, dispatched, and interpreted by an agentic
system close to the evaluated population. That is not neutral. An agent naturally optimizes for
legible tasks, plausible-looking controls, quick verification, and successful completion. Those are
useful implementation instincts, but they bias a comprehension study toward tests that disclose the
answer, hidden checks that restate visible assertions, and rubrics that reward fluent repetition of
the supplied framing. The recurring ceiling effects here are consistent with that risk.

The same issue applies to interpretation. An agent can produce a coherent explanation for why a
null result is inconclusive, but it is poorly placed to independently decide that its own task
authors did not contaminate the construct. Blinded scoring reduces one narrow form of condition
bias; it does not make the design author, evaluator, and subject population independent. In this
attempt the blinded reviewers were themselves agents, so their agreement is evidence of consistent
application of the rubric, not independent validation that the rubric measures understanding.

This does not make agent assistance unusable. It changes its role: use agents to generate candidate
tasks, implement reproducible harnesses, enumerate failure modes, and challenge designs. Treat
agent-designed self-evaluations as hypotheses and instrumentation prototypes until an independent
reviewer has attacked the task, contamination boundary, construct validity, and analysis plan.
Where a decision depends on the result, separate at least these roles: a task author who does not
score outcomes, an adversarial reviewer who did not author the treatment, and an evaluator who sees
only blinded artifacts. A human reviewer is preferable for the adversarial construct-validity step;
if that is unavailable, use independently prompted models and report that limitation rather than
calling the review independent.

## Gates before a fourth study

Do not spend another 16-run budget until a disposable pilot clears every gate below.

1. Name the proposed mechanism: why should `setup`/`exercise`/`verify` change a decision compared
   with linear native code, and which plausible incorrect decision should it prevent?
2. Write a wrong-repair catalogue before the visible test. For each repair, show whether it passes
   visible evidence and which legitimately implied public invariant it violates. Reject a task whose
   only realistic repair is adding or deleting the exact line the test names.
3. Pilot discriminability. Require meaningful variation—neither universal success nor universal
   failure—before treating a balanced study as worthwhile. Do not reuse pilot observations.
4. Separate outcomes. Call changed-fixture hidden checks robustness evidence. If hidden checks test
   broader semantics, provide the semantic contract visibly. Grade phase comprehension with uncued
   counterfactual predictions, not prompted restatement.
5. Enforce containment from preflight onward: external task roots, separate coordinator root, no
   parent checkout or network unless required, recorded exact agent configuration, and an automatic
   failure for commands outside the assigned root.
6. Validate the real launcher with a disposable full run: JSONL tool capture, answer capture,
   command classification, monotonic timing, and immutable result creation must all work before
   dispatch. A launcher failure is an explicitly invalid artifact, never a candidate data point.
7. Only after a task clears these gates should replication broaden across task families and
   independent sessions. Report raw cells and uncertainty, not just a directional threshold.
8. Add an independent adversarial design review before dispatch. Its job is specifically to find
   semantic leakage, obvious local repairs, hidden-visible contract mismatch, rubric cueing, and
   ambient-context paths. The authoring agent must not self-certify that review.

## What carries forward

Keep the coordinator discipline—fresh templates, public-interface checks, baseline snapshots,
deterministic allocation, immutable telemetry, and blinded review. Do not reuse the current tasks
as comparative benchmarks. They repeatedly made the repair and desired explanation too easy.

Until a task clears the discriminability gate, the responsible position is neither “Testmints
works” nor “Testmints does not work.” It is: these studies cannot reveal the difference they were
built to assess.
