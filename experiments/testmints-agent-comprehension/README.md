# Testmints agent-comprehension pilot

This is an opt-in synthetic A/B evaluation of whether Testmints helps agents recover a route
contract and safely implement a bounded behavior change. It is not dashboard release evidence and
does not run from `npm run check`.

The task models the dashboard's route-level pipeline adapter contract: it uses Hono's real request
interface, a public response envelope, a canonical link, and cache headers. The two conditions
differ only in test representation: `native` uses ordinary Vitest and `testmints` uses `mintTest`
with setup, exercise, and verify phases. Both task packages declare the same exact dependencies,
including Testmints, so package topology is not a condition difference.

## Coordinator workflow

The coordinator prepares a single deterministic manifest and sixteen fresh, installed workspaces.
Do not give an agent this repository, the manifest, or both condition templates.

```sh
node experiments/testmints-agent-comprehension/create-task.mjs --preflight
node experiments/testmints-agent-comprehension/create-task.mjs --prepare --install
```

The fixed seed assigns four anonymous runs to each of native/Testmints × GPT-6.1 Sol medium/high.
Each agent receives only its generated workspace and `TASK.md`, plus this fixed handoff: “Implement
`TASK.md`, preserve existing evidence, run `npm run check`, then provide one paragraph explaining
the protected behavior.” Keep tool policy, time limit, and initial workspace state identical.

`--preflight` is coordinator-only. For both conditions it proves that the visible baseline passes,
hidden acceptance fails before the change, the intended minimal production-and-test change passes,
and generated workspaces contain neither the alternate representation nor the verifier. It leaves
only a timestamped preflight record under ignored experiment state.

After an agent finishes, the coordinator runs the hidden endpoint-level acceptance check:

```sh
node experiments/testmints-agent-comprehension/create-task.mjs \\
  --verify --directory experiments/testmints-agent-comprehension/.workspaces/run-01
```

The verifier is not copied into task workspaces. It adds a temporary Vitest file, runs the
workspace's full `npm run check`, and removes that file even when verification fails.

Record the run after that check. The counters come from the agent runner or transcript rather than
being inferred from a workspace diff.

```sh
node experiments/testmints-agent-comprehension/create-task.mjs --complete \\
  --run-id run-01 --agent-check pass --tool-invocations 0 --test-invocations 1 \\
  --started-at 2026-10-06T12:00:00Z --ended-at 2026-10-06T12:05:00Z \\
  --explanation-file /private/tmp/run-01-explanation.txt
```

Use `--review-packets` only after records exist. It produces condition- and profile-blind packets
containing anonymous ids, explanations, and the locked rubric. Preserve both reviewer score sets
and their resolution in each coordinator record. Analyse raw cells first; aggregate by
representation only after checking the reasoning-level interaction.

## Preregistered evaluation

**Hypothesis.** An explicit setup → exercise → verify shape improves an agent's ability to infer
and implement the route contract without weakening unrelated evidence.

**Primary outcome.** A completion succeeds only when the agent's reported full check and the
coordinator's hidden verifier pass.

**Secondary outcomes.** Record elapsed wall time, tool/test invocations, changed-line count, and
the agent's one-paragraph explanation of the protected behavior. Two reviewers, blinded to
condition and agent profile, score the explanation against four binary items:

1. `sourceUpdatedAt` mirrors `updatedAt` when supplied.
2. `sourceUpdatedAt` is absent when upstream omits `updatedAt`.
3. The public response remains successful and preserves its canonical link and cache policy.
4. The evidence exercises the endpoint rather than a copied internal implementation.

Resolve disagreement while retaining both original scores. The pilot is directional: advance to one
real-dashboard change only if Testmints improves completion or explanation quality without a
material median-time increase or weaker evidence.

## Result record

One coordinator-owned JSON record per run lives under the ignored `results/` directory. It includes
condition, anonymous id, pinned model/tool configuration, timestamps, hidden-verifier result, agent
check result, tool/test invocation counts, changed lines, verbatim explanation, reviewer-score
slots, and evaluator intervention. Never put credentials, agent transcripts containing secrets, or
the hidden verifier in an assigned task.
