# Testmints two-call boundary-comprehension study

This is the third, standalone synthetic study. It asks whether explicit Testmints phases help an
agent distinguish the public call that establishes state from the next call whose failure is being
tested. It is research instrumentation, not dashboard release evidence. Earlier experiments remain
unchanged.

Each of the 16 assignments is one of four balanced cells: native/Testmints × GPT-6.1 Sol
medium/high, four runs per cell. The participant sees only `TASK.md`, one visible failing test, and
the implementation target. The task says that the test is the complete specification and forbids
editing it. No task prose or production-code comments describe the behavior.

Both tests make the same public calls and assertions. A successful first `refresh()` establishes
the observation, a transport failure in the second `refresh()` is the subject, and the visible
assertions cover public error outcome, byte-equivalent cached observation, publication count, and
lease release. Native Vitest shows those calls linearly. Testmints puts only the first call in
`setup`, the second in `exercise`, and all observations in `verify`. It uses neither Testmints
reporting nor test-owned `scope.using()`.

## Coordinator workflow

Run preflight before dispatch:

```sh
node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --preflight
node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --prepare --install
```

For an isolated live attempt, set `TESTMINTS_STUDY_ROOT` to a new coordinator directory outside
the repository (for example `/private/tmp/testmints-boundary-attempt-2026-10-07`) and
`TESTMINTS_WORKSPACES_ROOT` to a separate sibling directory. The templates remain coordinator-owned
in this repository, while generated participant workspaces and coordinator artifacts are physically
separate. Do not use a directory beneath this repository for a live attempt.

Preflight proves that each visible baseline fails at the supplied regression only, hidden acceptance
fails, and the minimal production-only correction makes visible and hidden checks pass. Its hidden
test is coordinator-only, uses different fixture values, and exercises only the public refresh
interface. Generated task workspaces are checked for alternate representations and the verifier.
Preparation snapshots every workspace and hashes its visible test.

Dispatch only through the instrumented runner. For Codex CLI participants, pass `--codex-json` and
run `codex exec --json`; the runner captures its immutable JSONL stream and derives tool calls from
completed command-execution items and test commands from their command text. Other runtimes must
append one JSON object per tool event to `EXPERIMENT_AGENT_EVENTS_FILE`; every event has `type` and
`monotonicNs`, and test commands use `type: "test-command"`. The runner will not create telemetry
without that stream. It captures immutable start/end wall and monotonic times, the declared
model/profile, event-derived tool/test counts, final explanation, and completion status. The final
explanation file must answer which public call establishes the precondition, which is the subject,
and what observable outcome proves the distinction. Codex JSON mode records that explanation from
the final agent-message event when its output-file option does not create a file.

```sh
node experiments/testmints-two-call-boundary-comprehension/run-participant.mjs \
  --run-id run-01 --model 'GPT-6.1 Sol' --reasoning medium \
  --workspace experiments/testmints-two-call-boundary-comprehension/.workspaces/run-01 \
  --events-file /absolute/path/run-01.events.ndjson \
  --explanation-file /absolute/path/run-01-explanation.txt --codex-json -- \
  codex exec --ephemeral --json -m gpt-6.1-sol -C . -o /absolute/path/run-01-explanation.txt \
  'Implement TASK.md, run npm run check, then answer its required question.'

node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --complete --run-id run-01
```

`--complete` ingests only the immutable runner artifact; it accepts no manually entered timestamps
or counters. It reruns visible and hidden checks, checks the visible-test hash, and records the
result. Do not launch a run where the agent runtime cannot produce the event stream.

After all runs, generate condition/profile-blind packets, collect two four-bit reviewer score sets,
and retain adjudication records for disagreements:

```sh
node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --review-packets
node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --score-reviews --reviewer one --scores-file reviewer-one.json
node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --score-reviews --reviewer two --scores-file reviewer-two.json
node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --adjudicate --scores-file adjudications.json
node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --report
```

Review claims are: first call establishes state; second is the subject; cached evidence is retained;
and failure neither publishes nor leaks a lease. The report lists every run in every cell before
aggregation: visible check, hidden-contract result, elapsed time, tool/test calls, and explanation
score. Hidden public-contract pass is primary. Testmints is directionally promising only with at
least two additional hidden passes across eight runs, no loss in either reasoning cell, no weaker
endpoint evidence, and median elapsed time no more than 20% slower. Explanation scores support but
cannot substitute for the primary outcome. Values are reported only from recorded telemetry; absent
instrumentation is a dispatch failure, never reconstructed from diffs or memory.
