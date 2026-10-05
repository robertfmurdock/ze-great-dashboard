# Testmints agent-comprehension pilot

This is an opt-in, synthetic A/B evaluation of whether Testmints helps agents recover a test's
intended contract and safely implement a bounded behavior change. It is not dashboard release
evidence and does not run from `npm run check`.

The task models the dashboard's route-level pipeline adapter contract: it uses Hono's real request
interface, a public response envelope, a canonical link, and cache headers. The two conditions
differ only in test representation: `native` uses ordinary Vitest and `testmints` uses `mintTest`
with setup, exercise, and verify phases. Both task packages declare the same exact dependencies,
including Testmints, so package topology is not a condition difference.

## Coordinator workflow

Create one fresh, isolated workspace per agent. Do not give an agent this repository or both
condition templates.

```sh
node experiments/testmints-agent-comprehension/create-task.mjs \\
  --condition native \\
  --directory /private/tmp/testmints-pilot/native-01 \\
  --install
```

Use `--condition testmints` for the alternate representation. Give every agent only the generated
workspace and its `TASK.md`. Keep the prompt, model, tool access, time limit, and initial
workspace state identical. Randomly assign eight agents to each condition; an agent participates
in only one condition.

After an agent finishes, the coordinator runs the hidden endpoint-level acceptance check:

```sh
node experiments/testmints-agent-comprehension/create-task.mjs \\
  --verify --directory /private/tmp/testmints-pilot/native-01
```

The verifier is not copied into task workspaces. It adds a temporary Vitest file, runs the
workspace's full `npm run check`, and removes that file even when verification fails.

## Preregistered evaluation

**Hypothesis.** An explicit setup → exercise → verify shape improves an agent's ability to infer
and implement the route contract without weakening unrelated evidence.

**Primary outcome.** A completion succeeds only when the coordinator's hidden verifier and the
workspace's full check pass.

**Secondary outcomes.** Record elapsed wall time, tool/test invocations, changed-line count, and
the agent's one-paragraph explanation of the protected behavior. Two reviewers, blinded to
condition, score that explanation against four binary items:

1. `sourceUpdatedAt` mirrors `updatedAt` when supplied.
2. `sourceUpdatedAt` is absent when upstream omits `updatedAt`.
3. The public response remains successful and preserves its canonical link.
4. The evidence exercises the endpoint rather than a copied internal implementation.

Resolve reviewer disagreement before analysis and retain both original scores. Report raw outcomes
by condition; eight agents per condition makes this a directional pilot, not a statistical claim.
Proceed to a real-dashboard trial only when Testmints improves successful completions or explanation
scores without a material increase in median time or evidence weakening. Otherwise retain the
harness and revise the Testmints hypothesis before migration.

## Result record

Store one coordinator-owned JSON record per run outside the task workspace, under the ignored
`results/` directory. Include condition, anonymous agent id, pinned model/tool configuration,
start/end timestamps, hidden-verifier result, check result, tool/test invocation count, changed
lines, verbatim explanation, blinded reviewer scores, and evaluator intervention. Never put
credentials, agent transcripts containing secrets, or the hidden verifier in an assigned task.
